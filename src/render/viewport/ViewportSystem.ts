import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Object3D,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import type { Document } from "@/core";
import type { Uuid } from "@/types/core";
import type { BuiltinCamera, EditorViewportState } from "@/types/editor";
import { TransformGizmo } from "@/render/gizmo/TransformGizmo";
import { PrimitiveHandles } from "@/render/handles/PrimitiveHandles";
import { CameraRig } from "@/render/nav/CameraRig";
import { SceneSynchronizer } from "@/render/scene-sync/SceneSynchronizer";
import { ViewportInput } from "./ViewportInput";

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewportStats {
  fps: number;
  nodes: number;
  backend: string;
}

/** One world axis projected into a pane's view plane, for the axis indicator. */
export interface AxisProjection {
  dx: number; // screen-right component (-1..1)
  dy: number; // screen-down component (-1..1)
  front: boolean; // pointing toward the viewer (draw label emphasized)
}

/** Per visible pane slot: X/Y/Z projections. */
export type PaneAxes = [AxisProjection, AxisProjection, AxisProjection];

const BUILTINS: BuiltinCamera[] = [
  "persp",
  "ortho",
  "top",
  "bottom",
  "left",
  "right",
  "front",
  "rear",
];

/** Raised on right-click; the UI layer builds the appropriate context menu. */
export interface ViewportContextRequest {
  clientX: number;
  clientY: number;
  pane: number;
  /** Node under the cursor, or null for viewport background. */
  nodeId: Uuid | null;
}

/**
 * Owns the canvas: WebGPU renderer (WebGL2 fallback), 1-up/4-up scissored
 * panes, per-pane display settings, gizmos/handles, framing. Input handling
 * lives in ViewportInput. No React in here — ViewportPanel hosts it.
 */
export class ViewportSystem {
  readonly canvas: HTMLCanvasElement;
  readonly doc: Document;
  readonly editor: EditorViewportState;
  readonly sync: SceneSynchronizer;
  readonly gizmo: TransformGizmo;
  readonly handles: PrimitiveHandles;
  readonly raycaster = new Raycaster();
  private renderer: WebGPURenderer | null = null;
  private readonly scene = new Scene();
  private readonly grid: GridHelper;
  private readonly input: ViewportInput;
  private rigs = new Map<string, CameraRig>(); // key: `${pane}:${camera}`
  private panes: PaneRect[] = [];
  private needsRender = true;
  private disposed = false;
  private rendering = false;
  private renderKick: number | null = null;
  private resizeObserver: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private frames = 0;
  private lastStats = performance.now();
  /** Canvas-relative 2D position of the active nav pivot marker (the "+"). */
  onNavMarker: ((pos: { x: number; y: number } | null) => void) | null = null;
  /** Axis-indicator data per visible pane slot, published every rendered frame. */
  onAxes: ((axes: PaneAxes[]) => void) | null = null;
  /** Right-click: UI layer opens the matching context menu. */
  onContextMenuRequest: ((req: ViewportContextRequest) => void) | null = null;
  onStats: ((s: ViewportStats) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, doc: Document, editor: EditorViewportState) {
    this.canvas = canvas;
    this.doc = doc;
    this.editor = editor;

    this.scene.background = new Color(0x101014);
    this.grid = new GridHelper(40, 40, 0x333340, 0x22222a);
    this.grid.position.y = -0.001;
    this.scene.add(this.grid);
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 4);
    this.scene.add(key);
    const fill = new DirectionalLight(0x8899bb, 0.6);
    fill.position.set(-6, 3, -5);
    this.scene.add(fill);

    this.sync = new SceneSynchronizer(doc, () => this.invalidate());
    this.scene.add(this.sync.root);
    this.gizmo = new TransformGizmo(doc);
    this.scene.add(this.gizmo.group);
    this.handles = new PrimitiveHandles(doc);
    this.scene.add(this.handles.group);

    this.unsubs.push(editor.subscribe(() => this.invalidate()));
    this.input = new ViewportInput(this);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    if (import.meta.env.DEV) {
      // dev-only escape hatch for e2e/debug tooling
      (window as unknown as Record<string, unknown>).__viewport = this;
    }

    void this.init();
  }

  private async init(): Promise<void> {
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true });
    await renderer.init();
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    this.renderer = renderer;
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      void this.renderIfNeeded();
    };
    requestAnimationFrame(loop);
    this.invalidate();
  }

  private async renderIfNeeded(): Promise<void> {
    if (!this.needsRender || this.rendering || !this.renderer) return;
    this.needsRender = false;
    this.rendering = true;
    try {
      await this.renderFrame();
    } finally {
      this.rendering = false;
    }
    this.tickStats();
  }

  invalidate(): void {
    this.needsRender = true;
    // rAF is heavily throttled in occluded/unfocused windows (Chrome can
    // drop it to ~1Hz), which left on-demand renders — e.g. the frame that
    // repositions primitive handles after an undo — stuck until a refresh.
    // A timeout watchdog guarantees prompt rendering regardless of rAF.
    if (this.renderKick === null) {
      this.renderKick = window.setTimeout(() => {
        this.renderKick = null;
        void this.renderIfNeeded();
      }, 50);
    }
  }

  frameSelection(): void {
    this.frameBox(this.selectionBox() ?? this.sceneBox());
  }

  frameAll(): void {
    this.frameBox(this.sceneBox());
  }

  get backendName(): string {
    // biome-ignore lint/suspicious/noExplicitAny: backend introspection
    const backend = (this.renderer as any)?.backend;
    return backend?.isWebGPUBackend ? "WebGPU" : this.renderer ? "WebGL2" : "…";
  }

  /** The Object3D of the active selected node (gizmo/handles anchor). */
  activeObject(): Object3D | null {
    const active = this.doc.selection.active;
    return active ? (this.sync.object(active) ?? null) : null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.renderKick !== null) window.clearTimeout(this.renderKick);
    for (const u of this.unsubs) u();
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.sync.dispose();
    this.renderer?.dispose();
  }

  // ---- panes & rays --------------------------------------------------------

  /** Logical pane index shown in each rect (single layout shows the maximized pane). */
  logicalPanes(): number[] {
    return this.editor.layout === "single" ? [this.editor.maximizedPane] : [0, 1, 2, 3];
  }

  /** Canvas rect of a logical pane. */
  paneRect(pane: number): PaneRect {
    this.layoutPanes();
    return this.panes[this.logicalPanes().indexOf(pane)] ?? this.panes[0]!;
  }

  /** Logical pane index under a canvas point. */
  paneAt(x: number, y: number): number {
    this.layoutPanes();
    const logical = this.logicalPanes();
    for (let r = 0; r < this.panes.length; r++) {
      const p = this.panes[r]!;
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return logical[r]!;
    }
    return logical[0]!;
  }

  /** Aim this.raycaster through the pane's camera at the event position. */
  setRayFromEvent(e: PointerEvent | MouseEvent, pane: number): CameraRig {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const p = this.paneRect(pane);
    const ndc = new Vector2(((x - p.x) / p.w) * 2 - 1, -(((y - p.y) / p.h) * 2 - 1));
    const rig = this.rigFor(pane);
    this.raycaster.setFromCamera(ndc, rig.camera);
    return rig;
  }

  rigFor(pane: number): CameraRig {
    const cam = this.editor.paneCamera(pane);
    const isBuiltin = (BUILTINS as string[]).includes(cam);
    // key by the FULL camera binding: a scene-camera pane gets its own rig,
    // so the pane's Perspective rig keeps its PSR memory instead of being
    // clobbered by syncSceneCamera while looking through a scene camera
    const key = `${pane}:${cam}`;
    let rig = this.rigs.get(key);
    if (!rig) {
      rig = new CameraRig(isBuiltin ? (cam as BuiltinCamera) : "persp");
      this.rigs.set(key, rig);
    }
    return rig;
  }

  /** Reset the pane's editor camera to its defaults (context menu: Reset Camera PSR). */
  resetPaneCamera(pane: number): void {
    for (const key of [...this.rigs.keys()]) {
      if (key.startsWith(`${pane}:`)) this.rigs.delete(key);
    }
    this.invalidate();
  }

  private layoutPanes(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.editor.layout === "single") {
      this.panes = [{ x: 0, y: 0, w, h }];
    } else {
      const g = 2;
      const pw = (w - g) / 2;
      const ph = (h - g) / 2;
      // pane slots: [0]=TL [1]=TR [2]=BL [3]=BR
      this.panes = [
        { x: 0, y: 0, w: pw, h: ph },
        { x: pw + g, y: 0, w: pw, h: ph },
        { x: 0, y: ph + g, w: pw, h: ph },
        { x: pw + g, y: ph + g, w: pw, h: ph },
      ];
    }
  }

  // ---- rendering -----------------------------------------------------------

  private async renderFrame(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    this.layoutPanes();
    const logical = this.logicalPanes();
    const axesPerSlot: PaneAxes[] = [];
    this.sync.applyTargets();
    renderer.setScissorTest(true);
    for (let r = 0; r < this.panes.length; r++) {
      const p = this.panes[r]!;
      const i = logical[r]!;
      if (p.w < 2 || p.h < 2) continue;
      const rig = this.rigFor(i);
      rig.setAspect(p.w / p.h);
      this.syncSceneCamera(i, rig);
      // per-pane display settings
      const disp = this.editor.paneDisplay(i);
      this.grid.visible = disp.grid;
      renderer.shadowMap.enabled = disp.shading === "pbr" && disp.shadows;
      this.sync.applyShading(disp.shading, disp.backfaces);
      // logical pixels: the renderer multiplies by pixelRatio internally.
      // WebGPU's viewport origin is top-left; WebGL's is bottom-left.
      const yGL = this.backendName === "WebGPU" ? p.y : this.canvas.clientHeight - p.y - p.h;
      renderer.setViewport(p.x, yGL, p.w, p.h);
      renderer.setScissor(p.x, yGL, p.w, p.h);
      const activePane = i === this.editor.activePane && this.editor.layout === "quad";
      this.scene.background = new Color(activePane ? 0x12121a : 0x101014);
      const activeObj = this.activeObject();
      this.gizmo.update(rig.camera, activeObj, this.editor.gizmoSpace);
      this.handles.update(rig.camera, activeObj);
      this.sync.updateOutlines(rig.camera, p.h);
      axesPerSlot.push(this.projectAxes(rig));
      await renderer.renderAsync(this.scene, rig.camera);
    }
    this.onAxes?.(axesPerSlot);
    this.frames++;
  }

  /** World X/Y/Z in this pane's view space (for the corner axis indicator). */
  private projectAxes(rig: CameraRig): PaneAxes {
    const invQuat = rig.camera.quaternion.clone().invert();
    const project = (x: number, y: number, z: number): AxisProjection => {
      const v = new Vector3(x, y, z).applyQuaternion(invQuat);
      return { dx: v.x, dy: -v.y, front: v.z >= 0 };
    };
    return [project(1, 0, 0), project(0, 1, 0), project(0, 0, 1)];
  }

  /** Pane bound to a scene camera node: follow the node's transform (+target). */
  private syncSceneCamera(pane: number, rig: CameraRig): void {
    const cam = this.editor.paneCamera(pane);
    if ((BUILTINS as string[]).includes(cam)) return;
    const node = this.doc.scene.get(cam as Uuid);
    if (!node) return;
    rig.camera.position.set(
      node.transform.position[0],
      node.transform.position[1],
      node.transform.position[2],
    );
    rig.camera.rotation.set(
      node.transform.rotation[0],
      node.transform.rotation[1],
      node.transform.rotation[2],
    );
    const targetId = node.data?.target as Uuid | undefined;
    if (targetId) {
      const targetObj = this.sync.object(targetId);
      if (targetObj) rig.camera.lookAt(targetObj.getWorldPosition(new Vector3()));
    }
    rig.camera.updateMatrixWorld();
  }

  private tickStats(): void {
    const now = performance.now();
    if (now - this.lastStats > 500) {
      const fps = Math.round((this.frames * 1000) / (now - this.lastStats));
      this.frames = 0;
      this.lastStats = now;
      this.onStats?.({ fps, nodes: this.doc.scene.size, backend: this.backendName });
    }
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent || !this.renderer) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(w, h, true);
    this.invalidate();
  }

  // ---- framing -------------------------------------------------------------

  private selectionBox(): Box3 | null {
    const ids = this.doc.selection.objectIds;
    if (ids.length === 0) return null;
    const box = new Box3();
    let any = false;
    for (const id of ids) {
      const obj = this.sync.object(id);
      if (obj) {
        box.expandByObject(obj as Object3D);
        any = true;
      }
    }
    return any ? box : null;
  }

  private sceneBox(): Box3 {
    const box = new Box3();
    if (this.doc.scene.size > 0) box.expandByObject(this.sync.root);
    return box;
  }

  private frameBox(box: Box3 | null): void {
    if (!box || box.isEmpty()) return;
    this.rigFor(this.editor.activePane).frame(box);
    this.invalidate();
  }
}

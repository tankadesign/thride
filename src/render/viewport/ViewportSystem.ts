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

interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type NavMode = "orbit" | "pan" | "dolly" | null;

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

const BUILTINS: BuiltinCamera[] = ["persp", "top", "front", "right"];

/**
 * Owns the canvas: WebGPU renderer (WebGL2 fallback), 1-up/4-up scissored
 * panes, C4D navigation, picking, and the transform gizmo. No React in
 * here — ViewportPanel hosts it.
 */
export class ViewportSystem {
  private readonly canvas: HTMLCanvasElement;
  private readonly doc: Document;
  private readonly editor: EditorViewportState;
  private renderer: WebGPURenderer | null = null;
  private readonly scene = new Scene();
  private readonly sync: SceneSynchronizer;
  private readonly gizmo: TransformGizmo;
  private readonly handles: PrimitiveHandles;
  private rigs = new Map<string, CameraRig>(); // key: `${pane}:${camera}`
  private panes: PaneRect[] = [];
  private needsRender = true;
  private disposed = false;
  private rendering = false;
  private renderKick: number | null = null;
  private nav: {
    mode: NavMode;
    pane: number;
    lastX: number;
    lastY: number;
    pivot: Vector3 | null;
  } | null = null;
  private mmbClick: { x: number; y: number; pane: number } | null = null;
  /** Canvas-relative 2D position of the active nav pivot marker (the "+"). */
  onNavMarker: ((pos: { x: number; y: number } | null) => void) | null = null;
  /** Axis-indicator data per visible pane slot, published every rendered frame. */
  onAxes: ((axes: PaneAxes[]) => void) | null = null;
  private raycaster = new Raycaster();
  private resizeObserver: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private frames = 0;
  private lastStats = performance.now();
  onStats: ((s: ViewportStats) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, doc: Document, editor: EditorViewportState) {
    this.canvas = canvas;
    this.doc = doc;
    this.editor = editor;

    this.scene.background = new Color(0x101014);
    const grid = new GridHelper(40, 40, 0x333340, 0x22222a);
    grid.position.y = -0.001;
    this.scene.add(grid);
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

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);

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

  dispose(): void {
    this.disposed = true;
    if (this.renderKick !== null) window.clearTimeout(this.renderKick);
    for (const u of this.unsubs) u();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    this.sync.dispose();
    this.renderer?.dispose();
  }

  // ---- rendering ---------------------------------------------------------

  /** Logical pane index shown in each rect (single layout shows the maximized pane). */
  private logicalPanes(): number[] {
    return this.editor.layout === "single" ? [this.editor.maximizedPane] : [0, 1, 2, 3];
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
      // panes: 0 persp default TL? order: [0]=TL [1]=TR [2]=BL [3]=BR
      this.panes = [
        { x: 0, y: 0, w: pw, h: ph },
        { x: pw + g, y: 0, w: pw, h: ph },
        { x: 0, y: ph + g, w: pw, h: ph },
        { x: pw + g, y: ph + g, w: pw, h: ph },
      ];
    }
  }

  private rigFor(pane: number): CameraRig {
    const cam = this.editor.paneCamera(pane);
    const builtin: BuiltinCamera = (BUILTINS as string[]).includes(cam)
      ? (cam as BuiltinCamera)
      : "persp";
    const key = `${pane}:${builtin}`;
    let rig = this.rigs.get(key);
    if (!rig) {
      rig = new CameraRig(builtin);
      this.rigs.set(key, rig);
    }
    return rig;
  }

  private async renderFrame(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    this.layoutPanes();
    const logical = this.logicalPanes();
    const axesPerSlot: PaneAxes[] = [];
    renderer.setScissorTest(true);
    for (let r = 0; r < this.panes.length; r++) {
      const p = this.panes[r]!;
      const i = logical[r]!;
      if (p.w < 2 || p.h < 2) continue;
      const rig = this.rigFor(i);
      rig.setAspect(p.w / p.h);
      this.syncSceneCamera(i, rig);
      // logical pixels: the renderer multiplies by pixelRatio internally.
      // WebGPU's viewport origin is top-left; WebGL's is bottom-left.
      const yGL = this.backendName === "WebGPU" ? p.y : this.canvas.clientHeight - p.y - p.h;
      renderer.setViewport(p.x, yGL, p.w, p.h);
      renderer.setScissor(p.x, yGL, p.w, p.h);
      const activePane = i === this.editor.activePane && this.editor.layout === "quad";
      this.scene.background = new Color(activePane ? 0x12121a : 0x101014);
      const activeObj = this.doc.selection.active
        ? (this.sync.object(this.doc.selection.active) ?? null)
        : null;
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

  /** Pane bound to a scene camera node: follow the node's transform. */
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

  // ---- input ---------------------------------------------------------------

  /** Logical pane index under a canvas point. */
  private paneAt(x: number, y: number): number {
    this.layoutPanes();
    const logical = this.logicalPanes();
    for (let r = 0; r < this.panes.length; r++) {
      const p = this.panes[r]!;
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return logical[r]!;
    }
    return logical[0]!;
  }

  private setRayFromEvent(e: PointerEvent | MouseEvent, pane: number): CameraRig {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const p = this.panes[this.logicalPanes().indexOf(pane)] ?? this.panes[0]!;
    const ndc = new Vector2(((x - p.x) / p.w) * 2 - 1, -(((y - p.y) / p.h) * 2 - 1));
    const rig = this.rigFor(pane);
    this.raycaster.setFromCamera(ndc, rig.camera);
    return rig;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pane = this.paneAt(x, y);
    this.editor.setActivePane(pane);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/test events have no active pointer — capture is best-effort
    }

    if (!e.altKey && e.button === 1) {
      // MMB click (no drag): maximize pane / back to 4-up — armed until movement
      this.mmbClick = { x: e.clientX, y: e.clientY, pane };
      e.preventDefault();
      return;
    }

    if (e.altKey) {
      const mode: NavMode =
        e.button === 0 ? "orbit" : e.button === 1 ? "pan" : e.button === 2 ? "dolly" : null;
      let pivot: Vector3 | null = null;
      let marker = { x, y };
      if (mode === "orbit") {
        // C4D: orbit around the point under the cursor; empty click orbits
        // the viewport center (no view jump either way — free-camera rig)
        const rig = this.setRayFromEvent(e, pane);
        if (rig.isPerspective) {
          const hit = this.raycaster.intersectObject(this.sync.root, true)[0];
          pivot = rig.beginOrbitPivot(hit?.point ?? null);
          if (!hit) {
            // marker sits where the pivot actually is: the pane center
            const rect = this.panes[this.logicalPanes().indexOf(pane)] ?? this.panes[0]!;
            marker = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
          }
        }
      }
      this.nav = { mode, pane, lastX: e.clientX, lastY: e.clientY, pivot };
      this.onNavMarker?.(marker);
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      this.setRayFromEvent(e, pane);
      // primitive adjustment handles take priority over the gizmo
      const activeObj = this.doc.selection.active
        ? (this.sync.object(this.doc.selection.active) ?? null)
        : null;
      if (this.handles.pointerDown(this.raycaster, activeObj)) {
        this.invalidate();
        return;
      }
      if (this.gizmo.pointerDown(this.raycaster)) {
        this.invalidate();
        return;
      }
      // click select
      const hit = this.raycaster.intersectObject(this.sync.root, true)[0];
      const nodeId = hit ? this.sync.nodeIdOf(hit.object) : null;
      if (nodeId) {
        const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
        this.doc.selection.selectObjects([nodeId], op);
      } else if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        this.doc.selection.clearObjects();
      }
      this.invalidate();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.mmbClick) {
      const moved = Math.hypot(e.clientX - this.mmbClick.x, e.clientY - this.mmbClick.y);
      if (moved > 4) this.mmbClick = null; // became a drag, not a click
    }
    if (this.nav?.mode) {
      const dx = e.clientX - this.nav.lastX;
      const dy = e.clientY - this.nav.lastY;
      this.nav.lastX = e.clientX;
      this.nav.lastY = e.clientY;
      const rig = this.rigFor(this.nav.pane);
      const rect = this.panes[this.logicalPanes().indexOf(this.nav.pane)] ?? this.panes[0]!;
      if (this.nav.mode === "orbit" && this.nav.pivot) rig.orbitAround(this.nav.pivot, dx, dy);
      if (this.nav.mode === "pan") rig.pan(dx, dy, rect.h);
      if (this.nav.mode === "dolly") rig.dolly(dy * 2.5);
      this.invalidate();
      return;
    }
    if (this.handles.isDragging) {
      this.setRayFromEvent(e, this.editor.activePane);
      this.handles.pointerMove(this.raycaster);
      this.invalidate();
      return;
    }
    if (this.gizmo.isDragging) {
      this.setRayFromEvent(e, this.editor.activePane);
      this.gizmo.pointerMove(this.raycaster, {
        uniformScale: e.shiftKey,
        snap: e.shiftKey,
        snapSize: this.editor.gridSnapSize,
      });
      this.invalidate();
      return;
    }
    // hover feedback: handles win over gizmo (matching pick priority)
    const rect = this.canvas.getBoundingClientRect();
    const pane = this.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.setRayFromEvent(e, pane);
    this.handles.updateHover(this.raycaster);
    this.gizmo.updateHover(this.raycaster);
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // see setPointerCapture note
    }
    if (this.mmbClick && e.button === 1) {
      const pane = this.mmbClick.pane;
      this.mmbClick = null;
      this.editor.toggleMaximize(pane);
      this.invalidate();
      return;
    }
    if (this.nav) {
      this.nav = null;
      this.onNavMarker?.(null);
      return;
    }
    if (this.handles.isDragging) {
      this.handles.pointerUp();
      this.invalidate();
      return;
    }
    if (this.gizmo.isDragging) {
      this.gizmo.pointerUp();
      this.invalidate();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const pane = this.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.rigFor(pane).dolly(e.deltaY * 1.2);
    this.invalidate();
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this.handles.isDragging) {
      this.handles.cancelDrag();
      this.invalidate();
    } else if (this.gizmo.isDragging) {
      this.gizmo.cancelDrag();
      this.invalidate();
    }
  };

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

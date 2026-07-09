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
} from "three";
import { WebGPURenderer } from "three/webgpu";
import type { Document } from "@/core";
import type { Uuid } from "@/types/core";
import type { BuiltinCamera, EditorState } from "@/ui/state/EditorState";
import { TransformGizmo } from "@/render/gizmo/TransformGizmo";
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

const BUILTINS: BuiltinCamera[] = ["persp", "top", "front", "right"];

/**
 * Owns the canvas: WebGPU renderer (WebGL2 fallback), 1-up/4-up scissored
 * panes, C4D navigation, picking, and the transform gizmo. No React in
 * here — ViewportPanel hosts it.
 */
export class ViewportSystem {
  private readonly canvas: HTMLCanvasElement;
  private readonly doc: Document;
  private readonly editor: EditorState;
  private renderer: WebGPURenderer | null = null;
  private readonly scene = new Scene();
  private readonly sync: SceneSynchronizer;
  private readonly gizmo: TransformGizmo;
  private rigs = new Map<string, CameraRig>(); // key: `${pane}:${camera}`
  private panes: PaneRect[] = [];
  private needsRender = true;
  private disposed = false;
  private rendering = false;
  private nav: { mode: NavMode; pane: number; lastX: number; lastY: number } | null = null;
  private raycaster = new Raycaster();
  private resizeObserver: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private frames = 0;
  private lastStats = performance.now();
  onStats: ((s: ViewportStats) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, doc: Document, editor: EditorState) {
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

    this.unsubs.push(editor.subscribe(() => this.invalidate()));

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

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
    const loop = async () => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      if (!this.needsRender || this.rendering || !this.renderer) return;
      this.needsRender = false;
      this.rendering = true;
      try {
        await this.renderFrame();
      } finally {
        this.rendering = false;
      }
      this.tickStats();
    };
    requestAnimationFrame(loop);
    this.invalidate();
  }

  invalidate(): void {
    this.needsRender = true;
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
    renderer.setScissorTest(true);
    for (let i = 0; i < this.panes.length; i++) {
      const p = this.panes[i]!;
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
      this.gizmo.update(rig.camera);
      await renderer.renderAsync(this.scene, rig.camera);
    }
    this.frames++;
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

  private paneAt(x: number, y: number): number {
    this.layoutPanes();
    for (let i = 0; i < this.panes.length; i++) {
      const p = this.panes[i]!;
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return i;
    }
    return 0;
  }

  private setRayFromEvent(e: PointerEvent | MouseEvent, pane: number): CameraRig {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const p = this.panes[pane]!;
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

    if (e.altKey) {
      const mode: NavMode =
        e.button === 0 ? "orbit" : e.button === 1 ? "pan" : e.button === 2 ? "dolly" : null;
      if (mode === "orbit") {
        // C4D: orbit around the point under the cursor
        const rig = this.setRayFromEvent(e, pane);
        if (rig.isPerspective) {
          const hit = this.raycaster.intersectObject(this.sync.root, true)[0];
          if (hit) rig.setPivotKeepingView(hit.point);
        }
      }
      this.nav = { mode, pane, lastX: e.clientX, lastY: e.clientY };
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      const rig = this.setRayFromEvent(e, pane);
      void rig;
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
    if (this.nav?.mode) {
      const dx = e.clientX - this.nav.lastX;
      const dy = e.clientY - this.nav.lastY;
      this.nav.lastX = e.clientX;
      this.nav.lastY = e.clientY;
      const rig = this.rigFor(this.nav.pane);
      const pane = this.panes[this.nav.pane]!;
      if (this.nav.mode === "orbit") rig.orbit(dx, dy);
      if (this.nav.mode === "pan") rig.pan(dx, dy, pane.h);
      if (this.nav.mode === "dolly") rig.dolly(dy * 2.5);
      this.invalidate();
      return;
    }
    if (this.gizmo.isDragging) {
      this.setRayFromEvent(e, this.editor.activePane);
      this.gizmo.pointerMove(this.raycaster);
      this.invalidate();
      return;
    }
    // hover feedback on gizmo handles
    const rect = this.canvas.getBoundingClientRect();
    const pane = this.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.setRayFromEvent(e, pane);
    this.gizmo.updateHover(this.raycaster);
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // see setPointerCapture note
    }
    if (this.nav) {
      this.nav = null;
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
    if (e.key === "Escape" && this.gizmo.isDragging) {
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

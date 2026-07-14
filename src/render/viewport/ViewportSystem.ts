import {
  AmbientLight,
  Box3,
  NoToneMapping,
  DirectionalLight,
  GridHelper,
  Object3D,
  PCFShadowMap,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { DitherOutput, type OutputToneMapping } from "./ditherOutput";
import { EnvironmentSync } from "@/render/environment/EnvironmentSync";
import type { Document } from "@/core";
import type { Uuid } from "@/types/core";
import type { BuiltinCamera, EditorViewportState } from "@/types/editor";
import { TransformGizmo } from "@/render/gizmo/TransformGizmo";
import { PrimitiveHandles } from "@/render/handles/PrimitiveHandles";
import { applyCameraHelperTheme } from "@/render/helpers/CameraHelper";
import { applyLightHelperTheme } from "@/render/helpers/LightHelpers";
import { CameraRig } from "@/render/nav/CameraRig";
import { ComponentOverlays } from "@/render/overlays/ComponentOverlays";
import { applyMeshMaterialsTheme, SceneSynchronizer } from "@/render/scene-sync/SceneSynchronizer";
import { applySplineTheme, applySplineThickness } from "@/render/scene-sync/SplineSync";
import { projectAxes, sceneBox, selectionBox } from "./viewportFraming";
import { refreshViewportTheme, viewportTheme } from "@/render/theme/viewportTheme";
import { SplineOverlays } from "@/render/overlays/SplineOverlays";
import { type AmountKind, AmountTool } from "@/render/tools/AmountTool";
import { BevelTool } from "@/render/tools/BevelTool";
import { PenTool } from "@/render/tools/PenTool";
import { SplineEditTool } from "@/render/tools/SplineEditTool";
import { WeldTool } from "@/render/tools/WeldTool";
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
  readonly overlays: ComponentOverlays;
  readonly weldTool: WeldTool;
  readonly bevelTool: BevelTool;
  readonly penTool: PenTool;
  readonly splineEdit: SplineEditTool;
  readonly splineOverlays: SplineOverlays;
  /** Active Blender-style modal (extrude/inset amount drag), or null. */
  modalTool: AmountTool | null = null;
  readonly raycaster = new Raycaster();
  private renderer: WebGPURenderer | null = null;
  private output: DitherOutput | null = null;
  private readonly scene = new Scene();
  private readonly envSync: EnvironmentSync;
  private grid: GridHelper;
  private readonly defaultAmbient: AmbientLight;
  private readonly defaultKey: DirectionalLight;
  private readonly defaultFill: DirectionalLight;
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
  /** Canvas-relative 2D position of the active magnet snap marker, or null. */
  onSnapMarker: ((pos: { x: number; y: number } | null) => void) | null = null;
  /** Axis-indicator data per visible pane slot, published every rendered frame. */
  onAxes: ((axes: PaneAxes[]) => void) | null = null;
  /** Right-click: UI layer opens the matching context menu. */
  onContextMenuRequest: ((req: ViewportContextRequest) => void) | null = null;
  onStats: ((s: ViewportStats) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, doc: Document, editor: EditorViewportState) {
    this.canvas = canvas;
    this.doc = doc;
    this.editor = editor;
    // spline nodes are Line2 (wide lines): px pick pad on top of linewidth
    this.raycaster.params.Line = { threshold: 0.08 };
    (this.raycaster.params as { Line2?: { threshold: number } }).Line2 = { threshold: 6 };

    this.scene.background = viewportTheme.backgroundColor.clone();
    this.grid = this.buildGrid();
    this.scene.add(this.grid);
    // fallback lighting rig — disabled once the document supplies its own
    // lights (or, later, an environment), so scenes aren't double-lit.
    this.defaultAmbient = new AmbientLight(viewportTheme.lightAmbientColor, 0.35);
    this.scene.add(this.defaultAmbient);
    this.defaultKey = new DirectionalLight(viewportTheme.lightKeyColor, 2.2);
    this.defaultKey.position.set(5, 8, 4);
    this.scene.add(this.defaultKey);
    this.defaultFill = new DirectionalLight(viewportTheme.lightFillColor, 0.6);
    this.defaultFill.position.set(-6, 3, -5);
    this.scene.add(this.defaultFill);
    // IBL + background from the document's environment (studio default). The
    // sync sets scene.environment/intensity/rotation and exposes the background
    // value the per-pane clear uses below.
    this.envSync = new EnvironmentSync(this.scene, doc, () => this.invalidate());

    this.sync = new SceneSynchronizer(doc, () => this.invalidate());
    this.scene.add(this.sync.root);
    this.gizmo = new TransformGizmo(doc);
    this.scene.add(this.gizmo.group);
    this.handles = new PrimitiveHandles(doc);
    this.scene.add(this.handles.group);
    this.overlays = new ComponentOverlays(doc, this.sync);
    this.scene.add(this.overlays.group);
    this.weldTool = new WeldTool(this);
    this.scene.add(this.weldTool.group);
    this.bevelTool = new BevelTool(this);
    this.penTool = new PenTool(this);
    this.scene.add(this.penTool.group);
    this.splineEdit = new SplineEditTool(this);
    this.splineOverlays = new SplineOverlays(doc, this.sync);
    this.scene.add(this.splineOverlays.group);

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

  /** 40×40 world-unit floor grid, colored from the viewport theme. */
  private buildGrid(): GridHelper {
    const grid = new GridHelper(40, 40, viewportTheme.gridLineColor, viewportTheme.gridCellColor);
    grid.position.y = -0.001;
    return grid;
  }

  /**
   * Re-resolve semantic theme colors from CSS and push every color into the
   * live scene chrome (background is read per-frame; grid, lights and the
   * shared mesh materials are updated here). Call after the daisyUI theme
   * changes or a user edits a viewport color.
   */
  applyTheme(): void {
    refreshViewportTheme();
    applyMeshMaterialsTheme();
    applySplineTheme(this.scene);
    applyLightHelperTheme();
    applyCameraHelperTheme();
    this.gizmo.applyTheme();
    this.handles.applyTheme();
    this.overlays.applyTheme();
    this.defaultAmbient.color.copy(viewportTheme.lightAmbientColor);
    this.defaultKey.color.copy(viewportTheme.lightKeyColor);
    this.defaultFill.color.copy(viewportTheme.lightFillColor);
    this.scene.remove(this.grid);
    this.grid.dispose();
    this.grid = this.buildGrid();
    this.scene.add(this.grid);
    this.invalidate();
  }

  /** Spline Thickness setting (screen px) — updates every spline's own material. */
  setSplineThickness(px: number): void {
    applySplineThickness(px, this.scene);
    this.invalidate();
  }

  private async init(): Promise<void> {
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true });
    // PCF (Vogel-disk) shadows — soft edges whose softness follows the light's
    // Blur (shadow.radius). PCFSoft ignores radius, so the Blur control would be
    // inert under it; PCF reads radius as a live uniform so blur updates live.
    renderer.shadowMap.type = PCFShadowMap;
    await renderer.init();
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    this.renderer = renderer;
    this.output = new DitherOutput(renderer);
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
    this.frameBox(selectionBox(this) ?? sceneBox(this));
  }

  frameAll(): void {
    this.frameBox(sceneBox(this));
  }

  get backendName(): string {
    // biome-ignore lint/suspicious/noExplicitAny: backend introspection
    const backend = (this.renderer as any)?.backend;
    return backend?.isWebGPUBackend ? "WebGPU" : this.renderer ? "WebGL2" : "…";
  }

  /** Start the extrude/inset modal on the current polygon selection. */
  beginAmountTool(kind: AmountKind): void {
    if (this.modalTool) return;
    this.modalTool = AmountTool.begin(this, kind);
    this.invalidate();
  }

  /** Arm the live edge-bevel tool on the current edge selection. */
  beginBevelTool(): void {
    if (this.bevelTool.isActive) return;
    this.bevelTool.begin();
  }

  /** Bake the live bevel if one is running (called before mode/tool switches). */
  commitBevelIfActive(): void {
    if (this.bevelTool.isActive) this.bevelTool.commit();
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
    this.envSync.dispose();
    this.output?.dispose();
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

  /** Uuid of the visible mesh node under the cursor (for material drag-drop), or null. */
  pickNode(e: MouseEvent): Uuid | null {
    const rect = this.canvas.getBoundingClientRect();
    const pane = this.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.setRayFromEvent(e, pane);
    for (const h of this.raycaster.intersectObject(this.sync.root, true)) {
      const id = this.sync.visibleNodeIdOf(h.object);
      if (id) return id;
    }
    return null;
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

  // Active-camera nav writeback lives in ./cameraNavWriteback (500-line rule).

  /** Uuid of the scene camera node a pane is bound to, or null if it's a builtin. */
  sceneCameraNode(pane: number): Uuid | null {
    const cam = this.editor.paneCamera(pane);
    if ((BUILTINS as string[]).includes(cam)) return null;
    return this.doc.scene.get(cam as Uuid) ? (cam as Uuid) : null;
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
    // the document's own lights (or, later, an environment) replace the fallback rig
    const showDefaultLights = !this.sync.hasLights;
    this.defaultAmbient.visible = showDefaultLights;
    this.defaultKey.visible = showDefaultLights;
    this.defaultFill.visible = showDefaultLights;
    // pass 1: render every pane into the LINEAR half-float buffer. Tone
    // mapping is deferred to the composite, where a display-space dither
    // dissolves the 8-bit banding that plain output quantization causes.
    const output = this.output!;
    const pr = renderer.getPixelRatio();
    // Screen-Space Reflections: single-pane + PBR only. When on, the scene
    // render moves INTO the composite's node graph (a pass() with an MRT
    // G-buffer feeds SSRNode), so pass 1 skips the manual hdr blit for the
    // active pane and lets output.render() draw the scene.
    const activeDisp = this.editor.paneDisplay(this.editor.activePane);
    const ssrActive =
      activeDisp.ssr && activeDisp.shading === "pbr" && this.editor.layout === "single";
    if (!ssrActive) {
      renderer.setRenderTarget(output.hdr);
      renderer.setScissorTest(true);
    }
    renderer.toneMapping = NoToneMapping;
    // Every pane renders into the SAME hdr target. In WebGPU a render pass's
    // clear (loadOp) wipes the WHOLE attachment — scissor never limits it — so
    // clearing per pane erases the panes already drawn, leaving only the last
    // (the 4-up "only one view renders" bug). Clear the whole target ONCE on the
    // first pane; the rest preserve. A background COLOR forces a clear even when
    // autoClear is false (three's forceClear), so ONLY the first pane gets one —
    // later panes use a null background so their loadOp is Load and they keep the
    // already-drawn panes. (A per-pane active tint can't survive this.)
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
      this.sync.applyShading(disp.shading, disp.backfaces, disp.lines, disp.hiddenLines);
      // the HDR target lives in DEVICE pixels (no implicit pixelRatio scale
      // like the canvas). WebGPU origin is top-left; WebGL bottom-left.
      const yGL = this.backendName === "WebGPU" ? p.y * pr : output.hdr.height - (p.y + p.h) * pr;
      if (!ssrActive) {
        // three reads the viewport/scissor from the RENDER TARGET (not from
        // renderer.setViewport/setScissor) when drawing into one — with the
        // target's own pixelRatio of 1. So per-pane sub-rects MUST live on
        // output.hdr, or every pane fills the whole target and only the last
        // survives (the 4-up "only one view renders" bug). scissorTest stays on
        // the renderer (that flag IS read from it).
        output.hdr.viewport.set(p.x * pr, yGL, p.w * pr, p.h * pr);
        output.hdr.scissor.set(p.x * pr, yGL, p.w * pr, p.h * pr);
        // first pane clears the whole hdr (color+depth) using the environment's
        // background (solid color / env map / none); later panes preserve it —
        // null background so a Color doesn't force-clear their region
        this.scene.background = r === 0 ? this.envSync.background : null;
        renderer.autoClear = r === 0;
      } else {
        // SSR: the pass() node renders the scene and clears to the background.
        this.scene.background = this.envSync.background;
      }
      const activeObj = this.activeObject();
      // the extrude/inset modal and the live bevel drive their own drag — hide
      // the gizmo so it doesn't fight them
      if (this.modalTool || this.bevelTool.isActive) this.gizmo.group.visible = false;
      else this.gizmo.update(rig.camera, activeObj, this.editor.gizmoSpace);
      this.handles.update(rig.camera, activeObj);
      this.overlays.update(rig.camera, p.h);
      this.splineOverlays.update(rig.camera, p.h);
      this.sync.updateOutlines(rig.camera, p.h);
      this.sync.updateHelperBillboards(rig.camera, p.h);
      axesPerSlot.push(projectAxes(rig));
      // SSR draws the scene in the composite (output.render → pass node); the
      // manual blit is skipped for the active pane.
      if (!ssrActive) await renderer.renderAsync(this.scene, rig.camera);
    }
    renderer.autoClear = true; // restore for the composite pass / next frame
    // pass 2: tone-map + dither the HDR buffer onto the canvas. One tone
    // mapping for the whole canvas — the active pane's (quad panes with mixed
    // tone-mapping is a rare case; single-pane, the common one, is exact).
    renderer.setScissorTest(false);
    renderer.setRenderTarget(null);
    // pass 1 left the viewport in DEVICE pixels (render targets aren't scaled by
    // pixelRatio). The canvas composite IS scaled by pixelRatio, so reset to the
    // LOGICAL full-canvas size or the quad renders into a 2×-oversized viewport
    // on retina — showing only a low-res quarter of the frame (and mis-picking).
    const logicalSize = renderer.getSize(new Vector2());
    renderer.setViewport(0, 0, logicalSize.x, logicalSize.y);
    const mode: OutputToneMapping = activeDisp.shading === "pbr" ? activeDisp.toneMapping : "none";
    output.setToneMapping(mode);
    const activeCamera = this.rigFor(this.editor.activePane).camera;
    // Ambient Shadows (GTAO): single-pane, PBR or Flat (Flat gives a GTAO-only
    // look) — wireframe has no surfaces to occlude. GTAO reconstructs from the
    // active camera, so a shared pass would corrupt the other quad panes.
    const aoOn =
      activeDisp.ssao && activeDisp.shading !== "wireframe" && this.editor.layout === "single";
    output.setAmbientShadows(
      aoOn ? activeCamera : null,
      aoOn
        ? {
            radius: activeDisp.aoRadius,
            bias: activeDisp.aoBias,
            tint: activeDisp.aoTint,
            samples: activeDisp.aoSamples,
            falloff: activeDisp.aoFalloff,
            distanceExp: activeDisp.aoDistanceExp,
            scale: activeDisp.aoScale,
            resolution: activeDisp.aoResolution,
          }
        : null,
    );
    // Screen-Space Reflections — set AFTER AO so the (possibly) rebuilt graph
    // sees the current AO state. `ssrActive` already encodes single-pane + PBR.
    output.setScreenReflections(
      ssrActive ? this.scene : null,
      ssrActive ? activeCamera : null,
      ssrActive
        ? {
            maxDistance: activeDisp.ssrMaxDistance,
            thickness: activeDisp.ssrThickness,
            intensity: activeDisp.ssrIntensity,
            quality: activeDisp.ssrQuality,
            blurQuality: activeDisp.ssrBlurQuality,
            edgeFade: activeDisp.ssrEdgeFade,
            maxLuminance: activeDisp.ssrMaxLuminance,
            resolution: activeDisp.ssrResolution,
            reflectNonMetals: activeDisp.ssrReflectNonMetals,
            roughnessFade: activeDisp.ssrRoughnessFade,
          }
        : null,
    );
    output.render();
    this.onAxes?.(axesPerSlot);
    this.frames++;
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
    const pr = this.renderer.getPixelRatio();
    this.output?.resize(w * pr, h * pr); // HDR target lives in device pixels
    this.invalidate();
  }

  private frameBox(box: Box3 | null): void {
    if (!box || box.isEmpty()) return;
    this.rigFor(this.editor.activePane).frame(box);
    this.invalidate();
  }
}

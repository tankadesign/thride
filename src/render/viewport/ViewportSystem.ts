import {
  AmbientLight,
  Box3,
  Camera,
  NoToneMapping,
  DirectionalLight,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { DitherOutput, type DofParams, type OutputToneMapping } from "./ditherOutput";
import { ssrEnvironmentTexture } from "@/render/environment/defaultHdr";
import { EnvironmentSync } from "@/render/environment/EnvironmentSync";
import { HELPER_LAYER } from "@/render/layers";
import type { Document } from "@/core";
import type { Uuid } from "@/types/core";
import { type CameraDataDTO, defaultCameraData } from "@/types/core/camera";
import type { BuiltinCamera, EditorViewportState } from "@/types/editor";
import { TransformGizmo } from "@/render/gizmo/TransformGizmo";
import type { ProjectionTarget } from "@/render/gizmo/projectionDrag";
import { PrimitiveHandles } from "@/render/handles/PrimitiveHandles";
import { applyCameraHelperTheme } from "@/render/helpers/CameraHelper";
import { applyLightHelperTheme } from "@/render/helpers/LightHelpers";
import { InfiniteGrid } from "@/render/grid/InfiniteGrid";
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

/**
 * How long (ms) to keep the on-demand loop rendering after a generator's async
 * geometry arrives, so a WebGPU pipeline that compiles a few frames late still
 * redraws the mesh. Covers slower machines where compilation misses the first
 * frame; only ever armed on the rare geometry-arrival event, never per edit.
 */
const BURST_MS = 400;

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
  private readonly grid: InfiniteGrid;
  private readonly defaultAmbient: AmbientLight;
  private readonly defaultKey: DirectionalLight;
  private readonly defaultFill: DirectionalLight;
  private readonly input: ViewportInput;
  private rigs = new Map<string, CameraRig>(); // key: `${pane}:${camera}`
  private panes: PaneRect[] = [];
  /** Interaction-helper roots (gizmo/handles/overlays/tools) — see HELPER_LAYER. */
  private helperRoots: Object3D[] = [];
  private needsRender = true;
  private disposed = false;
  private rendering = false;
  private renderKick: number | null = null;
  private resizeObserver: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private frames = 0;
  private lastStats = performance.now();
  // Converge-then-idle accumulation for temporal SSR (High): `accumFrame` counts
  // frames since the last change and `accumTarget` is how many to render before
  // idling (0 = pure on-demand — every non-temporal path is unchanged). The SSR/
  // reproject/denoise nodes self-manage their own frame counters via updateBefore.
  private accumFrame = 0;
  private accumTarget = 0;
  /** Tone mapping of the last focused PBR pane — inherited by non-shaded
   *  (wireframe/flat) panes so focusing one doesn't shift the whole canvas. */
  private lastPbrToneMapping: OutputToneMapping | null = null;
  /** `performance.now()` deadline for the post-geometry render burst (see {@link invalidate}). */
  private burstUntil = 0;
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
    this.grid = new InfiniteGrid();
    this.scene.add(this.grid.object);
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

    this.sync = new SceneSynchronizer(doc, (burst) => this.invalidate(burst));
    this.scene.add(this.sync.root);
    this.gizmo = new TransformGizmo(doc, (id) => this.sync.object(id));
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
    // Interaction helpers live on their own layer so scene renders exclude
    // them — SSR rays and planar-reflector mirrors must not reflect the gizmo.
    // They're drawn by a dedicated overlay render per frame (see renderFrame);
    // picking needs enableAll because Raycaster defaults to layer 0 only.
    this.helperRoots = [
      this.gizmo.group,
      this.handles.group,
      this.overlays.group,
      this.weldTool.group,
      this.penTool.group,
      this.splineOverlays.group,
    ];
    this.raycaster.layers.enableAll();

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
    this.grid.applyTheme();
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
    // E3 hitch-free swap: compile a replacement procedural material's pipeline
    // off the critical path. `compileAsync(probe, camera, scene)` is three's own
    // compile-a-single-object form — the probe is never in the scene, so it
    // creates the pipeline without ever drawing; the scene supplies the lights.
    this.sync.setMaterialWarm(async (mat, matId) => {
      const probe = this.sync.warmProbe(matId, mat);
      if (!probe) return;
      await renderer.compileAsync(probe, this.rigFor(this.editor.activePane).camera, this.scene);
    });
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
    if (this.rendering || !this.renderer) return;
    // Render when dirty OR while still converging a temporal-SSR burst OR while
    // a post-geometry burst window is open. When temporal SSR is off and no
    // burst is pending, accumTarget is 0, so this is pure on-demand.
    if (
      !this.needsRender &&
      this.accumFrame >= this.accumTarget &&
      performance.now() >= this.burstUntil
    )
      return;
    this.needsRender = false;
    this.rendering = true;
    try {
      await this.renderFrame();
    } finally {
      this.rendering = false;
    }
    this.tickStats();
  }

  invalidate(burst = false): void {
    this.needsRender = true;
    this.accumFrame = 0; // any change restarts temporal convergence
    // Secondary safeguard for async generator geometry (a boolean's Manifold
    // worker result on load). SceneSynchronizer already forces the stale
    // pipeline to rebuild (material.needsUpdate) when the real geometry swaps in
    // over the empty placeholder — that's the actual fix for the "boolean
    // vanishes on reload" bug. But WebGPU may compile the rebuilt pipeline in
    // the background and SKIP the mesh on the frame it isn't ready; a single
    // on-demand frame would then still miss it (machine-dependent). Holding the
    // loop rendering for a short window guarantees whichever frame the pipeline
    // finishes on redraws the mesh.
    if (burst) this.burstUntil = performance.now() + BURST_MS;
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

  /** Key identifying the currently-armed projection target (framing debounce). */
  private lastProjectionKey: string | null = null;

  /**
   * Texture mode: the material-channel projection the gizmo edits, anchored on
   * a scene object using the material — the current selection if it does, else
   * the first object the material is assigned to. Null outside Texture mode.
   */
  private projectionGizmoTarget(): ProjectionTarget | null {
    const t = this.editor.projectionEditTarget;
    if (!t || this.doc.selection.editMode !== "texture") return null;
    const sel = this.doc.selection.active;
    let object: Object3D | null = null;
    if (sel && (this.doc.scene.get(sel)?.data?.material as Uuid | undefined) === t.materialId) {
      object = this.sync.object(sel) ?? null;
    }
    object ??= this.sync.objectForMaterial(t.materialId);
    if (!object) return null;
    return { materialId: t.materialId, channel: t.textureChannel, object };
  }

  /**
   * Resolve the Texture-mode gizmo target and, the first time it arms (or its
   * object changes), frame that object in the active pane if it isn't already
   * in view — so the projection is always reachable. One-shot per target: no
   * reframing every frame, and never mid-drag.
   */
  private syncProjectionGizmo(camera: Camera): ProjectionTarget | null {
    const target = this.projectionGizmoTarget();
    const key = target ? `${target.materialId}:${target.channel}:${target.object.uuid}` : null;
    if (
      key &&
      key !== this.lastProjectionKey &&
      !this.gizmo.isDragging &&
      !this.objectInView(target!.object, camera)
    ) {
      this.frameBox(new Box3().setFromObject(target!.object));
    }
    this.lastProjectionKey = key;
    return target;
  }

  /** True when the object's origin projects inside the camera's NDC frustum. */
  private objectInView(object: Object3D, camera: Camera): boolean {
    object.updateWorldMatrix(true, false);
    const p = new Vector3().setFromMatrixPosition(object.matrixWorld).project(camera);
    return p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
  }

  /** A drag/modal is mid-flight — used to gate gizmo-mode key commands. */
  get inputBusy(): boolean {
    return this.input.isBusy();
  }

  dispose(): void {
    this.disposed = true;
    if (this.renderKick !== null) window.clearTimeout(this.renderKick);
    for (const u of this.unsubs) u();
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.sync.dispose();
    this.envSync.dispose();
    this.grid.dispose();
    this.output?.dispose();
    this.renderer?.dispose();
  }

  // ---- panes & rays --------------------------------------------------------

  /** Logical pane index shown in each rect (single layout shows the maximized pane). */
  logicalPanes(): number[] {
    return this.editor.layout === "single" ? [this.editor.maximizedPane] : [0, 1, 2, 3];
  }

  /** Tone mapping for a non-shaded active pane before any PBR pane has been
   *  focused: the first visible PBR pane's, else "none". */
  private fallbackPaneToneMapping(): OutputToneMapping {
    for (const pane of this.logicalPanes()) {
      const d = this.editor.paneDisplay(pane);
      if (d.shading === "pbr") return d.toneMapping;
    }
    return "none";
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
    // 4-up: the render loop re-fits the gizmo/handles PER PANE, so after a
    // frame they hold the LAST pane's screen-constant scale — picking in any
    // other pane (the perspective one, typically) then misses what that pane
    // actually displays. Re-fit them to THIS pane's camera before the ray is
    // used. Skip mid-drag: drags work off state captured at pointer-down, and
    // the render loop keeps visuals in sync.
    if (!this.gizmo.isDragging && !this.handles.isDragging) {
      if (!this.modalTool && !this.bevelTool.isActive) {
        this.gizmo.update(rig.camera, this.activeObject(), this.editor.gizmoSpace);
      }
      this.handles.update(rig.camera, this.activeObject());
    }
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

  /**
   * True when this pane looks through the very node the gizmo is anchored on —
   * a selected camera you're viewing through. Its gizmo sits at the camera's
   * position, i.e. at the eye, filling the near view and swallowing every LMB
   * press (blocking orbit). The gizmo is hidden AND skipped for picking in that
   * pane so navigation works; you edit the camera from another view.
   */
  gizmoBlockedInPane(pane: number): boolean {
    const active = this.doc.selection.active;
    return active !== null && this.sceneCameraNode(pane) === active;
  }

  /** The frustum-helper child of a camera node's Object3D, or null. Hidden for
   *  the pane that looks THROUGH that camera (its lines sit at the eye and poke
   *  into the frame edges) — but kept visible in every other pane. */
  private cameraHelperOf(id: Uuid): Object3D | null {
    const obj = this.sync.object(id);
    return obj?.children.find((c) => c.userData.cameraHelper) ?? null;
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

  /** Keep every helper object on HELPER_LAYER (tools create children dynamically). */
  private applyHelperLayers(): void {
    for (const root of this.helperRoots) {
      root.traverse((o) => o.layers.set(HELPER_LAYER));
    }
  }

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
    // Decide the scene target's MSAA mode BEFORE rendering into it. MSAA only
    // helps the DEFAULT path (scene → hdr); SSR renders the scene via its own
    // passes (hdr holds only helpers, whose depth copy needs single-sample) and
    // GTAO samples hdr depth as a plain 2D texture (impossible on MSAA) — both
    // force single-sample. aoWillRun mirrors the aoOn gate used below.
    const aoWillRun =
      activeDisp.ssao && activeDisp.shading !== "wireframe" && this.editor.layout === "single";
    // DOF also samples hdr's depth as a plain 2D texture (perspectiveDepthToViewZ)
    // — same MSAA constraint as GTAO. Gate mirrors the setDof() gate below so the
    // pre-render sample flip and the graph agree. (Without this, DOF alone — no
    // GTAO/SSR to force single-sample — reads a 4-sample depth attachment and the
    // frame throws; GTAO would mask the bug, so verify DOF with GTAO OFF.)
    const dofWillRun =
      activeDisp.dof &&
      activeDisp.shading === "pbr" &&
      this.editor.layout === "single" &&
      this.sceneCameraNode(this.editor.activePane) !== null;
    output.setSceneMSAA(!ssrActive && !aoWillRun && !dofWillRun);
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
    // Texture mode: aim the gizmo at the material's object (pane-independent)
    // and frame it in the active pane the first time it arms. Done once per
    // frame before the pane loop so framing doesn't run four times.
    this.gizmo.setProjectionTarget(
      this.syncProjectionGizmo(this.rigFor(this.editor.activePane).camera),
    );

    for (let r = 0; r < this.panes.length; r++) {
      const p = this.panes[r]!;
      const i = logical[r]!;
      if (p.w < 2 || p.h < 2) continue;
      const rig = this.rigFor(i);
      rig.setAspect(p.w / p.h);
      this.syncSceneCamera(i, rig);
      // per-pane display settings
      const disp = this.editor.paneDisplay(i);
      // per-pane: recenter/size the infinite grid to THIS pane's camera before
      // it renders (shared object — a once-per-frame setup leaves 3/4 wrong).
      // Grid and main axis live in the same shader; uniforms toggle each.
      this.grid.object.visible = disp.grid || disp.mainAxis;
      this.grid.setToggles(disp.grid, disp.mainAxis);
      if (this.grid.object.visible) this.grid.configure(rig);
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
      // the gizmo so it doesn't fight them; likewise a pane looking through the
      // selected camera (its gizmo would sit at the eye and block orbit)
      if (this.modalTool || this.bevelTool.isActive || this.gizmoBlockedInPane(i))
        this.gizmo.group.visible = false;
      else this.gizmo.update(rig.camera, activeObj, this.editor.gizmoSpace);
      this.handles.update(rig.camera, activeObj);
      this.overlays.update(rig.camera, p.h);
      this.splineOverlays.update(rig.camera, p.h);
      this.sync.updateOutlines(rig.camera, p.h);
      this.sync.updateHelperBillboards(rig.camera, p.h);
      // AFTER the updates: gizmo/handles rebuild children during update(), and
      // fresh objects default to layer 0 — tag them (again) or the SSR pass /
      // reflector mirrors render them into reflections.
      this.applyHelperLayers();
      axesPerSlot.push(projectAxes(rig));
      // SSR draws the scene in the composite (output.render → pass node); the
      // manual blit is skipped for the active pane.
      if (!ssrActive) {
        await renderer.renderAsync(this.scene, rig.camera);
        // helpers live on HELPER_LAYER (excluded from scene renders so
        // reflections never show them) — draw them into the same hdr region
        // on top, preserving color AND depth so they occlude exactly as before
        const bg = this.scene.background;
        this.scene.background = null; // a background would force-clear the pane
        renderer.autoClear = false;
        // looking THROUGH a scene camera: hide its own frustum helper for this
        // pane only — it sits at the eye and its edges show at the frame border
        const throughCam = this.sceneCameraNode(i);
        const camHelper = throughCam ? this.cameraHelperOf(throughCam) : null;
        const camHelperVisible = camHelper?.visible ?? false;
        if (camHelper) camHelper.visible = false;
        rig.camera.layers.set(HELPER_LAYER);
        await renderer.renderAsync(this.scene, rig.camera);
        rig.camera.layers.set(0);
        if (camHelper) camHelper.visible = camHelperVisible;
        this.scene.background = bg;
      }
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
    if (ssrActive) {
      // Helpers are excluded from the SSR pass (HELPER_LAYER) so reflections
      // never show them. Render them into the hdr buffer — unused by the SSR
      // path and safely preserved across renders (the canvas is force-cleared
      // by the WebGPU backend on every render call, so drawing on top of the
      // composite directly is not possible) — with a transparent clear; the
      // composite graph blends them over the final image by alpha.
      const activeCam = this.rigFor(this.editor.activePane).camera;
      const bg = this.scene.background;
      this.scene.background = null;
      const prevClearAlpha = renderer.getClearAlpha();
      renderer.setClearAlpha(0);
      output.hdr.viewport.set(0, 0, output.hdr.width, output.hdr.height);
      output.hdr.scissor.set(0, 0, output.hdr.width, output.hdr.height);
      // prime the overlay depth with the SSR pass's (previous frame's) scene
      // depth so outlines/handles occlude correctly (the outline hull relies
      // on depth-testing against the real surface). One frame of lag is fine.
      const passDepth = output.ssrDepthTexture;
      const depthPrimed =
        passDepth?.image?.width === output.hdr.width &&
        passDepth?.image?.height === output.hdr.height;
      if (depthPrimed) renderer.copyTextureToTexture(passDepth, output.hdr.depthTexture!);
      renderer.autoClearDepth = !depthPrimed; // keep the copied depth
      renderer.setRenderTarget(output.hdr);
      // hide the looked-through camera's own frustum helper (sits at the eye)
      const throughCam = this.sceneCameraNode(this.editor.activePane);
      const camHelper = throughCam ? this.cameraHelperOf(throughCam) : null;
      const camHelperVisible = camHelper?.visible ?? false;
      if (camHelper) camHelper.visible = false;
      activeCam.layers.set(HELPER_LAYER);
      await renderer.renderAsync(this.scene, activeCam);
      activeCam.layers.set(0);
      if (camHelper) camHelper.visible = camHelperVisible;
      renderer.setRenderTarget(null);
      renderer.autoClearDepth = true;
      renderer.setClearAlpha(prevClearAlpha);
      this.scene.background = bg;
    }
    // One tone mapping for the whole composite. A PBR pane owns its own
    // (including an explicit "none"). A non-shaded pane (wireframe/flat) has
    // none of its own — snapping the canvas to "none" the moment it gains
    // focus shifts every pane's color, so it inherits the last focused PBR
    // pane's tone mapping instead (falling back to any PBR pane in the layout,
    // then "none").
    let mode: OutputToneMapping;
    if (activeDisp.shading === "pbr") {
      mode = activeDisp.toneMapping;
      this.lastPbrToneMapping = mode;
    } else {
      mode = this.lastPbrToneMapping ?? this.fallbackPaneToneMapping();
    }
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
    // "high" (temporal) mode needs an equirect HDR env (scene's own, or the
    // bundled default); if it's still decoding, DitherOutput falls back to gen-1.
    const ssrHigh = ssrActive && activeDisp.ssrMode === "high";
    const ssrEnv = ssrHigh
      ? ssrEnvironmentTexture(this.scene.environment, () => this.invalidate())
      : null;
    output.setScreenReflections(
      ssrActive ? this.scene : null,
      ssrActive ? activeCamera : null,
      ssrActive
        ? {
            mode: activeDisp.ssrMode,
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
            denoise: activeDisp.ssrDenoise,
            maxFrames: activeDisp.ssrMaxFrames,
          }
        : null,
      ssrEnv,
    );
    // Depth of field — set BEFORE post-FX (composeOutput applies DOF first, then
    // bloom/tonemap/vignette). Same single-pane + PBR gate as GTAO, plus it needs
    // a scene camera to look through (focus distance is that camera's). Matches
    // dofWillRun above so the MSAA flip and the graph stay in step.
    output.setDof(dofWillRun ? this.dofParamsFor(this.editor.activePane, activeCamera) : null);
    // Post-FX last: it wraps whatever graph the setters above just settled on
    // (composeOutput is shared by both modes), and its continuous params are
    // live uniforms, so a steady frame costs a value compare and nothing else.
    // Wireframe has no lit image worth grading, so the stack is off there.
    const fxOn = activeDisp.shading !== "wireframe";
    output.setPostFx({
      bloom: fxOn && activeDisp.bloom,
      bloomThreshold: activeDisp.bloomThreshold,
      bloomStrength: activeDisp.bloomStrength,
      bloomRadius: activeDisp.bloomRadius,
      chromatic: fxOn && activeDisp.chromatic,
      chromaticAmount: activeDisp.chromaticAmount,
      vignette: fxOn && activeDisp.vignette,
      vignetteAmount: activeDisp.vignetteAmount,
      vignetteRadius: activeDisp.vignetteRadius,
    });
    output.render();
    this.onAxes?.(axesPerSlot);
    this.frames++;
    // Temporal SSR converges over a burst of frames after each change, then
    // idles; every other path stays pure on-demand (accumTarget 0). Only counts
    // when the HDR env is actually ready (else DitherOutput ran gen-1).
    if (ssrHigh && ssrEnv) {
      // render a few frames PAST the accumulation window so the denoiser's
      // history feedback settles at the fully-accumulated weight before idling
      this.accumTarget = Math.max(1, Math.round(activeDisp.ssrMaxFrames)) + 8;
      this.accumFrame++;
    } else {
      this.accumTarget = 0;
    }
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
    // apply the node's lens — the rig was seeded "persp" with placeholder values;
    // the camera DTO is the source of truth while looking through. Missing fields
    // (cameras saved before these were added) fall back to the defaults.
    if (rig.camera instanceof PerspectiveCamera) {
      const d = defaultCameraData();
      const lens = { ...d, ...(node.data?.camera as Partial<CameraDataDTO> | undefined) };
      const c = rig.camera;
      if (
        c.fov !== lens.fov ||
        c.near !== lens.near ||
        c.far !== lens.far ||
        c.filmGauge !== lens.filmGauge ||
        c.filmOffset !== lens.filmOffset ||
        c.zoom !== lens.zoom
      ) {
        c.fov = lens.fov;
        c.near = lens.near;
        c.far = lens.far;
        c.filmGauge = lens.filmGauge;
        c.filmOffset = lens.filmOffset;
        c.zoom = lens.zoom;
        c.updateProjectionMatrix();
      }
    }
    const targetId = node.data?.target as Uuid | undefined;
    if (targetId) {
      const targetObj = this.sync.object(targetId);
      if (targetObj) rig.camera.lookAt(targetObj.getWorldPosition(new Vector3()));
    }
    rig.camera.updateMatrixWorld();
  }

  /**
   * DOF params for a look-through pane: focus distance is the scene camera's —
   * the distance to its focus object if one is set (falling back to the manual
   * `focus` if that object was deleted), else the manual `focus`. near/far come
   * from the camera lens; the blur controls are the pane's display settings.
   */
  private dofParamsFor(pane: number, activeCamera: Camera): DofParams {
    const disp = this.editor.paneDisplay(pane);
    const id = this.sceneCameraNode(pane);
    const lens = {
      ...defaultCameraData(),
      ...(id ? (this.doc.scene.get(id)?.data?.camera as Partial<CameraDataDTO>) : undefined),
    };
    let focusDistance = lens.focus;
    if (lens.focusTarget) {
      const obj = this.sync.object(lens.focusTarget);
      if (obj)
        focusDistance = activeCamera.position.distanceTo(obj.getWorldPosition(new Vector3()));
    }
    return {
      focusDistance,
      focalLength: disp.dofFocalLength,
      bokehScale: disp.dofBokeh,
      near: lens.near,
      far: lens.far,
    };
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

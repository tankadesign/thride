import type { Uuid } from "@/types/core";
import { MeshTopologyCommand } from "@/geometry/commands/topology";
import { type BevelEdgeOpts, bevelEdges } from "@/geometry/ops/bevelEdge";
import type { HEMesh, HEMeshSnapshot } from "@/geometry/kernel/HEMesh";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

/**
 * C4D-style LIVE edge-bevel tool. Unlike the extrude/inset modal (build once,
 * stream positions), a bevel's segments / angle / mode change TOPOLOGY, so
 * this rebuilds from a before-snapshot on every parameter change: restore →
 * re-run bevelEdges(params) → preview. It stays active — the settings panel
 * tweaks params live — and bakes ONE undo step when the user commits (Enter,
 * clicks off, or switches tool/mode). Esc cancels. Width can also be scrubbed
 * by dragging in the viewport.
 */
export class BevelTool {
  private readonly vs: ViewportSystem;
  private session: {
    nodeId: Uuid;
    meshId: Uuid;
    edgeIds: number[];
    before: HEMeshSnapshot;
    scale: number; // world units per drag pixel (mesh-relative)
  } | null = null;
  private unsub: (() => void) | null = null;
  private unsubSel: (() => void) | null = null;
  private dragging = false;

  constructor(vs: ViewportSystem) {
    this.vs = vs;
  }

  get isActive(): boolean {
    return this.session !== null;
  }

  /** Arm the tool on the active edge selection; false when none applies. */
  begin(): boolean {
    const doc = this.vs.doc;
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return false;
    const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
    const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
    if (!meshRef || !mesh) return false;
    const sel = doc.selection.componentsFor(active, "edge");
    if (!sel || sel.topologyVersion !== mesh.topologyVersion || sel.bits.count === 0) return false;

    this.session = {
      nodeId: active,
      meshId: meshRef.id,
      edgeIds: sel.bits.toArray(),
      before: mesh.snapshot(),
      scale: meshExtent(mesh) * 0.0015,
    };
    this.vs.editor.setBevelActive(true);
    this.unsub = this.vs.editor.subscribeBevel(() => this.rebuild());
    // input is locked while the tool runs, so any selection/mode change is the
    // user moving on (switch mode, deselect) → bake the live bevel (C4D-style)
    this.unsubSel = doc.subscribeSlice("selection", () => this.commit());
    this.rebuild();
    return true;
  }

  /** Vertical drag scrubs width (kept ≥ 0). */
  beginWidthDrag(): void {
    if (this.session) this.dragging = true;
  }

  onWidthDrag(dy: number): void {
    if (!this.session || !this.dragging) return;
    const p = this.vs.editor.bevelParams;
    this.vs.editor.setBevelParams({ width: Math.max(0, p.width - dy * this.session.scale) });
  }

  endWidthDrag(): void {
    this.dragging = false;
  }

  private opts(): BevelEdgeOpts {
    const p = this.vs.editor.bevelParams;
    return { width: p.width, angleDeg: p.angleDeg, segments: p.segments, mode: p.mode };
  }

  /** Restore the pre-bevel mesh and re-apply at the current params (preview). */
  private rebuild(): void {
    const s = this.session;
    const mesh = s ? meshRegistry.get(s.meshId) : undefined;
    if (!s || !mesh) return;
    mesh.restore(s.before);
    bevelEdges(mesh, s.edgeIds, this.opts()); // null just leaves the mesh restored
    this.vs.doc.touchNode(s.nodeId, true); // preview
    this.vs.invalidate();
  }

  /** Bake the current preview into one undo step and deactivate. */
  commit(): void {
    const s = this.session;
    const mesh = s ? meshRegistry.get(s.meshId) : undefined;
    const opts = this.opts();
    this.end();
    if (!s || !mesh) return;
    mesh.restore(s.before);
    this.vs.doc.history.run(
      new MeshTopologyCommand(s.nodeId, s.meshId, "Bevel", (m: HEMesh) =>
        bevelEdges(m, s.edgeIds, opts),
      ),
    );
  }

  /** Discard the preview, restore the mesh, deactivate. */
  cancel(): void {
    const s = this.session;
    const mesh = s ? meshRegistry.get(s.meshId) : undefined;
    this.end();
    if (s && mesh) {
      mesh.restore(s.before);
      this.vs.doc.touchNode(s.nodeId);
    }
  }

  private end(): void {
    this.unsub?.();
    this.unsubSel?.();
    this.unsub = null;
    this.unsubSel = null;
    this.session = null;
    this.dragging = false;
    this.vs.editor.setBevelActive(false);
    this.vs.invalidate();
  }
}

/** Rough world-space size of a mesh (for scaling the width drag). */
function meshExtent(mesh: HEMesh): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let v = 0; v < mesh.vCount; v++) {
    for (let a = 0; a < 3; a++) {
      const c = mesh.vPos[v * 3 + a]!;
      if (c < min) min = c;
      if (c > max) max = c;
    }
  }
  return Number.isFinite(max - min) ? Math.max(1e-3, max - min) : 1;
}

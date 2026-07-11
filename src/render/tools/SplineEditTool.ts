import { Plane, Vector3 } from "three";
import type { Uuid } from "@/types/core";
import { Bitset } from "@/core/selection/Bitset";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import type { SplineData } from "@/types/geometry/spline";
import { splineStamp } from "@/geometry/splines/eval";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

/** Screen-space pick tolerances (pane px). Handles win over anchors. */
const ANCHOR_PX = 10;
const HANDLE_PX = 8;

export interface SplineContext {
  nodeId: Uuid;
  data: SplineData;
}

export type SplinePick = { kind: "anchor" | "in" | "out"; index: number } | null;

interface DragState {
  kind: "anchor" | "in" | "out";
  index: number;
  startLocal: Vector3;
  before: SplineData;
  /** ⌘/Ctrl at drag start breaks the tangent link (Alt belongs to nav). */
  breakLink: boolean;
  moved: boolean;
}

/**
 * Point-mode editing for spline nodes: anchor/handle picking, plane-locked
 * drags (all movement happens in the spline's work plane — local z stays 0),
 * and C4D-grade tangent behavior — smooth points mirror handle DIRECTION
 * while keeping each side's length, broken points move independently,
 * ⌘/Ctrl-dragging a handle breaks the link (Alt is nav), dragging a handle
 * out of a linear point promotes it to smooth. One undo step per drag.
 */
export class SplineEditTool {
  private readonly vs: ViewportSystem;
  private drag: DragState | null = null;
  private readonly plane = new Plane();

  constructor(vs: ViewportSystem) {
    this.vs = vs;
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** Active spline node in point mode, or null. */
  context(): SplineContext | null {
    const doc = this.vs.doc;
    if (doc.selection.editMode !== "point") return null;
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return null;
    const node = doc.scene.mustGet(active);
    if (node.kind !== "spline") return null;
    const data = node.data?.spline as SplineData | undefined;
    return data ? { nodeId: active, data } : null;
  }

  /** Selected point indices (stamped against the current point count). */
  selectedIndices(ctx: SplineContext): number[] {
    const sel = this.vs.doc.selection.componentsFor(ctx.nodeId, "point");
    if (!sel || sel.topologyVersion !== splineStamp(ctx.data)) return [];
    return sel.bits.toArray();
  }

  /**
   * Pick anchors + (selected points') handle knobs by screen distance.
   * Handles win: they're smaller targets and sit on top visually.
   */
  pick(e: PointerEvent, ctx: SplineContext): SplinePick {
    const obj = this.vs.sync.object(ctx.nodeId);
    if (!obj) return null;
    const rect = this.vs.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const pane = this.vs.paneRect(this.vs.editor.activePane);
    const cam = this.vs.rigFor(this.vs.editor.activePane).camera;
    cam.updateMatrixWorld();
    obj.updateMatrixWorld();
    const project = (local: [number, number, number]): { x: number; y: number } | null => {
      const v = new Vector3(...local).applyMatrix4(obj.matrixWorld);
      v.applyMatrix4(cam.matrixWorldInverse);
      if ((cam as { isPerspectiveCamera?: boolean }).isPerspectiveCamera && v.z >= -1e-6)
        return null;
      v.applyMatrix4(cam.projectionMatrix);
      return { x: pane.x + ((v.x + 1) / 2) * pane.w, y: pane.y + ((1 - v.y) / 2) * pane.h };
    };

    const selected = new Set(this.selectedIndices(ctx));
    let best: SplinePick = null;
    let bestDist = HANDLE_PX;
    // handle knobs of selected points first
    for (const i of selected) {
      const p = ctx.data.points[i];
      if (!p) continue;
      for (const kind of ["in", "out"] as const) {
        const h = kind === "in" ? p.inHandle : p.outHandle;
        if (h[0] === 0 && h[1] === 0 && h[2] === 0) continue;
        const s = project([p.position[0] + h[0], p.position[1] + h[1], p.position[2] + h[2]]);
        if (!s) continue;
        const d = Math.hypot(s.x - px, s.y - py);
        if (d < bestDist) {
          bestDist = d;
          best = { kind, index: i };
        }
      }
    }
    if (best) return best;
    bestDist = ANCHOR_PX;
    for (let i = 0; i < ctx.data.points.length; i++) {
      const s = project(ctx.data.points[i]!.position);
      if (!s) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: "anchor", index: i };
      }
    }
    return best;
  }

  /**
   * Point-mode click on the active spline. Selects and/or starts a drag.
   * Returns false when nothing was hit (caller clears the selection).
   */
  pointerDown(e: PointerEvent): boolean {
    const ctx = this.context();
    if (!ctx) return false;
    const hit = this.pick(e, ctx);
    if (!hit) return false;
    const doc = this.vs.doc;

    if (hit.kind === "anchor") {
      const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
      const prev = new Set(this.selectedIndices(ctx));
      let nextSel: Set<number>;
      if (op === "replace") {
        nextSel = prev.has(hit.index) ? prev : new Set([hit.index]);
      } else if (op === "add") {
        nextSel = new Set(prev).add(hit.index);
      } else {
        nextSel = new Set(prev);
        if (nextSel.has(hit.index)) nextSel.delete(hit.index);
        else nextSel.add(hit.index);
      }
      const bits = new Bitset();
      const order: number[] = [];
      for (const i of nextSel) {
        bits.add(i);
        order.push(i);
      }
      doc.selection.setComponents(ctx.nodeId, {
        mode: "point",
        bits,
        order,
        topologyVersion: splineStamp(ctx.data),
      });
      if (op === "toggle" && !nextSel.has(hit.index)) return true; // deselected — no drag
    }

    const startLocal = this.pointerToLocal(e, ctx.nodeId);
    if (!startLocal) return true;
    this.drag = {
      kind: hit.kind,
      index: hit.index,
      startLocal,
      before: structuredClone(ctx.data),
      breakLink: hit.kind !== "anchor" && (e.metaKey || e.ctrlKey),
      moved: false,
    };
    return true;
  }

  /** Stream the drag as preview data (positions ride the work plane). */
  pointerMove(e: PointerEvent): boolean {
    const drag = this.drag;
    const ctx = this.context();
    if (!drag || !ctx) return false;
    const local = this.pointerToLocal(e, ctx.nodeId);
    if (!local) return true;
    const dx = local.x - drag.startLocal.x;
    const dy = local.y - drag.startLocal.y;
    if (!drag.moved && Math.hypot(dx, dy) < 1e-6) return true;
    drag.moved = true;

    const after = structuredClone(drag.before);
    if (drag.kind === "anchor") {
      // move every selected anchor by the same in-plane delta
      const sel = this.selectedIndices(ctx);
      const move = sel.includes(drag.index) ? sel : [drag.index];
      for (const i of move) {
        const p = after.points[i];
        if (!p) continue;
        p.position = [p.position[0] + dx, p.position[1] + dy, p.position[2]];
      }
    } else {
      const p = after.points[drag.index];
      if (!p) return true;
      const hx = local.x - p.position[0];
      const hy = local.y - p.position[1];
      const dragged: [number, number, number] = [hx, hy, 0];
      const isIn = drag.kind === "in";
      if (drag.breakLink) p.mode = "broken";
      if (p.mode === "linear") p.mode = "smooth"; // pulling a handle out of a corner
      if (isIn) p.inHandle = dragged;
      else p.outHandle = dragged;
      if (p.mode === "smooth") {
        // mirror DIRECTION onto the opposite handle, keep its own length
        const len = Math.hypot(hx, hy) || 1;
        const ox = -hx / len;
        const oy = -hy / len;
        const opp = isIn ? p.outHandle : p.inHandle;
        let oppLen = Math.hypot(opp[0], opp[1], opp[2]);
        if (oppLen < 1e-9) oppLen = Math.hypot(hx, hy); // fresh promotion: mirror fully
        const mirrored: [number, number, number] = [ox * oppLen, oy * oppLen, 0];
        if (isIn) p.outHandle = mirrored;
        else p.inHandle = mirrored;
      }
    }
    const node = this.vs.doc.scene.mustGet(ctx.nodeId);
    this.vs.doc.setNodeData(ctx.nodeId, { ...node.data, spline: after }, true);
    this.vs.invalidate();
    return true;
  }

  /** Commit the whole drag as ONE undo step. */
  pointerUp(): boolean {
    const drag = this.drag;
    this.drag = null;
    const ctx = this.context();
    if (!drag || !ctx) return false;
    if (!drag.moved) return true; // pure click — selection already handled
    const node = this.vs.doc.scene.mustGet(ctx.nodeId);
    const label = drag.kind === "anchor" ? "Move Points" : "Adjust Tangent";
    this.vs.doc.history.pushWithoutExecute(
      new SetNodeDataCommand(
        ctx.nodeId,
        { ...node.data, spline: ctx.data },
        { ...node.data, spline: drag.before },
        label,
        false,
      ),
    );
    return true;
  }

  cancel(): void {
    const drag = this.drag;
    this.drag = null;
    const ctx = this.context();
    if (!drag || !ctx) return;
    const node = this.vs.doc.scene.mustGet(ctx.nodeId);
    this.vs.doc.setNodeData(ctx.nodeId, { ...node.data, spline: drag.before });
    this.vs.invalidate();
  }

  /** Run a tangent op (panel button) over the selected points — one step. */
  applyOp(op: (data: SplineData, sel: readonly number[]) => SplineData, label: string): void {
    const ctx = this.context();
    if (!ctx) return;
    const sel = this.selectedIndices(ctx);
    if (sel.length === 0) return;
    const after = op(ctx.data, sel);
    const node = this.vs.doc.scene.mustGet(ctx.nodeId);
    this.vs.doc.history.run(
      new SetNodeDataCommand(
        ctx.nodeId,
        { ...node.data, spline: after },
        { ...node.data, spline: ctx.data },
        label,
        false,
      ),
    );
    this.vs.invalidate();
  }

  /** Cursor ray ∩ the spline's work plane, in node-local coords (z=0). */
  private pointerToLocal(e: PointerEvent, nodeId: Uuid): Vector3 | null {
    const obj = this.vs.sync.object(nodeId);
    if (!obj) return null;
    const rect = this.vs.canvas.getBoundingClientRect();
    const pane = this.vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.vs.setRayFromEvent(e, pane);
    obj.updateMatrixWorld();
    const normal = new Vector3(0, 0, 1).applyQuaternion(obj.quaternion).normalize();
    this.plane.setFromNormalAndCoplanarPoint(normal, obj.position);
    const hit = new Vector3();
    if (!this.vs.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const local = obj.worldToLocal(hit.clone());
    local.z = 0;
    return local;
  }
}

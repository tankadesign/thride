import { useEffect, useRef, useState } from "react";
import type { Uuid } from "@/types/core";
import type { PaneCamera } from "@/types/editor";
import { useAtomValue } from "jotai";
import { appStore, useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { openContextMenu } from "@/ui/hooks/editor/shell";
import { splineThicknessAtom } from "@/ui/hooks/editor/settings";
import {
  bevelActiveAtom,
  editorState,
  targetRotationBakerAtom,
  useViewportState,
} from "@/ui/hooks/editor/viewport";
import { applySplineThickness } from "@/render/scene-sync/SplineSync";
import { BevelSettings } from "./BevelSettings";
import { SplinePointPanel } from "./SplinePointPanel";
import {
  type PaneAxes,
  type ViewportStats,
  ViewportSystem,
} from "@/render/viewport/ViewportSystem";
import { themeStyle, viewportTheme } from "@/render/theme/viewportTheme";
import { buildViewportMenu } from "./viewportMenu";
import { IconPivotPoint } from "@/icons";

const OBJECT_CONTEXT_COMMANDS = [
  "edit.group",
  "edit.convertToMesh",
  "edit.delete",
  "edit.selectAll",
  "edit.deselect",
];

/** Shares the gizmo's axis colors (X/Y/Z → error/success/info) via the theme. */
const AXIS_COLORS = [
  themeStyle(viewportTheme.gizmo.x),
  themeStyle(viewportTheme.gizmo.y),
  themeStyle(viewportTheme.gizmo.z),
] as const;
const AXIS_LABELS = ["X", "Y", "Z"] as const;

/** C4D-style orientation indicator: world axes projected into the pane. */
function AxisIndicator({ axes }: { axes: PaneAxes }) {
  const R = 22;
  const C = 30;
  // draw back-facing axes first so front ones overlap them
  const order = [...axes.keys()].sort((a, b) => Number(axes[a]!.front) - Number(axes[b]!.front));
  return (
    <svg width={C * 2} height={C * 2} className="pointer-events-none" aria-hidden="true">
      {order.map((i) => {
        const a = axes[i]!;
        const x = C + a.dx * R;
        const y = C + a.dy * R;
        return (
          <g key={i} opacity={a.front ? 1 : 0.35}>
            <line x1={C} y1={C} x2={x} y2={y} stroke={AXIS_COLORS[i]} strokeWidth="1.5" />
            <circle cx={x} cy={y} r={a.front ? 7 : 4} fill={AXIS_COLORS[i]} />
            {a.front ? (
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontSize="8"
                fontWeight="700"
                fill={themeStyle(viewportTheme.backgroundColor)}
              >
                {AXIS_LABELS[i]}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

interface Props {
  /** The shell exposes the live system so commands (F/H, layout) can reach it. */
  onSystem: (vs: ViewportSystem | null) => void;
}

export function ViewportPanel({ onSystem }: Props) {
  const doc = useDocument();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  const [navMarker, setNavMarker] = useState<{ x: number; y: number } | null>(null);
  const [snapMarker, setSnapMarker] = useState<{ x: number; y: number } | null>(null);
  const [axes, setAxes] = useState<PaneAxes[]>([]);
  const [system, setSystem] = useState<ViewportSystem | null>(null);
  const bevelActive = useAtomValue(bevelActiveAtom);
  const splineThickness = useAtomValue(splineThicknessAtom);
  const { layout, maximizedPane, paneCameras, setPaneCamera } = useViewportState();
  useSliceVersion("scene");

  // spline display thickness: applied on boot and whenever the setting changes
  useEffect(() => {
    applySplineThickness(splineThickness);
    system?.invalidate();
  }, [splineThickness, system]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vs = new ViewportSystem(canvas, doc, editorState);
    setSystem(vs);
    vs.onStats = setStats;
    vs.onNavMarker = setNavMarker;
    vs.onSnapMarker = setSnapMarker;
    vs.onAxes = setAxes;
    vs.onContextMenuRequest = ({ clientX, clientY, pane, nodeId }) => {
      if (nodeId) {
        if (!doc.selection.has(nodeId)) doc.selection.selectObjects([nodeId]);
        openContextMenu({
          x: clientX,
          y: clientY,
          entries: OBJECT_CONTEXT_COMMANDS.map((commandId) => ({ commandId })),
        });
      } else {
        openContextMenu({ x: clientX, y: clientY, entries: buildViewportMenu(doc, vs, pane) });
      }
    };
    onSystem(vs);
    // expose a narrow baker so the Attributes target selector can retain the
    // followed orientation when a target is cleared (see targetRotationBakerAtom)
    appStore.set(targetRotationBakerAtom, { bake: (id: Uuid) => vs.sync.currentLocalRotation(id) });
    return () => {
      onSystem(null);
      setSystem(null);
      appStore.set(targetRotationBakerAtom, null);
      vs.dispose();
    };
  }, [doc, onSystem]);

  const cameraOptions: { value: string; label: string }[] = [
    { value: "persp", label: "Perspective" },
    { value: "ortho", label: "Orthogonal" },
    { value: "top", label: "Top" },
    { value: "bottom", label: "Bottom" },
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
    { value: "front", label: "Front" },
    { value: "rear", label: "Rear" },
    ...doc.scene
      .toDTO()
      .filter((n) => n.kind === "camera")
      .map((n) => ({ value: n.id as string, label: `🎥 ${n.name}` })),
  ];

  // logical pane per visible slot: single layout shows the maximized pane
  const slots = layout === "quad" ? [0, 1, 2, 3] : [maximizedPane];
  const slotStyle = (slot: number): React.CSSProperties =>
    layout === "quad"
      ? { left: slot % 2 === 0 ? 4 : "calc(50% + 5px)", top: slot < 2 ? 4 : "calc(50% + 5px)" }
      : { left: 4, top: 4 };
  const axesStyle = (slot: number): React.CSSProperties =>
    layout === "quad"
      ? { right: slot % 2 === 0 ? "calc(50% + 3px)" : 2, top: slot < 2 ? 2 : "calc(50% + 3px)" }
      : { right: 2, top: 2 };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {bevelActive && system ? <BevelSettings vs={system} /> : null}
      {system ? <SplinePointPanel vs={system} /> : null}
      {slots.map((pane, slot) => (
        <select
          key={pane}
          className="select select-xs absolute w-32 border-base-300 bg-base-100/80 backdrop-blur"
          style={slotStyle(slot)}
          value={paneCameras[pane] as string}
          onChange={(e) => setPaneCamera(pane, e.target.value as PaneCamera)}
        >
          {cameraOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {slots.map((pane, slot) =>
        axes[slot] ? (
          <div key={`axes-${pane}`} className="absolute" style={axesStyle(slot)}>
            <AxisIndicator axes={axes[slot]!} />
          </div>
        ) : null,
      )}
      {navMarker ? (
        <div
          className="pointer-events-none absolute text-primary drop-shadow-[0_0_3px_rgba(0,0,0,0.5)]"
          style={{ left: navMarker.x - 7, top: navMarker.y - 7 }}
        >
          <IconPivotPoint size={16} />
        </div>
      ) : null}
      {snapMarker ? (
        <div
          className="pointer-events-none absolute size-2.5 rounded-full border-2 border-success bg-success/40"
          style={{ left: snapMarker.x - 5, top: snapMarker.y - 5 }}
        />
      ) : null}
      {stats ? (
        <div className="badge badge-xs pointer-events-none absolute right-2 bottom-1.5 gap-1 border-0 bg-base-100/60 font-mono opacity-80">
          {stats.backend} · {stats.fps} fps · {stats.nodes} obj
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Uuid } from "@/types/core";
import type { PaneCamera } from "@/types/editor";
import { useAtomValue } from "jotai";
import { SetNodeDataCommand } from "@/core";
import { appStore, useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { MATERIAL_DND_MIME } from "@/ui/hooks/editor/materials";
import { type MenuEntry, openContextMenu, registryAtom } from "@/ui/hooks/editor/shell";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { splineThicknessAtom } from "@/ui/hooks/editor/settings";
import {
  bevelActiveAtom,
  editorState,
  targetRotationBakerAtom,
  useViewportState,
} from "@/ui/hooks/editor/viewport";
import { BevelSettings } from "./BevelSettings";
import { SplinePointPanel } from "./SplinePointPanel";
import {
  type PaneAxes,
  type ViewportStats,
  ViewportSystem,
} from "@/render/viewport/ViewportSystem";
import { themeStyle, viewportTheme } from "@/render/theme/viewportTheme";
import { ViewSettingsModal } from "./ViewSettingsModal";
import { IconPivotPoint, IconSettings } from "@/icons";

const OBJECT_CONTEXT_COMMANDS = [
  "edit.group",
  "edit.convertToMesh",
  "edit.delete",
  "edit.selectAll",
  "edit.deselect",
];

/**
 * The Create menu as a context-menu flyout: the registry's Create commands with
 * consecutive same-submenu runs nested one level (Primitives/Splines/…), the
 * same grouping the MenuBar renders — one definition, two surfaces.
 */
function createMenuEntry(registry: CommandRegistry): MenuEntry {
  const children: MenuEntry[] = [];
  for (const cmd of registry.byMenu("Create")) {
    const last = children.at(-1);
    if (!cmd.submenu) {
      children.push({ commandId: cmd.id, sep: cmd.sep });
    } else if (last?.children && last.label === cmd.submenu) {
      last.children.push({ commandId: cmd.id });
    } else {
      children.push({ label: cmd.submenu, icon: cmd.icon, children: [{ commandId: cmd.id }] });
    }
  }
  return { label: "Create", children };
}

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
  const [settings, setSettings] = useState<{ pane: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bevelActive = useAtomValue(bevelActiveAtom);
  const splineThickness = useAtomValue(splineThicknessAtom);
  const { layout, maximizedPane, paneCameras, setPaneCamera } = useViewportState();
  useSliceVersion("scene");

  // spline display thickness: applied on boot and whenever the setting changes
  useEffect(() => {
    system?.setSplineThickness(splineThickness);
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
    vs.onContextMenuRequest = ({ clientX, clientY, nodeId }) => {
      // Object mode leads with the Create tree (background AND object clicks);
      // component modes keep the old rule — object menu only, nothing on
      // background. Camera & Display live in the View Settings modal.
      const registry = appStore.get(registryAtom);
      const objectMode = doc.selection.editMode === "object";
      const entries: MenuEntry[] = objectMode && registry ? [createMenuEntry(registry)] : [];
      if (nodeId) {
        if (!doc.selection.has(nodeId)) doc.selection.selectObjects([nodeId]);
        entries.push(
          ...OBJECT_CONTEXT_COMMANDS.map((commandId, i) => ({
            commandId,
            sep: i === 0 && entries.length > 0,
          })),
        );
      }
      if (entries.length === 0) return;
      openContextMenu({ x: clientX, y: clientY, entries });
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

  // drag a material swatch from the Material Manager onto a mesh to assign it
  const onMaterialDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(MATERIAL_DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onMaterialDrop = (e: React.DragEvent) => {
    const matId = e.dataTransfer.getData(MATERIAL_DND_MIME);
    if (!matId || !system) return;
    e.preventDefault();
    const nodeId = system.pickNode(e.nativeEvent);
    const node = nodeId ? doc.scene.get(nodeId) : null;
    if (!node) return;
    const before = structuredClone(node.data ?? {});
    const after = { ...before, material: matId };
    doc.history.run(new SetNodeDataCommand(node.id, after, before, "Assign Material"));
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onDragOver={onMaterialDragOver}
      onDrop={onMaterialDrop}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {bevelActive && system ? <BevelSettings vs={system} /> : null}
      {system ? <SplinePointPanel vs={system} /> : null}
      {slots.map((pane, slot) => (
        <div key={pane} className="absolute flex items-center gap-1" style={slotStyle(slot)}>
          <select
            className="select select-xs w-32 border-base-300 bg-base-100/80 backdrop-blur"
            value={paneCameras[pane] as string}
            onChange={(e) => setPaneCamera(pane, e.target.value as PaneCamera)}
          >
            {cameraOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-square btn-xs border-base-300 bg-base-100/80 backdrop-blur"
            title="View settings"
            onClick={(e) => {
              if (settings?.pane === pane) {
                setSettings(null);
                return;
              }
              // open anchored under THIS pane's gear so 4-up lands in the right
              // quadrant; clamp x so the ~240px modal stays inside the viewport
              const box = containerRef.current?.getBoundingClientRect();
              const b = e.currentTarget.getBoundingClientRect();
              const x = b.left - (box?.left ?? 0);
              const y = b.bottom - (box?.top ?? 0) + 4;
              setSettings({ pane, x: Math.max(4, Math.min(x, (box?.width ?? 248) - 248)), y });
            }}
          >
            <IconSettings size={14} />
          </button>
        </div>
      ))}
      {settings && system ? (
        <ViewSettingsModal
          key={settings.pane}
          pane={settings.pane}
          initialPos={{ x: settings.x, y: settings.y }}
          vs={system}
          onClose={() => setSettings(null)}
        />
      ) : null}
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

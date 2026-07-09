import { useEffect, useRef, useState } from "react";
import type { PaneCamera } from "@/types/editor";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { editorState, useViewportState } from "@/ui/hooks/editor/viewport";
import { type ViewportStats, ViewportSystem } from "@/render/viewport/ViewportSystem";

interface Props {
  /** The shell exposes the live system so commands (F/H, layout) can reach it. */
  onSystem: (vs: ViewportSystem | null) => void;
}

export function ViewportPanel({ onSystem }: Props) {
  const doc = useDocument();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  const { layout, maximizedPane, paneCameras, setPaneCamera } = useViewportState();
  useSliceVersion("scene");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vs = new ViewportSystem(canvas, doc, editorState);
    vs.onStats = setStats;
    onSystem(vs);
    return () => {
      onSystem(null);
      vs.dispose();
    };
  }, [doc, onSystem]);

  const cameraOptions: { value: string; label: string }[] = [
    { value: "persp", label: "Perspective" },
    { value: "top", label: "Top" },
    { value: "front", label: "Front" },
    { value: "right", label: "Right" },
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

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
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
      {stats ? (
        <div className="badge badge-xs pointer-events-none absolute right-2 bottom-1.5 gap-1 border-0 bg-base-100/60 font-mono opacity-80">
          {stats.backend} · {stats.fps} fps · {stats.nodes} obj
        </div>
      ) : null}
    </div>
  );
}

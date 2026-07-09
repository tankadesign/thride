import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Uuid } from "@/types/core";
import { useDocument } from "@/ui/hooks/DocumentContext";
import { useDocSlice } from "@/ui/hooks/useDocSlice";
import type { EditorState, PaneCamera } from "@/ui/state/EditorState";
import { Select } from "@/ui/widgets/Select";
import { type ViewportStats, ViewportSystem } from "@/render/viewport/ViewportSystem";

interface Props {
  editor: EditorState;
  /** The shell exposes the live system so commands (F/H, layout) can reach it. */
  onSystem: (vs: ViewportSystem | null) => void;
}

export function ViewportPanel({ editor, onSystem }: Props) {
  const doc = useDocument();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => editor.version,
  );
  useDocSlice("scene");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vs = new ViewportSystem(canvas, doc, editor);
    vs.onStats = setStats;
    onSystem(vs);
    return () => {
      onSystem(null);
      vs.dispose();
    };
  }, [doc, editor, onSystem]);

  const cameraOptions: { value: string; label: string }[] = [
    { value: "persp", label: "Perspective" },
    { value: "top", label: "Top" },
    { value: "front", label: "Front" },
    { value: "right", label: "Right" },
    ...doc.scene
      .toDTO()
      .filter((n) => n.kind === "camera")
      .map((n) => ({ value: n.id as string, label: `📷 ${n.name}` })),
  ];

  const paneCount = editor.layout === "quad" ? 4 : 1;
  const paneStyle = (i: number): React.CSSProperties =>
    editor.layout === "quad"
      ? { left: i % 2 === 0 ? 4 : "calc(50% + 5px)", top: i < 2 ? 4 : "calc(50% + 5px)" }
      : { left: 4, top: 4 };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      {Array.from({ length: paneCount }, (_, i) => (
        <div key={i} style={{ position: "absolute", width: 130, opacity: 0.85, ...paneStyle(i) }}>
          <Select
            value={editor.paneCamera(i) as string}
            options={cameraOptions}
            onChange={(v) => editor.setPaneCamera(i, v as PaneCamera as Uuid | PaneCamera)}
          />
        </div>
      ))}
      {stats ? (
        <div
          style={{
            position: "absolute",
            right: 8,
            bottom: 6,
            fontSize: 10,
            color: "var(--t-fg-dim)",
            background: "rgba(16,16,20,.6)",
            padding: "2px 6px",
            borderRadius: 4,
            pointerEvents: "none",
          }}
        >
          {stats.backend} · {stats.fps} fps · {stats.nodes} objects
        </div>
      ) : null}
    </div>
  );
}

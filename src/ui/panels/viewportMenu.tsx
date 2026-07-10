import type { Document } from "@/core";
import type { BuiltinCamera, PaneDisplay, ShadingMode } from "@/types/editor";
import type { MenuEntry } from "@/ui/hooks/editor/shell";
import { editorState } from "@/ui/hooks/editor/viewport";
import { IconCamera, IconShading, IconToggleOff, IconToggleOn } from "@/icons";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

const CAMERA_ITEMS: { camera: BuiltinCamera; label: string }[] = [
  { camera: "persp", label: "Perspective" },
  { camera: "ortho", label: "Orthogonal" },
  { camera: "top", label: "Top" },
  { camera: "bottom", label: "Bottom" },
  { camera: "left", label: "Left" },
  { camera: "right", label: "Right" },
  { camera: "front", label: "Front" },
  { camera: "rear", label: "Rear" },
];

const SHADING_ITEMS: { mode: ShadingMode; label: string }[] = [
  { mode: "pbr", label: "PBR" },
  { mode: "flat", label: "Flat" },
  { mode: "wireframe", label: "Wireframe" },
];

/** Viewport-background right-click menu: Camera + Display per pane. */
export function buildViewportMenu(doc: Document, vs: ViewportSystem, pane: number): MenuEntry[] {
  const current = editorState.paneCamera(pane);
  const disp = editorState.paneDisplay(pane);
  const sceneCameras = doc.scene.toDTO().filter((n) => n.kind === "camera");

  const toggle = (
    label: string,
    key: keyof PaneDisplay,
    value: boolean,
    disabled = false,
  ): MenuEntry => ({
    label,
    icon: value ? <IconToggleOn size={16} /> : <IconToggleOff size={16} />,
    disabled,
    run: () => editorState.setPaneDisplay(pane, { [key]: !value }),
  });

  return [
    {
      label: "Camera",
      icon: <IconCamera size={16} />,
      children: [
        ...(sceneCameras.length > 0
          ? [
              {
                label: "Active Camera",
                icon: <IconCamera size={16} />,
                active: current === sceneCameras[0]!.id,
                run: () => editorState.setPaneCamera(pane, sceneCameras[0]!.id),
              } satisfies MenuEntry,
            ]
          : []),
        ...CAMERA_ITEMS.map(
          (c): MenuEntry => ({
            label: c.label,
            active: current === c.camera,
            run: () => editorState.setPaneCamera(pane, c.camera),
          }),
        ),
        {
          label: "Reset Camera PSR",
          sep: true,
          run: () => vs.resetPaneCamera(pane),
        },
      ],
    },
    {
      label: "Display",
      icon: <IconShading size={16} />,
      children: [
        {
          label: "Shading",
          icon: <IconShading size={16} />,
          children: SHADING_ITEMS.map(
            (s): MenuEntry => ({
              label: s.label,
              active: disp.shading === s.mode,
              run: () => editorState.setPaneDisplay(pane, { shading: s.mode }),
            }),
          ),
        },
        toggle("Shadows", "shadows", disp.shadows, disp.shading !== "pbr"),
        toggle("Backfaces", "backfaces", disp.backfaces),
        toggle("SSAO", "ssao", disp.ssao, disp.shading !== "pbr"),
        toggle("Grid", "grid", disp.grid),
        toggle("Lines", "lines", disp.lines, disp.shading === "wireframe"),
        toggle(
          "Hidden Lines",
          "hiddenLines",
          disp.hiddenLines,
          disp.shading === "wireframe" || !disp.lines,
        ),
      ],
    },
  ];
}

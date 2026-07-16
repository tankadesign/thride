import { iconSizeAtom } from "@/ui/hooks/editor/settings";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Axis3DIcon,
  BulbIcon,
  Cancel01Icon,
  ChartSplineIcon,
  CircleIcon,
  Cone01Icon,
  CubeIcon,
  Cursor01Icon,
  Cylinder01Icon,
  Delete02Icon,
  DiamondIcon,
  EyeIcon,
  EyeClosedIcon,
  Folder01Icon,
  GitMergeIcon,
  HexagonIcon,
  Idea01Icon,
  LayerMask01Icon,
  LayerSendBackwardIcon,
  Magnet02Icon,
  MaterialAndTextureIcon,
  MatrixIcon,
  MinusSignSquareIcon,
  OctagonIcon,
  PathfinderMergeIcon,
  PathfinderUniteIcon,
  PenTool03Icon,
  PentagonIcon,
  PillIcon,
  PipelineIcon,
  PlusSignSquareIcon,
  PolygonIcon,
  PyramidIcon,
  RecordIcon,
  Search01Icon,
  Settings01Icon,
  Settings02Icon,
  SphereIcon,
  SpiralsIcon,
  SplinePointerIcon,
  SpotlightIcon,
  StarIcon,
  SquareArrowShrink01Icon,
  SquareArrowUp01Icon,
  SunCloud02Icon,
  SunsetIcon,
  TorusIcon,
  TriangleIcon,
  Video02Icon,
  CenterFocusIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import { useAtomValue } from "jotai";

/**
 * App icon set on hugeicons. Every icon renders at the GLOBAL icon size
 * (settings.iconSizeAtom, default 20px) unless a size prop overrides it.
 * Add icons here only — never import @hugeicons/* elsewhere: a direct import
 * bypasses both the global size and the shared stroke weight, so it silently
 * stops scaling with the setting.
 *
 * Exports are wired to real UI. An icon with no consumer gets deleted rather
 * than parked here — a set full of dead exports isn't "covered", it's noise.
 */

type IconDef = HugeiconsIconProps["icon"];
type AppIconProps = Omit<HugeiconsIconProps, "icon"> & { size?: number | string };

function makeIcon(icon: IconDef) {
  return function AppIcon({ size, ...rest }: AppIconProps) {
    const globalSize = useAtomValue(iconSizeAtom);
    return <HugeiconsIcon icon={icon} size={size ?? globalSize} strokeWidth={1.6} {...rest} />;
  };
}

// edit modes
export const IconCursor = makeIcon(Cursor01Icon);
export const IconEdge = makeIcon(SplinePointerIcon);
export const IconPoint = makeIcon(MatrixIcon);
export const IconPolygon = makeIcon(TriangleIcon);
export const IconTexture = makeIcon(MaterialAndTextureIcon);

// primitives / node kinds
export const IconCamera = makeIcon(Video02Icon);
export const IconCapsule = makeIcon(PillIcon);
export const IconCone = makeIcon(Cone01Icon);
export const IconCube = makeIcon(CubeIcon);
export const IconCylinder = makeIcon(Cylinder01Icon);
/** Solid disc primitive — filled, vs the outlined {@link IconCircle} spline. */
export const IconDisc = makeIcon(RecordIcon);
export const IconGenerator = makeIcon(Settings02Icon);
export const IconGroup = makeIcon(Folder01Icon);
export const IconIcosphere = makeIcon(PentagonIcon);
export const IconLight = makeIcon(Idea01Icon);
/** Generic editable (non-parametric) mesh — vs the {@link IconCube} primitive. */
export const IconMesh = makeIcon(PolygonIcon);
export const IconNull = makeIcon(Axis3DIcon);
export const IconPlane = makeIcon(DiamondIcon);
export const IconPyramid = makeIcon(PyramidIcon);
export const IconSphere = makeIcon(SphereIcon);
export const IconSpline = makeIcon(ChartSplineIcon);
export const IconTorus = makeIcon(TorusIcon);
/** Circle SPLINE — an outline, vs the filled {@link IconDisc} primitive. */
export const IconCircle = makeIcon(CircleIcon);
export const IconNSide = makeIcon(HexagonIcon);
export const IconStar = makeIcon(StarIcon);
export const IconHelix = makeIcon(SpiralsIcon);
export const IconSweep = makeIcon(PipelineIcon);
export const IconBoolean = makeIcon(PathfinderUniteIcon);

// lights
export const IconAmbientLight = makeIcon(SunCloud02Icon);
export const IconAreaLight = makeIcon(LayerSendBackwardIcon);
export const IconDirectionalLight = makeIcon(SunsetIcon);
export const IconHemisphereLight = makeIcon(LayerMask01Icon);
export const IconPointLight = makeIcon(BulbIcon);
export const IconSpotlight = makeIcon(SpotlightIcon);

// mesh tools
export const IconBevel = makeIcon(OctagonIcon);
export const IconDissolve = makeIcon(PathfinderMergeIcon);
export const IconExtrude = makeIcon(SquareArrowUp01Icon);
export const IconPen = makeIcon(PenTool03Icon);
export const IconInset = makeIcon(SquareArrowShrink01Icon);
export const IconWeld = makeIcon(GitMergeIcon);

// UI
/** Collapsed-section caret. Rotate 90° with CSS when the section opens. */
export const IconCaretRight = makeIcon(ArrowRight01Icon);
/** Dropdown / expanded-state caret. */
export const IconCaretDown = makeIcon(ArrowDown01Icon);
export const IconClose = makeIcon(Cancel01Icon);
export const IconCollapse = makeIcon(MinusSignSquareIcon);
export const IconDelete = makeIcon(Delete02Icon);
export const IconExpand = makeIcon(PlusSignSquareIcon);
export const IconEye = makeIcon(EyeIcon);
export const IconEyeOff = makeIcon(EyeClosedIcon);
export const IconMagnet = makeIcon(Magnet02Icon);
export const IconPivotPoint = makeIcon(CenterFocusIcon);
export const IconSearch = makeIcon(Search01Icon);
export const IconSettings = makeIcon(Settings01Icon);

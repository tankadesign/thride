import { iconSizeAtom } from "@/ui/hooks/editor/settings";
import {
  Axis3DIcon,
  BulbIcon,
  ChartSplineIcon,
  CheckmarkSquare02Icon,
  Circle,
  Cone01Icon,
  CubeIcon,
  Cursor01Icon,
  Cylinder01Icon,
  Delete02Icon,
  DiamondIcon,
  EyeIcon,
  EyeClosedIcon,
  Folder01Icon,
  GridIcon,
  Idea01Icon,
  LayerMask01Icon,
  LayerSendBackwardIcon,
  MaterialAndTextureIcon,
  MatrixIcon,
  MinusSignSquareIcon,
  PaintBoardIcon,
  PathfinderMergeIcon,
  PentagonIcon,
  PillIcon,
  PlusSignSquareIcon,
  PyramidIcon,
  Search01Icon,
  Settings02Icon,
  SphereIcon,
  SplinePointerIcon,
  SpotlightIcon,
  SquareArrowShrink01Icon,
  SquareArrowUp01Icon,
  SquareIcon,
  SunCloud02Icon,
  SunsetIcon,
  Target01Icon,
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
 * Add icons here only — never import @hugeicons/* elsewhere.
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
export const IconDisc = makeIcon(Circle);
export const IconGenerator = makeIcon(Settings02Icon);
export const IconGroup = makeIcon(Folder01Icon);
export const IconIcosphere = makeIcon(PentagonIcon);
export const IconLight = makeIcon(Idea01Icon);
export const IconNull = makeIcon(Axis3DIcon);
export const IconPlane = makeIcon(DiamondIcon);
export const IconPyramid = makeIcon(PyramidIcon);
export const IconSphere = makeIcon(SphereIcon);
export const IconSpline = makeIcon(ChartSplineIcon);
export const IconTorus = makeIcon(TorusIcon);

// lights
export const IconAmbientLight = makeIcon(SunCloud02Icon);
export const IconAreaLight = makeIcon(LayerSendBackwardIcon);
export const IconDirectionalLight = makeIcon(SunsetIcon);
export const IconHemisphereLight = makeIcon(LayerMask01Icon);
export const IconPointLight = makeIcon(BulbIcon);
export const IconSpotlight = makeIcon(SpotlightIcon);

// mesh tools
export const IconExtrude = makeIcon(SquareArrowUp01Icon);
export const IconInset = makeIcon(SquareArrowShrink01Icon);
export const IconWeld = makeIcon(PathfinderMergeIcon);

// UI
export const IconCollapse = makeIcon(MinusSignSquareIcon);
export const IconDelete = makeIcon(Delete02Icon);
export const IconExpand = makeIcon(PlusSignSquareIcon);
export const IconEye = makeIcon(EyeIcon);
export const IconEyeOff = makeIcon(EyeClosedIcon);
export const IconGrid = makeIcon(GridIcon);
export const IconPivotPoint = makeIcon(CenterFocusIcon);
export const IconSearch = makeIcon(Search01Icon);
export const IconShading = makeIcon(PaintBoardIcon);
export const IconTarget = makeIcon(Target01Icon);
export const IconToggleOff = makeIcon(SquareIcon);
export const IconToggleOn = makeIcon(CheckmarkSquare02Icon);

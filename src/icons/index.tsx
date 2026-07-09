import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import {
  Axis3DIcon,
  BulbIcon,
  ChartSplineIcon,
  CircleIcon,
  Cone01Icon,
  CubeIcon,
  Cursor01Icon,
  Cylinder01Icon,
  Delete02Icon,
  DiamondIcon,
  EyeIcon,
  EyeOffIcon,
  Folder01Icon,
  GridIcon,
  Idea01Icon,
  LayerMask01Icon,
  LayerSendBackwardIcon,
  MaterialAndTextureIcon,
  MinusSignSquareIcon,
  PaintBoardIcon,
  PentagonIcon,
  PlusSignSquareIcon,
  PyramidIcon,
  Search01Icon,
  Settings02Icon,
  SphereIcon,
  SplinePointerIcon,
  SpotlightIcon,
  SunCloud02Icon,
  SunsetIcon,
  Target01Icon,
  ToggleOffIcon,
  ToggleOnIcon,
  TorusIcon,
  TriangleIcon,
  Video02Icon,
} from "@hugeicons/core-free-icons";
import { useAtomValue } from "jotai";
import { iconSizeAtom } from "@/ui/hooks/editor/settings";

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
export const IconPoint = makeIcon(CircleIcon);
export const IconEdge = makeIcon(SplinePointerIcon);
export const IconPolygon = makeIcon(TriangleIcon);
export const IconTexture = makeIcon(MaterialAndTextureIcon);

// primitives / node kinds
export const IconCube = makeIcon(CubeIcon);
export const IconSphere = makeIcon(SphereIcon);
export const IconIcosphere = makeIcon(PentagonIcon);
export const IconCylinder = makeIcon(Cylinder01Icon);
export const IconCone = makeIcon(Cone01Icon);
export const IconTorus = makeIcon(TorusIcon);
export const IconPlane = makeIcon(DiamondIcon);
export const IconPyramid = makeIcon(PyramidIcon);
export const IconNull = makeIcon(Axis3DIcon);
export const IconCamera = makeIcon(Video02Icon);
export const IconLight = makeIcon(Idea01Icon);
export const IconSpline = makeIcon(ChartSplineIcon);
export const IconGenerator = makeIcon(Settings02Icon);
export const IconGroup = makeIcon(Folder01Icon);

// lights
export const IconSpotlight = makeIcon(SpotlightIcon);
export const IconPointLight = makeIcon(BulbIcon);
export const IconDirectionalLight = makeIcon(SunsetIcon);
export const IconAmbientLight = makeIcon(SunCloud02Icon);
export const IconHemisphereLight = makeIcon(LayerMask01Icon);
export const IconAreaLight = makeIcon(LayerSendBackwardIcon);

// UI
export const IconToggleOn = makeIcon(ToggleOnIcon);
export const IconToggleOff = makeIcon(ToggleOffIcon);
export const IconTarget = makeIcon(Target01Icon);
export const IconGrid = makeIcon(GridIcon);
export const IconShading = makeIcon(PaintBoardIcon);
export const IconEye = makeIcon(EyeIcon);
export const IconEyeOff = makeIcon(EyeOffIcon);
export const IconSearch = makeIcon(Search01Icon);
export const IconDelete = makeIcon(Delete02Icon);
export const IconExpand = makeIcon(PlusSignSquareIcon);
export const IconCollapse = makeIcon(MinusSignSquareIcon);

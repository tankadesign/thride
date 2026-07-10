import { Color } from "three";
import { themeColor } from "@/render/scene-sync/themeColor";

/**
 * Centralized Three.js color theme for the viewport. Every hard-coded color
 * that used to live scattered across the render layer is defined here once,
 * so a future settings panel can drive the whole viewport from one place.
 *
 * Two kinds of entry:
 *  - **Semantic** colors resolve live from the daisyUI theme's CSS custom
 *    properties (see `SEMANTIC_SPECS`) so they track the active daisy theme —
 *    e.g. axis X/Y/Z map to `error`/`success`/`info`, selection to `primary`.
 *  - **Custom** viewport colors (`CUSTOM_SPECS`) are fixed values that have no
 *    daisyUI equivalent (surface albedo, grid, backgrounds, light rig…). They
 *    are still centralized here and still user-adjustable at runtime.
 *
 * Colors are held as mutable `Color` instances. `refreshViewportTheme()`
 * re-resolves values *in place* (via `.copy()`), so any material or object
 * that was handed a `viewportTheme.*` Color — or that a caller re-pushes via
 * `ViewportSystem.applyTheme()` — reflects the change without re-importing.
 */

/** daisyUI CSS variable + fallback (the resolved `sunset` value). */
interface SemanticSpec {
  cssVar: string;
  fallback: string;
}

const SEMANTIC_SPECS = {
  primary: { cssVar: "--color-primary", fallback: "#ff865b" },
  secondary: { cssVar: "--color-secondary", fallback: "#fd6f9c" },
  accent: { cssVar: "--color-accent", fallback: "#b387fa" },
  success: { cssVar: "--color-success", fallback: "#addfad" },
  warning: { cssVar: "--color-warning", fallback: "#f1c892" },
  info: { cssVar: "--color-info", fallback: "#89e0eb" },
  error: { cssVar: "--color-error", fallback: "#febbbd" },
  baseContent: { cssVar: "--color-base-content", fallback: "#9fb9d0" },
} as const satisfies Record<string, SemanticSpec>;

const CUSTOM_SPECS = {
  /** Viewport clear color for inactive panes. */
  backgroundColor: 0x101014,
  /** Viewport clear color for the active pane (subtly lighter). */
  activeBackgroundColor: 0x12121a,
  /** Grid major (axis-crossing) lines. */
  gridLineColor: 0x333340,
  /** Grid minor (cell) lines. */
  gridCellColor: 0x22222a,
  /** Shaded surface albedo (PBR + Flat). */
  polygonColor: 0xb8b8c0,
  /** "Lines" overlay edges drawn over shaded surfaces. */
  lineColor: 0x14151a,
  /** Wireframe-mode edges + component-mode wire overlay. */
  wireframeColor: 0x8a93a8,
  /** Component-mode vertex points. */
  pointColor: 0xd8dce8,
  /** Gizmo view-plane center handle. */
  gizmoCenterColor: 0xdddddd,
  /** Primitive drag handles. */
  handleColor: 0xffd60a,
  /** Primitive drag handle while hovered. */
  handleHoverColor: 0xffffff,
  /** Default studio key + ambient light. */
  lightKeyColor: 0xffffff,
  lightAmbientColor: 0xffffff,
  /** Default studio fill light (cool). */
  lightFillColor: 0x8899bb,
} as const satisfies Record<string, number>;

type SemanticKey = keyof typeof SEMANTIC_SPECS;
type CustomKey = keyof typeof CUSTOM_SPECS;

/** Resolved viewport theme. Fields are live `Color` instances (see module doc). */
export interface ViewportTheme extends Record<SemanticKey | CustomKey, Color> {
  /** Axis colors — X/Y/Z map to daisyUI error/success/info. */
  gizmo: { x: Color; y: Color; z: Color; center: Color };
}

function resolveSemantic(key: SemanticKey): Color {
  const spec = SEMANTIC_SPECS[key];
  return themeColor(spec.cssVar, spec.fallback);
}

// Backing store: one Color instance per key, mutated in place by refresh so
// references handed out through `viewportTheme` stay valid across theme edits.
const semantic = Object.fromEntries(
  (Object.keys(SEMANTIC_SPECS) as SemanticKey[]).map((k) => [k, resolveSemantic(k)]),
) as Record<SemanticKey, Color>;
const custom = Object.fromEntries(
  (Object.keys(CUSTOM_SPECS) as CustomKey[]).map((k) => [k, new Color(CUSTOM_SPECS[k])]),
) as Record<CustomKey, Color>;

/** The single source of truth for viewport colors. */
export const viewportTheme: ViewportTheme = {
  ...semantic,
  ...custom,
  gizmo: {
    x: semantic.error,
    y: semantic.success,
    z: semantic.info,
    center: custom.gizmoCenterColor,
  },
};

/**
 * Re-resolve every semantic color from the current CSS variables, in place.
 * Custom colors are left untouched unless a caller has assigned to them.
 * After calling this, run `ViewportSystem.applyTheme()` to push the new
 * values into already-constructed materials and scene chrome.
 */
export function refreshViewportTheme(): void {
  for (const key of Object.keys(SEMANTIC_SPECS) as SemanticKey[]) {
    semantic[key].copy(resolveSemantic(key));
  }
}

/** CSS-ready `rgb(...)` string for a theme color, for 2D DOM/SVG viewport chrome. */
export function themeStyle(color: Color): string {
  return color.getStyle();
}

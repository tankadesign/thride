/** Light node payload, stored at node.data.light. */
export type LightType = "spot" | "point" | "directional" | "ambient" | "hemisphere" | "area";

/** Shadow-map resolution presets (→ 1024 / 2048 / 4096 px). */
export type ShadowResolution = "low" | "normal" | "high";

export const SHADOW_RESOLUTION_PX: Record<ShadowResolution, number> = {
  low: 1024,
  normal: 2048,
  high: 4096,
};

export interface LightDataDTO {
  type: LightType;
  color: string; // hex, e.g. "#ffffff"
  intensity: number;
  /** Only meaningful for shadow-capable types (spot/point/directional). */
  castShadow?: boolean;
  // ---- shadow quality (spot/point/directional) ----
  shadowResolution?: ShadowResolution; // map size preset
  /** Soft-shadow blur radius (PCF). Higher = softer edges. */
  shadowBlur?: number;
  /** Shadow frustum extent: directional = ortho half-size, spot = far distance.
   *  Tighter = crisper (higher effective resolution over the covered area). */
  shadowSize?: number;
  // spot
  angle?: number; // radians
  penumbra?: number; // 0..1
  // hemisphere
  groundColor?: string;
  // area
  width?: number;
  height?: number;
}

export const LIGHT_LABELS: Record<LightType, string> = {
  spot: "Spotlight",
  point: "Point",
  directional: "Infinite",
  ambient: "Ambient",
  hemisphere: "Hemisphere",
  area: "Area",
};

export const SHADOW_CAPABLE: ReadonlySet<LightType> = new Set(["spot", "point", "directional"]);

export function defaultLightData(type: LightType): LightDataDTO {
  switch (type) {
    case "spot":
      return {
        type,
        color: "#ffffff",
        intensity: 40,
        castShadow: true,
        shadowResolution: "normal",
        shadowBlur: 4,
        shadowSize: 60,
        angle: Math.PI / 5,
        penumbra: 0.25,
      };
    case "point":
      return {
        type,
        color: "#ffffff",
        intensity: 30,
        castShadow: true,
        shadowResolution: "normal",
        shadowBlur: 4,
        shadowSize: 60,
      };
    case "directional":
      return {
        type,
        color: "#ffffff",
        intensity: 2.5,
        castShadow: true,
        shadowResolution: "normal",
        shadowBlur: 4,
        shadowSize: 20,
      };
    case "ambient":
      return { type, color: "#ffffff", intensity: 0.4 };
    case "hemisphere":
      return { type, color: "#bcd0ff", groundColor: "#4a3c2c", intensity: 0.7 };
    case "area":
      return { type, color: "#ffffff", intensity: 6, width: 2, height: 2 };
  }
}

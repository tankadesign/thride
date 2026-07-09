/** Light node payload, stored at node.data.light. */
export type LightType = "spot" | "point" | "directional" | "ambient" | "hemisphere" | "area";

export interface LightDataDTO {
  type: LightType;
  color: string; // hex, e.g. "#ffffff"
  intensity: number;
  /** Only meaningful for shadow-capable types (spot/point/directional). */
  castShadow?: boolean;
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
        angle: Math.PI / 5,
        penumbra: 0.25,
      };
    case "point":
      return { type, color: "#ffffff", intensity: 30, castShadow: true };
    case "directional":
      return { type, color: "#ffffff", intensity: 2.5, castShadow: true };
    case "ambient":
      return { type, color: "#ffffff", intensity: 0.4 };
    case "hemisphere":
      return { type, color: "#bcd0ff", groundColor: "#4a3c2c", intensity: 0.7 };
    case "area":
      return { type, color: "#ffffff", intensity: 6, width: 2, height: 2 };
  }
}

import { describe, expect, it } from "vite-plus/test";
import {
  focalLengthFromHFov,
  fovFromFocalLength,
  hFovFromFocalLength,
  SENSOR_WIDTH,
} from "./camera";

describe("camera lens conversions", () => {
  it("horizontal FOV of a 50mm on full-frame is ~39.6°", () => {
    // 2·atan(18/50) ≈ 39.6° — the classic "normal" lens
    expect(hFovFromFocalLength(50)).toBeCloseTo(39.598, 2);
  });

  it("hFov is independent of the sensor-height/aspect (uses SENSOR_WIDTH)", () => {
    expect(SENSOR_WIDTH).toBe(36);
    // a wider lens → wider fov, monotonic
    expect(hFovFromFocalLength(24)).toBeGreaterThan(hFovFromFocalLength(50));
    expect(hFovFromFocalLength(85)).toBeLessThan(hFovFromFocalLength(50));
  });

  it("round-trips focalLength → hFov → focalLength", () => {
    for (const fl of [12, 24, 35, 50, 85, 200]) {
      expect(focalLengthFromHFov(hFovFromFocalLength(fl))).toBeCloseTo(fl, 4);
    }
  });

  it("vertical fov matches three's convention (filmHeight = sensorW / max(aspect,1))", () => {
    // landscape 16:9: filmHeight = 36/(16/9) = 20.25; vfov = 2·atan(0.5·20.25/50)
    const expected = 2 * Math.atan((0.5 * (36 / (16 / 9))) / 50) * (180 / Math.PI);
    expect(fovFromFocalLength(50, 16 / 9)).toBeCloseTo(expected, 6);
    // taller frame (smaller aspect) → larger vertical fov for the same lens
    expect(fovFromFocalLength(50, 1)).toBeGreaterThan(fovFromFocalLength(50, 16 / 9));
  });
});

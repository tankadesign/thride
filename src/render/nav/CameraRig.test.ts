import { describe, expect, it } from "vite-plus/test";
import { Vector3 } from "three";
import { CameraRig } from "./CameraRig";

const up = (rig: CameraRig) => new Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 1);
const fwdPhi = (rig: CameraRig) =>
  Math.acos(Math.max(-1, Math.min(1, rig.camera.getWorldDirection(new Vector3()).y)));

describe("CameraRig perspective orbit", () => {
  it("never inverts or crosses the poles under sustained vertical orbiting", () => {
    const rig = new CameraRig("persp");
    const pivot = new Vector3(0, 0, 0);
    // grind up hard, then down hard, then mixed — the old sign bug flipped
    // the camera over the pole and trapped it upside down
    for (let i = 0; i < 300; i++) rig.orbitAround(pivot, 0, -40);
    expect(up(rig).y).toBeGreaterThan(0);
    expect(fwdPhi(rig)).toBeGreaterThan(0.01);
    for (let i = 0; i < 600; i++) rig.orbitAround(pivot, 0, 40);
    expect(up(rig).y).toBeGreaterThan(0);
    expect(fwdPhi(rig)).toBeLessThan(Math.PI - 0.01);
    for (let i = 0; i < 400; i++) rig.orbitAround(pivot, 25, i % 2 ? 60 : -35);
    expect(up(rig).y).toBeGreaterThan(0);
  });

  it("recovers from the pole clamp — pitching away is never stuck", () => {
    const rig = new CameraRig("persp");
    const pivot = new Vector3(0, 0, 0);
    for (let i = 0; i < 300; i++) rig.orbitAround(pivot, 0, -40); // pinned near top pole
    const phiAtPole = fwdPhi(rig);
    rig.orbitAround(pivot, 0, 40); // one drag back down
    expect(fwdPhi(rig)).toBeGreaterThan(phiAtPole + 0.05);
  });

  it("accumulates no roll: camera right stays horizontal through orbit storms", () => {
    const rig = new CameraRig("persp");
    const pivot = new Vector3(1, 2, -3);
    for (let i = 0; i < 500; i++) {
      rig.orbitAround(pivot, Math.sin(i) * 50, Math.cos(i * 0.7) * 50);
    }
    const right = new Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 0);
    expect(Math.abs(right.y)).toBeLessThan(1e-3);
  });
});

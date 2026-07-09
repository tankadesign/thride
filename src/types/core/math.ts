/** Tuple math types used across DTOs. Kept as plain arrays for cheap JSON serialization. */

export type Vec2 = [x: number, y: number];
export type Vec3 = [x: number, y: number, z: number];
export type Vec4 = [x: number, y: number, z: number, w: number];
/** Euler angles in radians, XYZ order (UI converts to degrees at the widget boundary). */
export type EulerXYZ = [x: number, y: number, z: number];
export type Quat = [x: number, y: number, z: number, w: number];
export type Mat4 = number[]; // 16 elements, column-major (three.js convention)

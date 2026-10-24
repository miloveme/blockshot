import type { Vec3 } from "./schema";

/** Minimal quaternion math for the rig (x, y, z, w). Euler orders match three.js so rig poses apply 1:1 in the renderer. */
export type Quat = [x: number, y: number, z: number, w: number];

export const Q = {
  identity: (): Quat => [0, 0, 0, 1],

  /** a · b — apply b first, then a. */
  mul(a: Quat, b: Quat): Quat {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  },

  inv: (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]],

  normalize(q: Quat): Quat {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },

  /** Euler (radians) → quaternion. XYZ = three.js default (x applied last); YXZ = the order the Spec uses for actors. */
  fromEuler(x: number, y: number, z: number, order: "XYZ" | "YXZ" = "XYZ"): Quat {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    if (order === "YXZ") {
      return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    }
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
  },

  /** Quaternion → Euler XYZ (radians). */
  toEuler(q: Quat): Vec3 {
    const [x, y, z, w] = q;
    const m11 = 1 - 2 * (y * y + z * z);
    const m12 = 2 * (x * y - z * w);
    const m13 = 2 * (x * z + y * w);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - x * w);
    const m32 = 2 * (y * z + x * w);
    const m33 = 1 - 2 * (x * x + y * y);
    const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
    if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
    return [Math.atan2(m32, m22), ey, 0];
  },

  /** Rotation about a unit axis by `angle` radians. */
  fromAxisAngle(axis: Vec3, angle: number): Quat {
    const s = Math.sin(angle / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  },

  /** Rotation whose local X / Y / Z axes point along the given (orthonormal) world directions. */
  fromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
    const m11 = x[0], m21 = x[1], m31 = x[2];
    const m12 = y[0], m22 = y[1], m32 = y[2];
    const m13 = z[0], m23 = z[1], m33 = z[2];
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
    }
    if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
    }
    if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
    }
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
  },

  /** Quaternion → Euler YXZ (radians): the order the Spec uses for actors and props. */
  toEulerYXZ(q: Quat): Vec3 {
    const [x, y, z, w] = q;
    const m13 = 2 * (x * z + y * w);
    const m21 = 2 * (x * y + z * w);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - x * w);
    const m31 = 2 * (x * z - y * w);
    const m11 = 1 - 2 * (y * y + z * z);
    const m33 = 1 - 2 * (x * x + y * y);
    const ex = Math.asin(-Math.max(-1, Math.min(1, m23)));
    if (Math.abs(m23) < 0.9999999) return [ex, Math.atan2(m13, m33), Math.atan2(m21, m22)];
    return [ex, Math.atan2(-m31, m11), 0];
  },

  rotate(q: Quat, v: Vec3): Vec3 {
    const [qx, qy, qz, qw] = q;
    // v' = v + 2w(q × v) + 2 q × (q × v)
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
  },

  /** Shortest rotation taking unit vector a onto unit vector b. */
  fromUnitVectors(a: Vec3, b: Vec3): Quat {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (d < -0.999999) {
      // opposite: any perpendicular axis
      const axis: Vec3 = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [a[2], 0, -a[0]];
      const l = Math.hypot(...axis) || 1;
      return [axis[0] / l, axis[1] / l, axis[2] / l, 0];
    }
    return Q.normalize([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + d]);
  },

  slerp(a: Quat, b: Quat, t: number): Quat {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const bb: Quat = cos < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
    cos = Math.abs(cos);
    if (cos > 0.9995) return Q.normalize([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
    const theta = Math.acos(cos);
    const s = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / s;
    const wb = Math.sin(t * theta) / s;
    return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
  },
};

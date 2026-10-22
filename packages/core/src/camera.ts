import { SENSORS, type Sensor } from "./schema";
import { DEG } from "./math";

export function sensorSize(sensor: Sensor): readonly [number, number] {
  return typeof sensor === "string" ? SENSORS[sensor] : sensor;
}

/**
 * Vertical field of view (degrees) for a physical lens.
 * The sensor is fit horizontally to the render aspect (horizontal fit, like most cine cameras):
 * effective sensor height = sensorWidth / aspect.
 */
export function verticalFov(focalLength: number, sensor: Sensor, aspect: number): number {
  const [sensorWidth] = sensorSize(sensor);
  const sensorHeight = sensorWidth / aspect;
  return (2 * Math.atan(sensorHeight / (2 * focalLength))) / DEG;
}

export function horizontalFov(focalLength: number, sensor: Sensor): number {
  const [sensorWidth] = sensorSize(sensor);
  return (2 * Math.atan(sensorWidth / (2 * focalLength))) / DEG;
}

export const LENS_PRESETS = [14, 18, 24, 35, 50, 85, 135] as const;

"use client";

import * as THREE from "three";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, getFirstEncodableVideoCodec } from "mediabunny";
import { DEG, planFrames, type PlannedFrame, type Vec3 } from "@blockshot/core";
import { useStudio } from "./store";
import { aimCamera } from "@/components/viewport/util";

/**
 * Offline renderer (docs/ARCHITECTURE.md §3.3). Steps the timeline frame by frame, lets the viewport's own
 * useFrame callbacks pose the scene (R3F `advance`), renders the shared scene graph from the shot camera into a
 * separate WebGLRenderer at output resolution, and encodes with WebCodecs (mediabunny). Nothing leaves the browser.
 */

export interface ViewportBridge {
  scene: THREE.Scene;
  gl: THREE.WebGLRenderer;
  /** runs every useFrame subscriber once (poses actors, cameras…) */
  advance: (timestamp: number) => void;
  /** free-view camera pose (for "match camera to view") */
  freeView: () => { position: Vec3; target: Vec3 } | null;
  /** eases the edit-view orbit camera so `target` fills the view (F / A); false when the edit view is not live */
  frame: (target: { center: Vec3; radius: number }) => boolean;
}

let bridge: ViewportBridge | null = null;
export const registerBridge = (b: ViewportBridge | null) => {
  bridge = b;
};
export const getBridge = () => bridge;

export type RenderPass = "beauty" | "depth";

export interface RenderOptions {
  /** which scene time / camera each output frame shows — from core planFrames (the edit, or one camera) */
  frames: PlannedFrame[];
  width: number;
  height: number;
  pass: RenderPass;
  /** depth pass: distance (m) mapped to black */
  depthFar: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface CameraFrame {
  /** output frame index */
  frame: number;
  /** scene time shown */
  t: number;
  camera: string;
  shot: string | null;
  position: Vec3;
  /** Euler YXZ, degrees */
  rotation: Vec3;
  focalLength: number;
  vFov: number;
}

export interface RenderResult {
  blob: Blob;
  extension: string;
  cameraLog: { fps: number; width: number; height: number; frames: CameraFrame[] };
}

const DEPTH_NEAR = 0.1;

function depthMaterial(far: number) {
  // linear view-space depth, near = white, far = black (ControlNet / video-model depth convention)
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: DEPTH_NEAR }, uFar: { value: far } },
    vertexShader: `varying float vDepth;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNear; uniform float uFar; varying float vDepth;
      void main() { float d = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0); gl_FragColor = vec4(vec3(1.0 - d), 1.0); }`,
  });
}

/** Sets up an offscreen renderer that matches the viewport's color pipeline. */
function createRenderer(b: ViewportBridge, width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.toneMapping = b.gl.toneMapping;
  renderer.toneMappingExposure = b.gl.toneMappingExposure;
  renderer.outputColorSpace = b.gl.outputColorSpace;
  renderer.shadowMap.enabled = b.gl.shadowMap.enabled;
  renderer.shadowMap.type = b.gl.shadowMap.type;
  return renderer;
}

/** Poses the scene at time t and draws one frame from the right camera. Returns the camera log entry. */
function drawFrame(b: ViewportBridge, renderer: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, plan: PlannedFrame, index: number, opts: Pick<RenderOptions, "width" | "height">, depth: THREE.Material | null): CameraFrame | null {
  const t = plan.t;
  const id = plan.camera;
  useStudio.getState().setTime(t);
  b.advance(performance.now());
  const c = useStudio.getState().sceneState.cameras[id];
  if (!c) return null;
  aimCamera(cam, c);
  cam.fov = c.vFov;
  cam.aspect = opts.width / opts.height;
  cam.near = 0.05;
  cam.far = 500;
  cam.updateProjectionMatrix();

  const scene = b.scene;
  const bg = scene.background;
  if (depth) {
    scene.overrideMaterial = depth;
    scene.background = new THREE.Color("#000000");
  }
  renderer.render(scene, cam);
  scene.overrideMaterial = null;
  scene.background = bg;

  const e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  return {
    frame: index,
    t: r4(t),
    camera: id,
    shot: plan.shot,
    position: [r4(cam.position.x), r4(cam.position.y), r4(cam.position.z)],
    rotation: [r4(e.x / DEG), r4(e.y / DEG), r4(e.z / DEG)],
    focalLength: r4(c.focalLength),
    vFov: r4(c.vFov),
  };
}

function withTimeline<T>(fn: () => Promise<T>): Promise<T> {
  const s = useStudio.getState();
  const restore = s.time;
  const restoreEdit = s.editTime;
  useStudio.setState({ playing: false, rendering: true });
  return fn().finally(() => {
    useStudio.setState({ rendering: false });
    const after = useStudio.getState();
    if (after.view.kind === "shot") after.setEditTime(restoreEdit);
    else after.setTime(restore);
  });
}

export function renderVideo(opts: RenderOptions): Promise<RenderResult> {
  const b = bridge;
  if (!b) return Promise.reject(new Error("뷰포트가 아직 준비되지 않았습니다"));
  if (!opts.frames.length) return Promise.reject(new Error("렌더할 프레임이 없습니다 (샷 또는 카메라가 필요합니다)"));
  if (typeof VideoEncoder === "undefined") return Promise.reject(new Error("이 브라우저는 WebCodecs 영상 인코딩을 지원하지 않습니다 (Chrome/Edge 최신 버전을 사용하세요)"));

  return withTimeline(async () => {
    const { fps } = useStudio.getState().spec.settings;
    const width = opts.width - (opts.width % 2);
    const height = opts.height - (opts.height % 2);
    const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width, height });
    if (!codec) throw new Error(`${width}×${height} 해상도를 인코딩할 수 있는 코덱이 없습니다`);
    const format = codec === "avc" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();

    const renderer = createRenderer(b, width, height);
    const cam = new THREE.PerspectiveCamera();
    const depth = opts.pass === "depth" ? depthMaterial(opts.depthFar) : null;
    const target = new BufferTarget();
    const output = new Output({ format, target });
    const source = new CanvasSource(renderer.domElement, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: fps });
    const frames: CameraFrame[] = [];

    try {
      await output.start();
      const total = opts.frames.length;
      for (let f = 0; f < total; f++) {
        if (opts.signal?.aborted) {
          await output.cancel();
          throw new DOMException("렌더링을 취소했습니다", "AbortError");
        }
        const log = drawFrame(b, renderer, cam, opts.frames[f]!, f, { width, height }, depth);
        if (log) frames.push(log);
        await source.add(f / fps, 1 / fps);
        opts.onProgress?.(f + 1, total);
      }
      await output.finalize();
      if (!target.buffer) throw new Error("인코딩 결과가 비어 있습니다");
      return {
        blob: new Blob([target.buffer], { type: format.mimeType }),
        extension: format.fileExtension,
        cameraLog: { fps, width, height, frames },
      };
    } finally {
      depth?.dispose();
      renderer.dispose();
    }
  });
}

/** Renders the current time as a PNG (e.g. the first frame for image-to-video models). */
export function renderStill(opts: Pick<RenderOptions, "width" | "height" | "pass" | "depthFar"> & { camera: string }): Promise<Blob> {
  const b = bridge;
  if (!b) return Promise.reject(new Error("뷰포트가 아직 준비되지 않았습니다"));
  return withTimeline(async () => {
    const t = useStudio.getState().time;
    const renderer = createRenderer(b, opts.width, opts.height);
    const depth = opts.pass === "depth" ? depthMaterial(opts.depthFar) : null;
    try {
      if (!drawFrame(b, renderer, new THREE.PerspectiveCamera(), { t, camera: opts.camera, shot: null }, 0, opts, depth)) throw new Error("이 시간에 사용할 카메라가 없습니다");
      return await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 생성 실패"))), "image/png"));
    } finally {
      depth?.dispose();
      renderer.dispose();
    }
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ---- page API for headless callers (the local MCP server drives a Chrome through this) --------------------------------

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

if (typeof window !== "undefined") {
  const scaled = (w: number, scale: number) => Math.round((w * scale) / 2) * 2;
  (window as unknown as { __blockshot: unknown }).__blockshot = {
    ready: () => bridge !== null,
    /** { range?: shot id | "all", from?, to? (seconds: edit time, or scene time with a fixed camera), camera?, scale?, pass?, depthFar? } → encoded video as base64 */
    async video(req: { range?: string; from?: number; to?: number; camera?: string; scale?: number; pass?: RenderPass; depthFar?: number }) {
      const { spec } = useStudio.getState();
      const shot = spec.shots.find((s) => s.id === req.range);
      const frames = planFrames(spec, { shotId: shot?.id, camera: req.camera, from: req.from, to: req.to });
      if (!frames.length) throw new Error("the range has no frames (check from / to against the edit or scene length)");
      const [w, h] = spec.settings.resolution;
      const scale = req.scale && req.scale > 0 ? req.scale : 1;
      const r = await renderVideo({ frames, width: scaled(w, scale), height: scaled(h, scale), pass: req.pass ?? "beauty", depthFar: req.depthFar ?? 12 });
      return { base64: await toBase64(r.blob), extension: r.extension, frames: frames.length, seconds: frames.length / spec.settings.fps, cameraLog: r.cameraLog };
    },
    /** { t, camera?, width?, pass? } → PNG as base64 */
    async still(req: { t: number; camera?: string; width?: number; pass?: RenderPass; depthFar?: number }) {
      const st = useStudio.getState();
      st.setTime(Math.max(0, Math.min(req.t, st.spec.settings.duration)));
      const cam = req.camera ?? useStudio.getState().sceneState.activeCameraId ?? st.spec.cameras[0]?.id;
      if (!cam) throw new Error("no camera in the scene");
      const [w, h] = st.spec.settings.resolution;
      const width = req.width && req.width > 0 ? Math.round(req.width / 2) * 2 : w;
      const height = Math.round(((width * h) / w) / 2) * 2;
      return { base64: await toBase64(await renderStill({ width, height, pass: req.pass ?? "beauty", depthFar: req.depthFar ?? 12, camera: cam })) };
    },
  };
}

// Captures the user-guide screenshots (/guide) with ego-browser and records where the numbered callouts go.
//
//   pnpm --filter web dev -- --port 3210          # dev server (uses the dev-only window.__studio / __ui handles)
//   ego-browser nodejs < apps/web/scripts/guide-shots.ego.mjs
//
// Output: PNGs in the scratch dir → converted to JPEG in apps/web/public/guide/, callout boxes (percent of the shot) in
// apps/web/src/app/guide/shots.json. Every shot first reloads the bundled sample scene, so results are reproducible.
const ROOT = "/Users/jun/Documents/ClaudeWork/Previz";
const BASE = "http://localhost:3210";
const RAW = "/private/tmp/blockshot-guide-raw";
const ONLY = (globalThis.GUIDE_ONLY ?? "").split(",").filter(Boolean);

const fs = await import("node:fs/promises");
const { execFileSync } = await import("node:child_process");
await fs.mkdir(RAW, { recursive: true });
await fs.mkdir(`${ROOT}/apps/web/public/guide`, { recursive: true });

const task = await taskSpace(globalThis.GUIDE_SPACE ?? "blockshot 도움말 스크린샷");
const page = task.page("p1");
const W = 1440;
const H = 900;

async function emulate() {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
}

/** Fresh studio with the sample scene and a known UI state. */
async function studio(setup, arg) {
  await emulate();
  await page.goto(`${BASE}/studio`);
  await page.waitForFunction(() => !!window.__studio && !!window.__ui && !!window.blockshot && !!document.querySelector("canvas"), undefined, { timeout: 60000 });
  await page.evaluate(async () => {
    const json = await (await fetch("/examples/living-room.json")).json();
    window.blockshot.load(json);
    window.__ui.getState().set({ leftOpen: true, rightOpen: true, bottomOpen: true, leftTab: "outliner", pipOpen: false, noteOpen: false, paletteOpen: false, contextMenu: null });
    const S = window.__studio.getState();
    S.setLayout?.("3d");
    S.setPanel("scene");
    S.setView({ kind: "free" });
    S.select(null);
    S.setTime(0);
  });
  if (setup) await page.evaluate(setup, arg ?? null);
  await page.waitForTimeout(2600);
}

/** Boxes (CSS px) of UI elements: "label:<aria-label/tooltip>", "text:<exact text>", "rect:x,y,w,h" or a CSS selector. */
async function boxes(queries) {
  return page.evaluate((qs) => {
    document.querySelector("nextjs-portal")?.remove();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const smallest = (els) => els.filter(visible).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
    const find = (q) => {
      // "up:N:<query>" — the element N levels above the match (e.g. a dialog around its heading)
      const up = /^up:(\d+):(.*)$/.exec(q);
      if (up) {
        let el = findEl(up[2]);
        for (let i = 0; el && i < Number(up[1]); i++) el = el.parentElement;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      if (q.startsWith("rect:")) {
        const [x, y, w, h] = q.slice(5).split(",").map(Number);
        return { x, y, width: w, height: h };
      }
      const el = findEl(q);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    function findEl(q) {
      let el;
      if (q.startsWith("label:")) {
        const t = q.slice(6);
        el = smallest([...document.querySelectorAll("[aria-label],[data-tip],[title]")].filter((e) => (e.getAttribute("aria-label") ?? e.dataset.tip ?? e.getAttribute("title") ?? "").startsWith(t)));
      } else if (q.startsWith("text:")) {
        const t = q.slice(5);
        el = smallest([...document.querySelectorAll("body *")].filter((e) => e.textContent?.trim() === t));
      } else el = smallest([...document.querySelectorAll(q)]);
      return el ?? null;
    }
    return qs.map((q) => ({ q, box: find(q) }));
  }, queries);
}

const VIEWPORT = "rect:300,154,812,456";
const LEFT = "rect:44,44,248,636";
const RIGHT = "rect:1120,44,320,636";
const TIMELINE = "rect:0,680,1440,196";

const meta = {};
try {
  meta.__prev = JSON.parse(await fs.readFile(`${ROOT}/apps/web/src/app/guide/shots.json`, "utf8"));
} catch {}

/** Takes a shot: `crop` query (or full window), callouts as queries in order (①, ②, …). */
async function shoot(name, { crop, marks = [], pad = 0 }) {
  const [cropBox] = crop ? await boxes([crop]) : [{ box: { x: 0, y: 0, width: W, height: H } }];
  if (!cropBox.box) throw new Error(`${name}: crop not found (${crop})`);
  const c = { x: Math.max(0, cropBox.box.x - pad), y: Math.max(0, cropBox.box.y - pad), width: Math.min(W, cropBox.box.width + pad * 2), height: Math.min(H, cropBox.box.height + pad * 2) };
  const found = await boxes(marks);
  const missing = found.filter((f) => !f.box).map((f) => f.q);
  if (missing.length) console.log(`  ! ${name}: callouts not found: ${missing.join(" | ")}`);
  const raw = `${RAW}/${name}.png`;
  await page.screenshot({ path: raw, clip: c });
  const out = `${ROOT}/apps/web/public/guide/${name}.jpg`;
  // 2× capture → JPEG, at most 1800 px wide (sharp on retina, small enough for the web)
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", "--resampleWidth", String(Math.min(1800, Math.round(c.width * 2))), raw, "--out", out], { stdio: "ignore" });
  const pct = (v, total) => Math.round((v / total) * 10000) / 100;
  meta[name] = {
    src: `/guide/${name}.jpg`,
    width: Math.round(c.width),
    height: Math.round(c.height),
    marks: found.map((f, i) =>
      f.box
        ? { n: i + 1, x: pct(f.box.x - c.x, c.width), y: pct(f.box.y - c.y, c.height), w: pct(f.box.width, c.width), h: pct(f.box.height, c.height) }
        : { n: i + 1, x: 0, y: 0, w: 0, h: 0 },
    ),
  };
  console.log(`✓ ${name}`);
}

const SHOTS = {
  async projects() {
    await emulate();
    await page.goto(`${BASE}/projects`);
    await page.waitForTimeout(2500);
    await shoot("projects", { marks: ["text:＋ 새 프로젝트", "text:파일에서 가져오기", "text:열기"] });
  },
  async "projects-new"() {
    await emulate();
    await page.goto(`${BASE}/projects`);
    await page.waitForTimeout(2000);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "＋ 새 프로젝트")?.click());
    await page.waitForTimeout(800);
    await shoot("projects-new", { crop: "up:1:text:새 프로젝트", pad: 24, marks: ["input[placeholder='새 프로젝트']"] });
  },
  async overview() {
    await studio(() => {
      const S = window.__studio.getState();
      S.select("minsu");
      S.setTime(2.4);
      window.__ui.getState().set({ pipOpen: true });
    });
    await shoot("overview", {
      marks: ["header", "rect:0,44,44,636", LEFT, "rect:292,44,828,40", VIEWPORT, RIGHT, TIMELINE, "footer"],
    });
  },
  async assets() {
    await studio(() => window.__ui.getState().set({ leftTab: "assets" }));
    await shoot("assets", { crop: "rect:0,44,1120,636", marks: ["text:에셋", "text:인물", "text:소파"] });
  },
  async gizmo() {
    await studio(() => {
      const S = window.__studio.getState();
      S.select("sofa");
      S.setGizmoMode("translate");
    });
    await page.press("body", "f");
    await page.waitForTimeout(1500);
    await shoot("gizmo", { crop: "rect:0,44,1120,636", marks: ["label:이동", "label:회전", "label:크기", VIEWPORT] });
  },
  async inspector() {
    await studio(() => {
      const S = window.__studio.getState();
      S.select("minsu");
      S.setTime(1.2);
    });
    await shoot("inspector", { crop: RIGHT, marks: ["text:인물", "text:트랜스폼", "text:◆ 키 추가", "text:타겟 포인트"] });
  },
  async path() {
    await studio(() => {
      const S = window.__studio.getState();
      S.select("minsu");
      S.setTime(0.2);
    });
    await page.press("body", "f");
    await page.waitForTimeout(1500);
    await shoot("path", { marks: [VIEWPORT, "text:이동 경로"] });
  },
  async keys() {
    await studio(() => {
      const S = window.__studio.getState();
      S.select("minsu");
      S.setTime(2.4);
    });
    await shoot("keys", { crop: "rect:0,676,1440,224", marks: ["label:재생", "label:라이브 녹화", "label:자동 키", "label:인물·카메라의 키와 동작", "text:민수", "text:walkTo"] });
  },
  async camera() {
    await studio(() => {
      const S = window.__studio.getState();
      S.select("camA");
      S.setTime(1.5);
      window.__ui.getState().set({ pipOpen: true });
    });
    await shoot("camera", { marks: ["text:A — 와이드", VIEWPORT, "text:피사체 고정", "text:📐 현재 자유 시점으로 맞추기"] });
  },
  async "camera-view"() {
    await studio(() => {
      const S = window.__studio.getState();
      S.select("camA");
      S.setView({ kind: "camera", id: "camA" });
      S.setTime(2.0);
    });
    await shoot("camera-view", { crop: "rect:292,44,828,636", marks: ["label:카메라 시점", "label:카메라 직접 조작", "text:50", VIEWPORT] });
  },
  async cut() {
    await studio(() => {
      const S = window.__studio.getState();
      S.edit((sp) => ({ ...sp, shots: sp.shots.map((x, i) => (i === 0 ? { ...x, description: "민수가 들어와 소파 쪽으로 걷는다. 카메라는 천천히 달리 인." } : x)) }));
      S.setView({ kind: "shot" });
      S.setEditTime(1.6);
    });
    await shoot("cut", { marks: ["label:컷 재생", "text:CUT", "label:컷 설명", "label:선택 도구", "label:면도날 도구", "text:1. S1 · A — 와이드"] });
  },
  async "cut-tools"() {
    await studio(() => {
      const S = window.__studio.getState();
      S.setView({ kind: "shot" });
      S.setEditTime(1.6);
    });
    await page.hover("loc=css:[aria-label='면도날 도구']");
    await page.waitForTimeout(900);
    await shoot("cut-tools", { crop: "rect:0,676,900,130", marks: [] });
  },
  async "edit-panel"() {
    await studio(() => {
      const S = window.__studio.getState();
      S.setView({ kind: "shot" });
      S.setPanel("shots");
      S.setEditTime(5);
    });
    await shoot("edit-panel", { crop: RIGHT, marks: ["text:클립 · 2번째", "text:소스 · 카메라별 전체 테이크", "text:보관함 · 저장해 둔 컷", "text:편집 순서"] });
  },
  async render() {
    await studio(() => window.__studio.getState().setPanel("render"));
    await shoot("render", { crop: RIGHT, marks: ["text:구간", "text:카메라", "text:패스", "text:🎞 영상 렌더 (8.0s)"] });
  },
  async ai() {
    await studio(() => window.__studio.getState().setPanel("ai"));
    await shoot("ai", { crop: RIGHT, marks: [] });
  },
  async plan() {
    await studio(() => {
      const S = window.__studio.getState();
      S.setLayout("split");
      S.select("camA");
      S.setTime(2);
    });
    await shoot("plan", { crop: "rect:292,44,828,636", marks: ["label:3D + 탑뷰", "rect:300,92,404,580", "rect:712,92,400,580"] });
  },
  async palette() {
    await studio(() => window.__ui.getState().set({ paletteOpen: true }));
    await page.keyboard.type("카메라");
    await page.waitForTimeout(700);
    await shoot("palette", { crop: "rect:300,44,840,560", marks: [] });
  },
};

for (const [name, run] of Object.entries(SHOTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  try {
    await run();
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
  }
}
const prev = meta.__prev ?? {};
delete meta.__prev;
await fs.writeFile(`${ROOT}/apps/web/src/app/guide/shots.json`, JSON.stringify({ ...prev, ...meta }, null, 2) + "\n");
console.log({ space: task.spaceId, wrote: Object.keys(meta) });

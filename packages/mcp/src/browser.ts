import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { HEADLESS_SHELL } from "./headless-shell.generated";

/**
 * The browser the local renders run in: an installed Chromium-based browser (Chrome, Edge, Chromium, Brave) when there is
 * one — nothing to download — otherwise a pinned Chrome for Testing `chrome-headless-shell` that the server downloads
 * once into ~/.blockshot/browsers (size + SHA-256 checked).
 */

export const SHELL_PLATFORMS = ["mac-arm64", "mac-x64", "linux64", "linux-arm64", "win64", "win32"] as const;
export type ShellPlatform = (typeof SHELL_PLATFORMS)[number];

export const shellZipUrl = (version: string, platform: string) =>
  `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/chrome-headless-shell-${platform}.zip`;

export function shellPlatform(): ShellPlatform | null {
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "mac-arm64" : "mac-x64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : arch === "x64" ? "linux64" : null;
  // Windows on Arm runs the x64 build under emulation
  if (platform === "win32") return arch === "ia32" ? "win32" : "win64";
  return null;
}

const browsersDir = () => join(process.env.BLOCKSHOT_HOME ?? join(homedir(), ".blockshot"), "browsers");
const shellDir = (version: string) => join(browsersDir(), `chrome-headless-shell-${version}`);
const shellExe = (version: string, platform: ShellPlatform) =>
  join(shellDir(version), `chrome-headless-shell-${platform}`, platform.startsWith("win") ? "chrome-headless-shell.exe" : "chrome-headless-shell");

/** The pinned shell's executable if it is installed, else null. */
export function installedShell(): string | null {
  const platform = shellPlatform();
  if (!platform) return null;
  const exe = shellExe(HEADLESS_SHELL.version, platform);
  return existsSync(exe) ? exe : null;
}

let installing: Promise<string> | null = null;

/** Downloads, verifies and unpacks the pinned shell (once per process; a no-op when it is there). Returns the executable. */
export function installShell(log: (msg: string) => void = () => {}): Promise<string> {
  const have = installedShell();
  if (have) return Promise.resolve(have);
  installing ??= doInstall(log).finally(() => {
    installing = null;
  });
  return installing;
}

async function doInstall(log: (msg: string) => void): Promise<string> {
  const platform = shellPlatform();
  if (!platform) throw new Error(`no chrome-headless-shell build for ${process.platform}/${process.arch}`);
  const { version } = HEADLESS_SHELL;
  const pin = (HEADLESS_SHELL.files as Record<string, { size: number; sha256: string }>)[platform];
  if (!pin) throw new Error(`chrome-headless-shell ${version} is not pinned for ${platform}`);
  const url = shellZipUrl(version, platform);
  log(`Downloading the renderer (chrome-headless-shell ${version}, ${platform}, ${(pin.size / 1024 / 1024).toFixed(0)} MB) from ${url}`);

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  let got = 0;
  let shown = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    got += chunk.length;
    if (got - shown > pin.size / 10) {
      shown = got;
      log(`  ${Math.round((got / pin.size) * 100)}%`);
    }
  }
  const zip = Buffer.concat(chunks);
  const sha256 = createHash("sha256").update(zip).digest("hex");
  if (zip.length !== pin.size || sha256 !== pin.sha256) throw new Error(`the download does not match the pinned file (size ${zip.length}, sha256 ${sha256}) — try again`);

  // unpack next to the final folder, then rename: a crash midway never leaves a half-installed shell behind
  const final = shellDir(version);
  const tmp = `${final}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  unzip(zip, tmp);
  rmSync(final, { recursive: true, force: true });
  renameSync(tmp, final);
  // older pinned versions are no longer used
  for (const name of readdirSync(browsersDir())) {
    if (name.startsWith("chrome-headless-shell-") && join(browsersDir(), name) !== final) rmSync(join(browsersDir(), name), { recursive: true, force: true });
  }
  const exe = shellExe(version, platform);
  if (!existsSync(exe)) throw new Error(`unpacked, but ${exe} is missing`);
  log(`Installed ${exe}`);
  return exe;
}

/** Minimal zip reader (stored / deflate, no zip64 — the shell zips are < 4 GB): enough for Chrome for Testing archives. */
export function unzip(zip: Buffer, into: string) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const root = resolve(into);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip directory");
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const mode = zip.readUInt32LE(p + 38) >>> 16;
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const target = resolve(root, name);
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`unsafe path in zip: ${name}`);
    if (name.endsWith("/")) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    if ((mode & 0o170000) === 0o120000) throw new Error(`symlinks are not supported: ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported compression ${method}: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    if (process.platform !== "win32" && mode & 0o111) chmodSync(target, mode & 0o777);
  }
}

/** Installed Chromium-based browsers, tried before downloading the shell. */
const SYSTEM: Record<string, string[]> = {
  darwin: ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Brave Browser.app/Contents/MacOS/Brave Browser", "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"].flatMap(
    (app) => [join("/Applications", app), join(homedir(), "Applications", app)],
  ),
  win32: [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter((d): d is string => !!d)
    .flatMap((d) => [join(d, "Google", "Chrome", "Application", "chrome.exe"), join(d, "Microsoft", "Edge", "Application", "msedge.exe"), join(d, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")]),
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/usr/bin/brave-browser"],
};

export function findSystemBrowser(): string | null {
  return (SYSTEM[process.platform] ?? SYSTEM.linux!).find((p) => existsSync(p)) ?? null;
}

/**
 * The browser to render with: BLOCKSHOT_CHROME if set, else an installed Chromium-based browser, else the pinned shell
 * (downloaded now if missing). `note` says what happened when it is worth telling the user (a download).
 */
export async function resolveBrowser(log?: (msg: string) => void): Promise<{ exe: string; note?: string }> {
  const env = process.env.BLOCKSHOT_CHROME;
  if (env) {
    if (!existsSync(env)) throw new Error(`BLOCKSHOT_CHROME points to a missing file: ${env}`);
    return { exe: env };
  }
  const sys = findSystemBrowser();
  if (sys) return { exe: sys };
  const have = installedShell();
  if (have) return { exe: have };
  try {
    const exe = await installShell(log);
    return { exe, note: `No Chrome / Edge / Chromium was installed, so the renderer (chrome-headless-shell ${HEADLESS_SHELL.version}) was downloaded once into ${browsersDir()}.` };
  } catch (e) {
    throw new Error(`No Chrome / Edge / Chromium is installed and the renderer could not be downloaded (${(e as Error).message}). Check the network and run: node <path>/blockshot-mcp.mjs install-browser`);
  }
}

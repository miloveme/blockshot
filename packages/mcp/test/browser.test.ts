import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { HEADLESS_SHELL } from "../src/headless-shell.generated";
import { installShell, installedShell, shellPlatform, unzip } from "../src/browser";

/** a tiny zip writer (stored or deflate) — enough to feed the reader */
function makeZip(entries: { name: string; data?: string; mode?: number; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.from(e.data ?? "");
    const body = e.deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(e.deflate ? 8 : 0, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "blockshot-browser-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("renderer download", () => {
  it("unzips stored and deflated files, folders and the executable bit", () => {
    const into = join(temp(), "out");
    unzip(makeZip([{ name: "shell/", mode: 0o40755 }, { name: "shell/ABOUT", data: "hello" }, { name: "shell/run", data: "x".repeat(5000), deflate: true, mode: 0o100755 }]), into);
    expect(readFileSync(join(into, "shell/ABOUT"), "utf8")).toBe("hello");
    expect(readFileSync(join(into, "shell/run"), "utf8")).toBe("x".repeat(5000));
    if (process.platform !== "win32") expect(statSync(join(into, "shell/run")).mode & 0o111).toBeTruthy();
  });

  it("refuses paths that escape the target folder", () => {
    const base = temp();
    expect(() => unzip(makeZip([{ name: "../evil", data: "x" }]), join(base, "out"))).toThrow(/unsafe path/);
    expect(existsSync(join(base, "evil"))).toBe(false);
  });

  it("pins a version for this machine", () => {
    const p = shellPlatform();
    expect(p).not.toBeNull();
    const pin = (HEADLESS_SHELL.files as Record<string, { size: number; sha256: string }>)[p!];
    expect(pin?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pin!.size).toBeGreaterThan(50_000_000);
  });

  it("a download that does not match the pin is rejected and nothing is installed", async () => {
    const home = temp();
    vi.stubEnv("BLOCKSHOT_HOME", home);
    const fake = makeZip([{ name: "x/ABOUT", data: "not chrome" }]);
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(fake)));
    await expect(installShell()).rejects.toThrow(/does not match the pinned file/);
    expect(installedShell()).toBeNull();
    expect(existsSync(join(home, "browsers")) ? readdirSync(join(home, "browsers")) : []).toEqual([]);
  });
});

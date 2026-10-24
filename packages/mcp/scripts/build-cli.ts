/**
 * Bundles the local stdio server into ONE self-contained file (QuickJS and the resvg WASM are inlined; Chrome is driven over the DevTools protocol),
 * and publishes a copy to apps/web/public/mcp/ so the hosted site can serve it to an AI that is told to install it.
 */
import { chmodSync, copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../dist/blockshot-mcp.mjs");
mkdirSync(dirname(out), { recursive: true });
await build({
  entryPoints: [resolve(here, "../src/cli.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  loader: { ".wasm": "binary" },
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  minify: true,
  legalComments: "none",
});
chmodSync(out, 0o755);
const pub = resolve(here, "../../../apps/web/public/mcp/blockshot-mcp.mjs");
mkdirSync(dirname(pub), { recursive: true });
copyFileSync(out, pub);
console.log(`built ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB) → ${pub}`);

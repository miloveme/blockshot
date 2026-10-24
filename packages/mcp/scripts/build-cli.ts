/** Bundles the local stdio server into dist/cli.mjs (native / optional deps stay external). */
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../dist/cli.mjs");
mkdirSync(dirname(out), { recursive: true });
await build({
  entryPoints: [resolve(here, "../src/cli.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@resvg/resvg-js", "playwright-core"],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  legalComments: "none",
});
chmodSync(out, 0o755);
console.log(`built ${out}`);

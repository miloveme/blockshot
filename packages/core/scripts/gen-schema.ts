/**
 * Publishes LLM-facing static files into apps/web/public (docs/AI_PROMPT_KIT.md §5):
 * JSON Schema, spec/script docs and examples. Run after changing schema.ts or the docs.
 */
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { BlockshotSpec } from "../src/schema";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const pub = resolve(repo, "apps/web/public");

const schemaOut = resolve(pub, "schema/blockshot.schema.json");
mkdirSync(dirname(schemaOut), { recursive: true });
const schema = z.toJSONSchema(BlockshotSpec, { io: "input" });
writeFileSync(schemaOut, JSON.stringify({ title: "Blockshot Spec v0.1", ...schema }, null, 2) + "\n");

mkdirSync(resolve(pub, "docs"), { recursive: true });
copyFileSync(resolve(repo, "docs/SCENE_SPEC.md"), resolve(pub, "docs/scene-spec.md"));
copyFileSync(resolve(repo, "docs/SCRIPT_API.md"), resolve(pub, "docs/script-api.md"));

mkdirSync(resolve(pub, "examples"), { recursive: true });
for (const f of readdirSync(resolve(here, "../examples"))) copyFileSync(resolve(here, "../examples", f), resolve(pub, "examples", f));

console.log(`published schema, docs and examples to ${pub}`);

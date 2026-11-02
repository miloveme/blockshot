# Blockshot LOCAL MCP — install, register, switch from the hosted server, verify

WHAT IT IS: the same Blockshot tools running on the user's own machine over stdio (one self-contained file, ~5 MB; renders use the installed Chrome / Edge / Chromium, and only machines without one download a renderer, ~100 MB, once), plus two local-only tools: render_video (real MP4/WebM file) and render_still (real 3D PNG). It needs NO token: MCP_TOKEN only protects the hosted endpoint https://blockshot-eta.vercel.app/api/mcp (POST). The local stdio server has no network endpoint to protect, and the file itself is a public static download. Network use: the one-time renderer download on machines without Chrome (storage.googleapis.com, Chrome for Testing), and at render time the headless renderer loads the studio page from BLOCKSHOT_URL (default https://blockshot-eta.vercel.app); scripts, validation and previews run fully offline.

WHEN TO USE THIS: the user asks for an MP4/video export or a real 3D render, or says things like "register the local MCP", "re-register locally / without the token", "switch to local", "install blockshot locally", "update the local MCP" (see §6). You must be able to run shell commands on the user's computer (Claude Code, Codex CLI, …). If you cannot (claude.ai chat, phone, iPad), do NOT try: keep using this hosted server; scripts, preview and links work everywhere, and the user can export the MP4 from the link via the studio's "영상 렌더" button.

ASK FIRST. Tell the user in one sentence what you will do: download one file from https://blockshot-eta.vercel.app into ~/.blockshot, register it as an MCP server, and (for a switch) remove the old hosted registration. Never print, log or paste the user's token anywhere; you do not need it.

## 1. Requirements (check before installing)
- Node.js 22 or newer (uses built-in WebSocket). Check: node -v   → must print v22.x or higher.
- A browser is optional: renders use an installed Chrome / Edge / Chromium / Brave (standard locations are found automatically). Without one, step 2 downloads a renderer instead (Chrome for Testing chrome-headless-shell, pinned version, size + SHA-256 checked, ~100 MB) into ~/.blockshot/browsers; it never touches the user's browsers. Linux without a desktop only: that renderer needs the usual Chrome libraries (Debian/Ubuntu: sudo apt-get install -y libnss3 libgbm1 libasound2).
- Environment variables (all optional): BLOCKSHOT_URL = studio used for links and rendering (default https://blockshot-eta.vercel.app; use http://localhost:3000 for a local dev server), BLOCKSHOT_CHROME = render with this browser executable (when it is not in a standard location), BLOCKSHOT_HOME = use this folder instead of ~/.blockshot for a downloaded renderer.

## 2. Download (exact commands)
macOS / Linux:
  mkdir -p ~/.blockshot && curl -fsSL https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs -o ~/.blockshot/blockshot-mcp.mjs
Windows (PowerShell):
  New-Item -ItemType Directory -Force $HOME\.blockshot | Out-Null; Invoke-WebRequest https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs -OutFile $HOME\.blockshot\blockshot-mcp.mjs
Then set up rendering (once). With Chrome / Edge / Chromium installed it only prints "renderer ready: <browser path> (installed browser, nothing to download)"; without one it downloads the renderer (~100 MB, prints progress) and ends with "renderer ready: <path>":
  node ~/.blockshot/blockshot-mcp.mjs install-browser          (Windows: node $HOME\.blockshot\blockshot-mcp.mjs install-browser)
If you skip it on a machine without a browser, the first render_still / render_video downloads the renderer instead (that call then takes a minute longer).
Updating later = run the same download again. Use an ABSOLUTE path when registering (some clients do not expand ~): on macOS/Linux resolve it with: echo $HOME/.blockshot/blockshot-mcp.mjs

## 3. Register
Claude Code (name it "blockshot" if replacing the hosted one, otherwise "blockshot-local"):
  claude mcp add blockshot-local -e BLOCKSHOT_URL=https://blockshot-eta.vercel.app -- node /ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs
Codex — add to ~/.codex/config.toml (or run: codex mcp add blockshot-local --env BLOCKSHOT_URL=https://blockshot-eta.vercel.app -- node /ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs, then check the file):
  [mcp_servers.blockshot-local]
  command = "node"
  args = ["/ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs"]
  env = { BLOCKSHOT_URL = "https://blockshot-eta.vercel.app" }
Other MCP clients (JSON):
  { "mcpServers": { "blockshot-local": { "command": "node", "args": ["/ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs"], "env": { "BLOCKSHOT_URL": "https://blockshot-eta.vercel.app" } } } }
No Authorization header, no token, no URL — it is a command, not a remote server.

## 4. Switching an existing hosted (remote) registration to local
1. Find the old entry: Claude Code: claude mcp list   (the one whose URL ends in /api/mcp). Codex: look in ~/.codex/config.toml for a [mcp_servers.*] block with url = ".../api/mcp" (and a bearer token / http_headers). Other clients: their MCP config file.
2. Remove it: Claude Code: claude mcp remove <name>.  Codex: delete that [mcp_servers.<name>] block. This also removes the stored token from the client config — you never need to handle it.
3. Do steps 2–3 above (download + register). Re-using the same name (e.g. "blockshot") keeps the tool names the user is used to; use "blockshot-local" if they want both. Registering both is fine: the hosted one (with token) works on any device, the local one adds the MP4/3D render tools.
4. Tell the user the new tools appear after the client reloads its MCP servers: Claude Code → start a NEW session (or /mcp); Codex → restart codex. You usually cannot call the new server in the current session.

## 5. Verify (do this before telling the user it worked)
a) File/Node sanity, works without any MCP client:
   printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node /ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs
   → prints ONE JSON line containing the tool list and exits. If it errors: wrong Node version (<22), truncated download (re-download), or wrong path.
b) Client sees it: claude mcp list (shows "blockshot-local … Connected"), or /mcp inside Claude Code; for Codex: codex mcp list.
c) In the NEW session the local server must expose exactly these 14 tools:
   get_guide, run_script, validate_spec, apply_addon, animate_prompt, evaluate, analyze_motion, solve_motion, inspect_rig, preview, load_link, open_link, render_video, render_still
   How to tell local from hosted: the local server has NO local_setup tool, and its render_video description starts with "LOCAL ONLY". The hosted server has 15 tools (the shared ones + local_setup + render_video + render_still stubs that only explain how to install).
d) Functional test: call run_script with a tiny scene, then render_still (t=0); a PNG must come back. render_video writes a file under ~/Blockshot/renders/ (or the "output" path) and returns its path. If render_* fails with "No Chrome / Edge / Chromium is installed and the renderer could not be downloaded" → check the network and run install-browser (step 2) to see the error; "the renderer exited … before it was ready" on Linux → install the libraries from step 1; "the studio did not become ready" → check the machine can reach BLOCKSHOT_URL.
Only after (a) and (b) succeed, report success; mention if you could not run (c)/(d) in the current session.

## 6. Updating the local server (when the user asks to update it, or the hosted docs mention an action / tool the local one rejects)
The local file never updates itself; the hosted server is always current. An outdated local file rejects new actions as schema errors (rendering still uses the live studio page). Keep the registration as it is — only the file changes.
1. Find the registered file path (claude mcp list, or the args in ~/.codex/config.toml; usually ~/.blockshot/blockshot-mcp.mjs).
2. Already current? cmp -s <(curl -fsSL https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs 2>/dev/null) <PATH> && echo up-to-date   → if it is, say so and stop.
3. Replace it safely (a download cut off midway must not break the working file):
   curl -fsSL https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs -o <PATH>.new && mv <PATH>.new <PATH>
4. Only on a machine without Chrome: run install-browser (step 2) again — when the new file pins a newer renderer it downloads it and removes the old one; otherwise it just prints "renderer ready". (Skipping it is fine — the first render does it.)
5. Verify with 5(a), then tell the user the new version loads after the client reloads its MCP servers (Claude Code → new session or /mcp; Codex → restart). The running server keeps the old code until then.

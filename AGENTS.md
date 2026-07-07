# AGENTS.md — running & modifying Storyboard Reference Studio with an AI agent

This file is the single source of truth for AI coding agents working on this repo. `CLAUDE.md` points here.

## What this app is

Electron + TypeScript + React 18 desktop tool. Filmmakers turn ANY reference imagery — movie clips, phone footage, pulled stills, mood images — into a **storyboard of stills + image-generator-ready prompts**, so an image generator can recreate the framing and shot elements of each frame. Third app in Sam Wasserman's AI-filmmaking suite (with Blockout and Motion Previs Studio). Full product brief: `DESIGN.md`.

## Commands

```bash
npm install            # once; Node 22+. ffmpeg is BUNDLED via ffmpeg-static; ffprobe uses PATH/absolute probes.
npm run dev            # run the app with hot reload
npm run build          # production build into out/
npm start              # run the production build
npm run typecheck      # strict TS, two projects (renderer+shared+preload, main+e2e)
npm run lint           # ESLint (zero warnings)
npm run smoke          # build + Playwright end-to-end: real ffmpeg extraction + export
npm run package        # macOS DMG into release/ (Phase B; do not run yet)
```

**Definition of done for any change:** `npm run typecheck && npm run lint && npm run build` green, and `npm run smoke` green if you touched main/, shared/, frames/export/describe, the store, or frameOps.

## Repo map

```
src/shared/     PURE data + logic, imported by BOTH main and renderer.
                types.ts (Project/MediaItem/Frame/Crop model), schema.ts
                (factories + parseProject — never throws), profiles.ts
                (generator profiles: phrasingGuide for Claude + offline
                formatPrompt fallback + dropdown option lists).
src/main/       Electron main process. index.ts (window, project I/O, media
                import + probe, IPC), ffmpeg.ts (resolveFfmpeg/resolveFfprobe +
                probeMedia), frames.ts (extract + extractRange: interval/scene/
                count), describe.ts (Claude vision → structured prompt),
                export.ts (board package + contact sheet), control.ts (agent
                HTTP control server).
src/preload/    Typed IPC bridge (window.sbr). Keep in sync with main.
src/renderer/   React UI. store.ts (zustand; ALL doc edits via store.mutate),
                App.tsx (welcome/titlebar/keyboard/autosave), panels/ (MediaBin,
                Viewer, Inspector, CropEditor, Board, Help, Toasts), lib/
                (paths, useMediaUrl, frameOps, inspectorHelpers), control.ts
                (renderer side of the agent control surface).
mcp/            storyboard-mcp.mjs — zero-dep stdio MCP bridge to the control server.
tests/e2e/      Playwright smoke test (real app, real ffmpeg, real export).
```

## Hard rules

1. **ffmpeg packaging (load-bearing):** `ffmpeg-static` is EXTERNAL to the main bundle (`rollupOptions.external` in electron.vite.config.ts) + `asarUnpack` + `files` include in electron-builder.yml. Bundling it rewrites the `__dirname` it uses to find the binary and breaks exports. `resolveFfmpeg` order: `SBR_FFMPEG` env → bundled ffmpeg-static (unpacked from asar) → absolute Homebrew/usr paths → bare `ffmpeg`. Finder-launched apps don't inherit the shell PATH, hence the absolute probes.
2. **Claude calls run in the MAIN process only** (`src/main/describe.ts`): model `claude-opus-4-8`, `thinking: { type: 'adaptive' }`, vision, `output_config` json_schema. Auth chain: `ANTHROPIC_API_KEY` → `ant` CLI profile (SDK) → `~/.config/storyboard-reference/anthropic-api-key`. The whole app works offline EXCEPT the Generate button, which returns a structured friendly error when no credentials resolve.
3. **All document edits go through `store.mutate(label, fn)`** (or a store action that calls it) — never assign into `store.doc` directly (breaks dirty tracking + autosave). Destructive actions (removing a prompted frame) confirm.
4. **Selectors must return stable references.** `useStore((s) => s.orderedFrames())` returns a NEW array every call and loops React (error #185). Select the raw `doc.frames` and sort in a `useMemo` (see Board.tsx).
5. **Projects are folders:** `<name>.sbref/` = `project.json` (pretty-printed) + `media/` (COPIES of imports) + `.autosave/` (60s backup) + `.frames/` (extracted full-res stills cache) + `exports/`. `parseProject` must never break on an existing file; sanitize/migrate instead.

## Automation surface (driving the running app)

The renderer exposes `window.__sbr` (not a public API — for tests/agents):

- `__sbr.store` — the zustand store. `getState()` gives every action: `newProject/loadFromJson`, `addMedia(item)`, `addFrame(mediaId, timeS, label)`, `removeFrame`, `reorderFrame`, `setFrameLabel/Notes/Crop/CropAspect/Prompt`, `setStill`, `orderedFrames()`, `media(id)`, `frame(id)`, `mediaAbsPath(mediaId)`.

Shared frame ops live in `src/renderer/lib/frameOps.ts`: `ensureStill(frameId)`, `generatePrompt(frameId, profileId, ctx)`, `buildExportInputs()`, `templatePrompt(frame, profileId, fields)`.

Headless/dialog-free driving: launch with env `SBR_SMOKE_DIR=/some/dir` — the New/Open dialogs are bypassed and use `$SBR_SMOKE_DIR/Smoke.sbref`. See `tests/e2e/smoke.spec.ts` for a complete scripted session (Playwright `_electron`), including generating a test clip with a mid-clip color flip so scene-detect finds a cut.

## Agent control (MCP)

On launch the main process starts a localhost-only HTTP control server (`src/main/control.ts`) on a random port with a bearer token, and writes discovery + auth to `~/.config/storyboard-reference/control.json` (`{ port, token, pid }`, mode 0600, deleted on quit). The zero-dep stdio bridge `mcp/storyboard-mcp.mjs` reads that file and forwards each tool call to the control server, which relays it to the renderer over the `control:invoke` / `control:result` IPC pair.

**Register with Claude Code:**
```bash
claude mcp add storyboard-reference -- node /Users/eklpse1/Desktop/storyboard-reference/mcp/storyboard-mcp.mjs
```

**Tools** (each maps to a control action of the same name in `src/renderer/control.ts`):

| Tool | Params | Does |
|---|---|---|
| `get_state` | — | Project summary: media + board frames (call first) |
| `add_frame` | `mediaId, timeS?, label?` | Add one board frame |
| `auto_board` | `mediaId, startS?, endS?, mode?, threshold?/everyS?/count?` | Extract many frames (scene/interval/count) |
| `set_label` | `frameId, label` | Rename a frame |
| `set_crop` | `frameId, aspect?, x?, y?, w?, h?` | Reframe (normalized coords) |
| `describe_frame` | `frameId, profileId?, context?` | Generate a Claude prompt |
| `extract_frame` | `frameId` | Ensure a full-res still PNG exists; return its path |
| `export_board` | — | Export the whole board package; return the folder |

## Common tasks

- **Add a generator profile:** append to `BUILTIN_PROFILES` in `src/shared/profiles.ts` (id, name, blurb, `phrasingGuide` fed to Claude, `formatPrompt` offline fallback). It appears in the Inspector profile select automatically.
- **Add an export artifact:** extend `exportBoard` in `src/main/export.ts` and assert it in the smoke test.
- **Change the document schema:** update `src/shared/types.ts`, then the factories + `parseProject` sanitizers in `src/shared/schema.ts`. Never break `parseProject` on existing files; migrate.

## Gotchas

- **cwd resets between shell commands** in agent tooling — always `cd /Users/eklpse1/Desktop/storyboard-reference` at the start of every bash command.
- `ffprobe` is NOT shipped by ffmpeg-static (ffmpeg only). `probeMedia` prefers a PATH/absolute ffprobe but falls back to parsing `ffmpeg -i` stderr, which always works.
- Scene detection reports ABSOLUTE `pts_time` — do not `trim`+`setpts` before `showinfo` (it zeroes timestamps and loses cut times). Filter to the window after parsing.
- Extracted stills live in `<project>/.frames/<id>.png` (inside the project so `readProjectFile` can serve them as blob URLs). The `.frames` and `.autosave` dirs are working caches, not part of the saved doc.
- Playwright e2e runs against the **built** app (`out/`) — `npm run smoke` builds first.
- Do NOT modify the sibling app at `/Users/eklpse1/Desktop/blockout` — it is the read-only pattern library.
```

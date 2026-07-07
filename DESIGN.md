# Storyboard Reference Studio — design brief

Third app in Sam Wasserman's AI-filmmaking suite (with Blockout and Motion Previs Studio).
Purpose: turn ANY reference imagery — movie clips, phone footage, pulled stills, mood images —
into a **storyboard of stills + image-generator-ready prompts**, so an image generator can
recreate the framing and shot elements of each frame.

## The 60-second workflow
1. **IMPORT** — drag in videos and images (or paste from clipboard). They land in a media bin.
2. **PICK** — for a video: scrub, set an in/out section, bookmark individual frames, or one-click
   **Auto-board** (scene-change detection) / **Every N seconds** extraction. Images import as frames directly.
3. **BOARD** — picked frames become cards on a storyboard grid: reorder by drag, label
   ("SHOT 1A — HERO ENTERS"), add notes, crop/reframe each to a target aspect (16:9, 9:16, 1:1, 4:3, 2.39:1)
   with a draggable crop overlay.
4. **PROMPT** — one click generates a per-frame prompt via Claude vision describing: shot size &
   camera angle, lens/framing feel, subjects & blocking, environment, lighting, color/mood, style keywords —
   phrased per the selected generator profile (Midjourney, Flux, GPT-Image, Nano Banana, SDXL, generic).
   Editable in place. Batch "Prompt all". Offline fallback: structured template prompt scaffold from
   frame metadata the user completes.
5. **EXPORT** — one folder: full-res stills (cropped as set), `NN_label/still.png + prompt.txt` per frame,
   `prompts.json` (machine-readable board), `contact-sheet.png`, `board.md` (readable storyboard doc).
   "Copy prompt" everywhere.

## Product laws (inherited from the suite)
- Electron + electron-vite + React 18 + strict TS. Plain CSS dark pro UI (NLE feel, like Blockout).
- ffmpeg via ffmpeg-static: EXTERNAL to the bundle + asarUnpack + absolute-path fallbacks
  (copy Blockout's resolveFfmpeg — this exact lesson was learned the hard way).
- Claude API calls in the MAIN process only (model claude-opus-4-8, adaptive thinking, vision,
  structured JSON output). Auth chain: ANTHROPIC_API_KEY → `ant` CLI profile →
  ~/.config/storyboard-reference/anthropic-api-key (Finder apps don't inherit shell env).
  Copy the pattern from Blockout src/main/analyze.ts.
- Projects are folders of pretty JSON + copied media; autosave every 60s; crash-safe reopen.
- Deterministic where applicable; every action undoable is NOT required here (lighter app), but
  destructive actions confirm.
- Apache-2.0 + NOTICE requiring credit to Sam Wasserman (wassermanproductions.com); in-app credits
  line with clickable wassermanproductions.com + wasserman.ai (shell.openExternal allowlisted).
- MCP agent control: localhost HTTP control server (random port + bearer token at
  ~/.config/storyboard-reference/control.json) + zero-dep stdio bridge mcp/storyboard-mcp.mjs —
  copy Blockout's proven mcp/control architecture (src/main/control.ts + renderer handler).
- Help overlay: skimmable — Quick start cards + searchable "How do I…?" + shortcuts.
- Logo: Sam will supply later; until then a typographic wordmark on the welcome screen.

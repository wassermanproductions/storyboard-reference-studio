<div align="center">

# STORYBOARD **REFERENCE**

**Turn any reference imagery into stills + image-generator prompts — recreate any framing in your generator of choice.**

![Storyboard Reference Studio — a six-frame reference board with per-frame prompts](docs/images/hero.png)

</div>

---

Image generators give you far better results when you show them exactly the framing you want. Storyboard Reference Studio is the fastest path from *"I love how this shot is composed"* to a **still + a generator-ready prompt** that recreates its shot size, angle, blocking, lighting, and mood. Drop in a movie clip, phone footage, a pulled still, or a mood image; pull the frames that matter; and export a storyboard package: full-res stills (reframed as you set) and a prompt per frame, phrased for **Midjourney, Flux, GPT-Image, Nano Banana, SDXL, or a generic target.**

It is deliberately **not** an editor. Pulling reference frames, reframing them, and writing precise per-generator prompts is the whole product. The whole app runs offline — the only thing that needs credentials is the one-click Claude-vision prompt (and there's a built-in offline template mode for that too).

- 🎞️ **Auto-board scene detection** — point it at a section and it finds the cuts, pulling one frame per shot. Or every N seconds, or N evenly-spaced frames.
- ✂️ **Aspect reframing** — drag a crop overlay to reframe any frame to 16:9, 9:16, 1:1, 4:3, or 2.39:1; the crop is applied full-res on export.
- 🎯 **6 generator profiles** — each phrases the prompt the way its model likes it, including Midjourney's exact trailing `--ar` (from the frame's crop) and `--style raw`.
- 🔌 **Offline mode** — no API key? A structured template builds a prompt scaffold from the frame's metadata + shot-size / angle / lighting / mood dropdowns.
- 📦 **Deterministic exports** — one folder: per-frame `still.png` + `prompt.txt`, plus `prompts.json`, a labelled `contact-sheet.png`, and a readable `board.md`.
- 🤖 **Agent-drivable** — a bundled MCP server lets Claude Code, Codex, or any MCP client build and prompt the board for you.

---

## The 60-second workflow

1. **IMPORT** — drag in videos and images (or paste from the clipboard). They land in a media bin.
2. **PICK** — for a video: scrub, set an in/out section with draggable handles, and bookmark individual frames — or one-click **Auto-board** the section (scene detect / every N seconds / N frames). Images import as frames directly.
3. **BOARD** — picked frames become cards on a storyboard strip: reorder by drag, label (`SHOT 1A — HERO ENTERS`), add notes, and reframe each to a target aspect with a draggable crop overlay.
4. **PROMPT** — one click generates a per-frame prompt via Claude vision — shot size & angle, lens feel, subjects & blocking, environment, lighting, color/mood, style keywords — phrased for your selected generator. Editable in place. Batch **Prompt all missing**. No key? Fill the offline template.
5. **EXPORT** — **Export board** writes one folder and reveals it in Finder:

```
Storyboard/board-2026-07-07-…/
├── 01_shot-1a-hero-enters/
│   ├── still.png        # full-res, reframed to the crop you set
│   └── prompt.txt       # the frame's prompt (or template scaffold)
├── 02_ext-street-night/
│   ├── still.png
│   └── prompt.txt
├── …
├── prompts.json         # the whole board, machine-readable
├── contact-sheet.png    # labelled ffmpeg tile montage of every frame
└── board.md             # a readable markdown storyboard
```

---

## Screenshot tour

|  |  |
|---|---|
| ![Viewer with an in/out range and the playhead on a moment](docs/images/viewer.png) | ![Reframe crop overlay on a frame](docs/images/crop.png) |
| **Pick** — scrub a clip, pull an in/out range with draggable handles, and bookmark the exact frame. Frame-step with the arrow keys. | **Reframe** — pick a target aspect and drag the crop overlay to recompose. The crop is applied full-res on export, never to the source. |
| ![Inspector with a filled per-frame prompt](docs/images/inspector.png) | ![The board exported to a folder](docs/images/export.png) |
| **Prompt** — label, note, and prompt a frame for your target generator; edit the result in place, or build one offline from the template. | **Export** — one click writes the whole package to a folder and reveals it in Finder: stills, prompts, contact sheet, and a readable board. |

---

## Feature tour

### Auto-board scene detection

Point Auto-board at a clip (or an in/out section) and pick a mode: **Scene detect** runs ffmpeg scene-change detection and pulls one frame per cut — sensitivity is a single slider (lower finds more cuts). **Every N seconds** and **N evenly-spaced frames** are there for footage without hard cuts. Every extracted frame lands on the board as a card with a full-res still already cached.

### Aspect reframing

Any frame can be recomposed to **16:9, 9:16, 1:1, 4:3, or 2.39:1** with a draggable crop overlay that holds the target aspect while you drag its corners. The crop is stored normalized in source space and applied **full-resolution on export** via ffmpeg — the source frame is never touched, and the aspect flows straight into the prompt (e.g. Midjourney's `--ar`).

### 6 generator profiles

Prompts are **phrased per generator**, not one-size-fits-all:

| Profile | How it phrases the prompt |
|---|---|
| **Midjourney** | Comma-separated visual phrases, subject → blocking → environment → light → lens, with a trailing `--ar <your crop>` and `--style raw`. |
| **Flux** | Fluent natural-language sentences, camera and lighting up front. |
| **GPT-Image** | One detailed, directive paragraph ("Create a … shot showing …"). |
| **Nano Banana** | A tight scene description + an explicit `Match this framing:` clause. |
| **SDXL** | Tag-style, keyword/booru ordering with quality tags, no flags. |
| **Generic** | A clean, tool-agnostic cinematic description. |

The **Midjourney `--ar` is derived from the frame's actual crop** — reframe to 2.39:1 and the prompt ends `--ar 2.39:1 --style raw`; leave it on `free` and no aspect flag is appended. Adding a profile is a single data entry in `src/shared/profiles.ts`.

### Offline mode

The whole app works with no network. The one online action — the **Generate prompt** button (Claude vision, model `claude-opus-4-8`) — degrades gracefully: with no credentials it returns a friendly message and opens the **offline template**, which builds a prompt scaffold from the frame's label, notes, crop aspect, and shot-size / angle / lighting / mood dropdowns, phrased through the same generator profile.

### Deterministic exports

**Export board** writes a self-contained folder: `NN_<label>/still.png` (reframed full-res) + `NN_<label>/prompt.txt` per frame, a machine-readable `prompts.json`, a labelled `contact-sheet.png` tile montage, and a readable `board.md`. Projects themselves are a folder — pretty-printed `project.json` + copied media + a stills cache — so they diff, branch, and reopen crash-safely (60-second autosave).

### Agent control

A bundled **MCP server** lets an AI agent build and prompt the board — import-aware `get_state`, `auto_board`, `set_crop`, `describe_frame`, and `export_board` — the same moves you'd make by hand. See [Agent control](#agent-control-mcp) below.

---

## The suite

Storyboard Reference Studio is the third app in Sam Wasserman's AI-filmmaking suite. Each does one job in the pipeline from *"I can see the shot"* to a generator-ready reference:

- **[Blockout](https://github.com/wassermanproductions/blockout)** — previs: stage a scene in grey-box 3D, choreograph the camera and cast against marks, and export a motion-reference package for video generators.
- **Motion Previs Studio** — motion reference and camera-move design for shots you're building from scratch.
- **Storyboard Reference Studio** (this app) — reference: turn *existing* imagery into stills + per-generator prompts to recreate any framing.

---

## Install

**Download** a release DMG (macOS, Apple Silicon) from GitHub Releases, or build from source:

```bash
git clone https://github.com/wassermanproductions/storyboard-reference-studio
cd storyboard-reference-studio
npm install
npm run dev                    # development, hot reload
# or
npm run build && npm start     # production build
```

Requirements: **Node 22+**. **ffmpeg** powers extraction and export — it's bundled via `ffmpeg-static` when packaged, and falls back to a system `ffmpeg` in development (`brew install ffmpeg`).

The packaged DMG is unsigned and ships with the default Electron icon (a custom logo is coming). On first launch, right-click → Open bypasses Gatekeeper. For wider distribution, set a Developer ID `identity` and notarization in [electron-builder.yml](electron-builder.yml).

---

## Agent control (MCP)

Point **Claude Code, Codex, or any MCP client** at the bundled MCP server and it can build the board, reframe, prompt, and export — driving the running app. Register it with Claude Code in one line:

```bash
claude mcp add storyboard-reference -- node /path/to/storyboard-reference/mcp/storyboard-mcp.mjs
```

Discovery and auth are automatic — the app writes a localhost-only port + bearer token to `~/.config/storyboard-reference/control.json` on launch, and the zero-dependency bridge reads it.

| Tool | Params | Does |
|---|---|---|
| `get_state` | — | Project summary: imported media + board frames. **Call first.** |
| `add_frame` | `mediaId, timeS?, label?` | Add one board frame at a source time. |
| `auto_board` | `mediaId, startS?, endS?, mode?, threshold?/everyS?/count?` | Extract many frames (scene / interval / count) and add them all. |
| `set_label` | `frameId, label` | Rename a frame. |
| `set_crop` | `frameId, aspect?, x?, y?, w?, h?` | Reframe (normalized source coords). |
| `describe_frame` | `frameId, profileId?, context?` | Generate a Claude prompt for the target generator. |
| `extract_frame` | `frameId` | Ensure a full-res still PNG exists; return its path. |
| `export_board` | — | Export the whole board package; return the folder. |

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run typecheck` / `npm run lint` | Strict TS + ESLint (zero warnings) |
| `npm run smoke` | Build + full end-to-end: boots the app, runs real ffmpeg extraction (interval + scene), reframes, exports a real package, and verifies it with ffprobe |
| `npm run package` | Build a macOS DMG (`release/`) |

## Project structure

See [DESIGN.md](DESIGN.md) (product brief) and [AGENTS.md](AGENTS.md) — the single source of truth for AI agents building or modifying this app: commands, repo map, hard rules (ffmpeg packaging, main-only Claude calls, `store.mutate`), the `window.__sbr` automation surface, and common-task recipes. Pure data + logic lives in `src/shared/`, imported by both the Electron main process and the React renderer.

## Support

A few people asked if they could send tips to support my work developing open source tools. So I set up an optional way in case anyone wants to.

No pressure at all. Using the apps, sharing them, starring the repositories, and contributing code all help too. Thank you.

- [GitHub Sponsors](https://github.com/sponsors/wassermanproductions)
- [Ko-fi](https://ko-fi.com/samwasserman)

## License & credits

**Apache License 2.0** — see [LICENSE](LICENSE). Free to use, modify, fork, and build on, commercially or otherwise.

**Attribution required:** per the [NOTICE](NOTICE) file (Apache 2.0 §4(d)), any use, fork, or redistribution must retain the NOTICE file and credit **Sam Wasserman ([wassermanproductions.com](https://wassermanproductions.com))** in its documentation and about/credits surface.

Created by **Sam Wasserman** — [wassermanproductions.com](https://wassermanproductions.com) · [wasserman.ai](https://wasserman.ai).

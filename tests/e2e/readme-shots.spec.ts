/**
 * README / docs showcase screenshots (NOT part of CI).
 *
 * Regenerates the marketing stills under docs/images/. Every test is gated
 * behind README_SHOTS so the normal Playwright run (npm run smoke) skips this
 * file entirely.
 *
 *   README_SHOTS=1 npx playwright test tests/e2e/readme-shots.spec.ts
 *
 * Each scene is staged through the documented automation surface
 * (window.__sbr.store + window.sbr IPC) — the same store actions the UI and
 * agents use. A rich six-scene reference clip is synthesized with ffmpeg
 * (distinct lit gradient "shots", each with a standing subject silhouette) so
 * the board reads like real pulled reference imagery, not test patterns.
 */

import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, statSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

declare global {
  interface Window {
    sbr: any
    __sbr: { store: any }
  }
}

const OUT = 'docs/images'
const GATE = !process.env.README_SHOTS

let app: ElectronApplication
let page: Page
let smokeDir: string
let clipPath: string

/**
 * Six distinct, cinematic-looking gradient "shots" (golden hour, blue night,
 * sepia, teal/magenta dusk, grey interior, cool exterior), each with a dark
 * standing-figure box so they read as framed reference stills with a subject.
 * Hard cuts every 1s so scene-detect finds them. All via ffmpeg lavfi — no
 * external assets.
 */
function makeReferenceClip(dir: string): string {
  const out = join(dir, 'reference.mp4')
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0xf5c060:c1=0x8a3510:x0=300:y0=100:x1=1000:y1=680:d=1:speed=0.004:nb_colors=3:c2=0x1a0a04',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x08152e:c1=0x2f6ea8:x0=100:y0=60:x1=1200:y1=700:d=1:speed=0.006:nb_colors=3:c2=0x9fd0f0',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x30302f:c1=0xe0a860:x0=1000:y0=100:x1=200:y1=680:d=1:speed=0.005',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x140a20:c1=0xc04888:x0=640:y0=0:x1=640:y1=720:d=1:speed=0.008:nb_colors=3:c2=0x38b0a8',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0xdcd4c4:c1=0x3a5570:x0=0:y0=300:x1=1280:y1=420:d=1:speed=0.003',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x101418:c1=0x486078:x0=200:y0=700:x1=1100:y1=80:d=1:speed=0.006:nb_colors=3:c2=0xd8e0e8',
    '-filter_complex',
    "[0:v]trim=duration=1,setpts=PTS-STARTPTS,drawbox=x=760:y=280:w=180:h=440:color=0x0a0503@0.85:t=fill,vignette[a];" +
      "[1:v]trim=duration=1,setpts=PTS-STARTPTS,drawbox=x=260:y=340:w=120:h=380:color=0x02060c@0.8:t=fill,vignette[b];" +
      "[2:v]trim=duration=1,setpts=PTS-STARTPTS,drawbox=x=520:y=200:w=260:h=520:color=0x050302@0.8:t=fill,vignette[c];" +
      "[3:v]trim=duration=1,setpts=PTS-STARTPTS,drawbox=x=140:y=380:w=160:h=340:color=0x080410@0.85:t=fill,vignette[d];" +
      "[4:v]trim=duration=1,setpts=PTS-STARTPTS,drawbox=x=0:y=520:w=1280:h=200:color=0x141c26@0.6:t=fill,vignette[e];" +
      "[5:v]trim=duration=1,setpts=PTS-STARTPTS,drawbox=x=900:y=180:w=200:h=540:color=0x04080c@0.85:t=fill,vignette[f];" +
      "[a][b][c][d][e][f]concat=n=6:v=1[v]",
    '-map', '[v]', '-r', '24', '-pix_fmt', 'yuv420p', out
  ])
  return out
}

/** Import the clip and add it to the media bin; returns the media id. */
async function importClip(): Promise<string> {
  return page.evaluate(async (clip) => {
    const s = window.__sbr.store.getState()
    const imported = await window.sbr.importMedia(s.projectFolder, clip)
    const m = s.addMedia(imported)
    return m.id as string
  }, clipPath)
}

/**
 * Auto-board the whole clip in count mode (guaranteed N frames), extract a
 * full-res still for each, and store it — the same path Auto-board uses. Labels
 * read like a real shot list. Returns the created frame ids in board order.
 */
async function autoBoard(mediaId: string, labels: string[]): Promise<string[]> {
  return page.evaluate(
    async ({ mediaId, labels }) => {
      const s = window.__sbr.store.getState()
      const media = s.media(mediaId)
      const abs = s.mediaAbsPath(mediaId)
      const outDir = `${s.projectFolder}/.frames`
      await window.sbr.ensureDir(outDir)
      // Stay just inside the clip end — seeking to the exact last timestamp can
      // return no frame, which would drop a card and leave a missing still.
      const end = Math.max(0.5, (media.durationS ?? 6) - 0.2)
      const res = await window.sbr.extractRange(abs, 0, end, { kind: 'count', n: labels.length }, outDir)
      const ids: string[] = []
      res.frames.forEach((f: any, i: number) => {
        const frame = s.addFrame(mediaId, f.time, labels[i] ?? `SHOT ${i + 1}`)
        s.setStill(frame.id, { path: f.path, width: media.width, height: media.height })
        ids.push(frame.id)
      })
      return ids
    },
    { mediaId, labels }
  )
}

/** Clear any lingering toasts so they don't clutter a capture. */
async function clearToasts(): Promise<void> {
  await page.evaluate(() => {
    const s = window.__sbr.store.getState()
    for (const t of [...s.toasts]) s.dismissToast(t.id)
  })
  await page.waitForTimeout(150)
}

const SHOT_LABELS = [
  'SHOT 1A — INT. LOFT, GOLDEN HOUR',
  'SHOT 2 — EXT. STREET, NIGHT',
  'SHOT 3B — HALLWAY, TUNGSTEN',
  'SHOT 4 — ROOFTOP, DUSK NEON',
  'SHOT 5 — WIDE, OVERCAST',
  'SHOT 6C — FINAL, COOL EXTERIOR'
]

test.beforeAll(async () => {
  test.skip(GATE, 'docs generator — set README_SHOTS=1 to run')
  mkdirSync(OUT, { recursive: true })
  smokeDir = mkdtempSync(join(tmpdir(), 'sbr-readme-'))
  clipPath = makeReferenceClip(smokeDir)
  app = await electron.launch({
    args: ['out/main/index.js'],
    // Offline: the inspector shot uses the built-in template mode, no API key.
    env: { ...process.env, SBR_SMOKE_DIR: smokeDir, ANTHROPIC_API_KEY: '' }
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.waitForTimeout(600)
})

test.afterAll(async () => {
  await app?.close()
})

function verify(name: string): void {
  const size = statSync(join(OUT, name)).size
  // eslint-disable-next-line no-console
  console.log(`  ${name}: ${(size / 1024).toFixed(0)} KB`)
  if (size < 100_000) throw new Error(`${name} is only ${size} bytes — capture looks empty`)
}

test('hero — a full board of six labelled reference frames with prompt indicators', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(180_000)
  const mediaId = await importClip()
  const frameIds = await autoBoard(mediaId, SHOT_LABELS)

  // Fill prompts on most frames via the offline template so the board shows
  // "has prompt" dots and a realistic prompted/missing split. Give a couple of
  // frames crops too (aspect chips will read in the export/inspector shots).
  await page.evaluate(
    ({ frameIds }) => {
      const s = window.__sbr.store.getState()
      const tpls = [
        'wide shot, hero silhouetted in a loft, golden hour rim light, warm amber and shadow, cinematic still, film grain --ar 16:9 --style raw',
        'medium shot, lone figure on a rain-slick street, deep blue night exterior, cool practical glow, cinematic still, film grain --ar 16:9 --style raw',
        'medium close-up, figure in a tungsten hallway, warm sepia falloff, tense mood, cinematic still, film grain --ar 4:3 --style raw',
        'full shot, figure at a rooftop railing, dusk with magenta and teal neon, dreamy mood, cinematic still, film grain --ar 2.39:1 --style raw',
        'extreme wide shot, small figure in an overcast landscape, soft grey daylight, melancholy mood, cinematic still --ar 16:9 --style raw'
      ]
      frameIds.forEach((id: string, i: number) => {
        if (i < tpls.length) s.setFramePrompt(id, tpls[i], 'midjourney', 'template')
      })
      // Reframe a couple so their crop aspect is set on the doc.
      s.setFrameCropAspect(frameIds[3], '2.39:1')
      s.setFrameCropAspect(frameIds[2], '4:3')
      // Keep the clip open in the viewer (so the center shows a lit reference
      // frame, not an empty stage) AND select the golden-hour hero frame so the
      // inspector shows it filled in.
      s.selectFrame(frameIds[0])
      s.selectMedia(s.doc.media[0].id)
    },
    { frameIds }
  )
  // Land the viewer playhead on the lit golden-hour subject.
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    if (v) v.currentTime = 0.5
  })
  await page.waitForTimeout(900)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/hero.png` })
  verify('hero.png')
})

test('viewer — a clip with an in/out range and a bookmarked moment', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  // Open the clip in the viewer, seek into the golden-hour scene, and set an
  // in/out range around the money shot.
  await page.evaluate((mediaId) => {
    const s = window.__sbr.store.getState()
    // Clip in the viewer; also select the hero card so the inspector reads as
    // filled rather than an empty prompt panel.
    s.selectFrame(s.orderedFrames()[0].id)
    s.selectMedia(mediaId)
  }, await page.evaluate(() => window.__sbr.store.getState().doc.media[0].id))
  await page.waitForTimeout(600)

  // Make sure the video is decoded enough to seek accurately: kick playback
  // briefly then pause, and wait until it reports a usable readyState.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const v = document.querySelector('video') as HTMLVideoElement | null
        if (!v) return resolve()
        const ready = (): void => {
          if (v.readyState >= 2) {
            v.pause()
            resolve()
          }
        }
        v.muted = true
        void v.play().then(() => setTimeout(ready, 200)).catch(() => resolve())
      })
  )

  // Set an IN/OUT range by dragging the scrubber handles. The handle drag is
  // pure pixel geometry (independent of the video's decode state, which doesn't
  // seek reliably headless), so this produces a real, visible in/out band.
  const scrub = page.locator('.scrub')
  const box = await scrub.boundingBox()
  if (box) {
    const y = box.y + box.height / 2
    // Drag IN handle (starts at left edge) in to ~22%.
    await page.mouse.move(box.x + 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.22, y, { steps: 8 })
    await page.mouse.up()
    // Drag OUT handle (starts at right edge) in to ~80%.
    await page.mouse.move(box.x + box.width - 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 8 })
    await page.mouse.up()
    // Move the playhead into the range by clicking the scrub track at ~48%.
    await page.mouse.click(box.x + box.width * 0.48, y)
  }
  await page.waitForTimeout(400)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/viewer.png` })
  verify('viewer.png')
})

test('crop — the reframe overlay on a frame, mid-adjust', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  // Select a frame, give it a punchy 1:1 crop offset from center so the overlay
  // + corner handles read clearly over the still (the reframe editor in use).
  await page.evaluate(() => {
    const s = window.__sbr.store.getState()
    const frame = s.orderedFrames()[2] // sepia hallway — subject to one side
    // Keep the clip in the viewer so the center reads; reframe in the inspector.
    s.selectMedia(s.doc.media[0].id)
    s.selectFrame(frame.id)
    // A punchy 1:1 crop pulled toward the subject, clearly offset from full
    // frame so the overlay rect + corner handles read as an active reframe.
    s.setFrameCrop(frame.id, { aspect: '1:1', x: 0.30, y: 0.10, w: 0.48, h: 0.72 })
  })
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    if (v) v.currentTime = 2.5
  })
  // Give the still blob URL time to resolve so the crop editor mounts over it.
  await page.waitForTimeout(1100)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/crop.png` })
  verify('crop.png')
})

test('inspector — a frame with a filled offline-template prompt', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await page.evaluate(() => {
    const s = window.__sbr.store.getState()
    const frame = s.orderedFrames()[0] // golden-hour hero
    s.selectMedia(s.doc.media[0].id)
    s.selectFrame(frame.id)
    s.setFrameLabel(frame.id, 'SHOT 1A — HERO ENTERS')
    s.setFrameNotes(frame.id, 'Hero steps into the loft; low sun rakes across the floor.')
    s.setFrameCropAspect(frame.id, '16:9')
    s.setFramePrompt(
      frame.id,
      'wide shot, hero enters a sunlit loft, golden hour rim light, long warm shadows, dust in the air, amber and deep shadow, anamorphic feel, cinematic still, film grain, detailed --ar 16:9 --style raw',
      'midjourney',
      'template'
    )
  })
  await page.waitForTimeout(1000)
  // Open the offline template controls so the shot shows the template UI filled.
  await page.getByRole('button', { name: 'Offline template' }).click().catch(() => {})
  await page.waitForTimeout(500)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/inspector.png` })
  verify('inspector.png')
})

test('export — a real exported board package', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(180_000)
  // Run a real export of the whole board, then show the export result: capture
  // the app right after export (toast + full board) so the shot reads as the
  // deliverable moment.
  await page.evaluate(async () => {
    const s = window.__sbr.store.getState()
    const frames = s.orderedFrames()
    const inputs: any[] = []
    for (const f of frames) {
      // Reuse the still already extracted by Auto-board (stored in the cache);
      // that's exactly what buildExportInputs does behind the Export button.
      const still = s.stills[f.id]?.path
      if (!still) continue
      const media = s.media(f.mediaId)
      inputs.push({
        sourcePng: still,
        label: f.label,
        notes: f.notes,
        promptText: f.prompt?.text ?? '',
        profileId: f.prompt?.profileId ?? 'midjourney',
        crop: f.crop,
        sourceWidth: media.width,
        sourceHeight: media.height,
        timeS: f.timeS,
        mediaName: media.name
      })
    }
    const exportsRoot = `${s.projectFolder}/exports`
    await window.sbr.exportBoard({ projectName: s.doc.name, exportsRoot, frames: inputs })
    s.selectFrame(s.orderedFrames()[0].id)
    s.selectMedia(s.doc.media[0].id)
    s.toast('Board exported — revealed in Finder.', 'success')
  })
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    if (v) v.currentTime = 0.5
  })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/export.png` })
  verify('export.png')
})

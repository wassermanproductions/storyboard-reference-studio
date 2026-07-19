/**
 * README / docs showcase screenshots (NOT part of CI).
 *
 * Regenerates the marketing stills under docs/images/. Every test is gated
 * behind README_SHOTS so the normal Playwright run (npm run smoke) skips this
 * file entirely.
 *
 *   README_SHOTS=1 npx playwright test tests/e2e/readme-shots.spec.ts
 *
 * Set README_FOOTAGE_DIR to a folder of real clips and the board is staged from
 * them instead of the synthesized gradient fallback:
 *
 *   README_SHOTS=1 \
 *   README_FOOTAGE_DIR=/path/to/footage \
 *   npx playwright test tests/e2e/readme-shots.spec.ts
 *
 * Expected footage filenames (any missing one falls back to the primary clip):
 *   night-market-scene1.mov   — primary reference clip (many distinct shots)
 *   street-patrol.mp4         — tracking clip
 *   night-market-portrait.mp4 — portrait clip
 *
 * Each scene is staged through the documented automation surface
 * (window.__sbr.store + window.sbr IPC) — the same store actions the UI and
 * agents use. Without README_FOOTAGE_DIR a six-shot reference clip is
 * synthesized with ffmpeg so the file still runs standalone.
 */

import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, statSync, existsSync } from 'fs'
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
const FOOTAGE_DIR = process.env.README_FOOTAGE_DIR ?? ''

let app: ElectronApplication
let page: Page
let smokeDir: string

/** Resolved media ids by role, plus the board frame ids in order. */
let primaryId = ''
const clipIds: Record<string, string> = {}
let frameIds: string[] = []

/**
 * Six distinct, cinematic-looking gradient "shots" (golden hour, blue night,
 * sepia, teal/magenta dusk, grey interior, cool exterior), each with a dark
 * standing-figure box so they read as framed reference stills with a subject.
 * Hard cuts every 1s so scene-detect finds them. All via ffmpeg lavfi — no
 * external assets. Only used when README_FOOTAGE_DIR is unset.
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

/** Absolute source path for a clip role, or '' if that clip isn't available. */
function clipSource(file: string): string {
  if (!FOOTAGE_DIR) return ''
  const p = join(FOOTAGE_DIR, file)
  return existsSync(p) ? p : ''
}

/** Import one source file into the project; returns the media summary. */
async function importFile(source: string): Promise<{ id: string; durationS: number }> {
  return page.evaluate(async (src) => {
    const s = window.__sbr.store.getState()
    const imported = await window.sbr.importMedia(s.projectFolder, src)
    const m = s.addMedia(imported)
    return { id: m.id as string, durationS: (imported.durationS ?? 0) as number }
  }, source)
}

/**
 * A working night-market session. Each card names a clip role, a real source
 * time, shot-list metadata, a hold time, an optional reframe crop, an optional
 * prompt (written in the target generator's phrasing), and optional camera-move
 * annotations. Two inserts are deliberately left un-prompted so the board reads
 * as a real in-progress session (prompted / missing split).
 */
interface Anno { kind: 'arrow' | 'text'; points: { x: number; y: number }[]; text?: string; color: string }
interface Card {
  clip: 'primary' | 'patrol' | 'portrait'
  timeS: number
  label: string
  shot: Record<string, string>
  durationS: number
  crop?: { aspect: string; x: number; y: number; w: number; h: number }
  prompt?: { text: string; profileId: string }
  annotations?: Anno[]
}

const CARDS: Card[] = [
  {
    clip: 'primary',
    timeS: 2.0,
    label: '1A — DRONE ESTABLISH, NIGHT MARKET',
    shot: { sceneNo: '1', shotNo: '1A', shotSize: 'extreme wide shot', cameraAngle: 'overhead / top-down', lens: '24mm', movement: 'Crane down', transition: 'Fade in' },
    durationS: 4,
    crop: { aspect: '2.39:1', x: 0.03, y: 0.15, w: 0.94, h: 0.699 },
    prompt: {
      profileId: 'flux',
      text: 'Aerial wide shot craning down over a crowded night market, rows of red paper lanterns and neon shop signs receding into haze, food stalls steaming below, a river of people moving between them. Lit by warm practicals against a cool night sky. Anamorphic, cinematic photograph, fine film grain.'
    }
  },
  {
    clip: 'primary',
    timeS: 4.4,
    label: '1C — GANG WALK-UP',
    shot: { sceneNo: '1', shotNo: '1C', shotSize: 'medium shot', cameraAngle: 'eye level', lens: '35mm', movement: 'Dolly in', transition: 'Cut' },
    durationS: 3,
    prompt: {
      profileId: 'midjourney',
      text: 'young man in a leather jacket walking straight toward camera, gang flanking behind him, crowded night market, red lantern light, wet asphalt reflections, shallow depth of field, 35mm, medium shot, tense mood, cinematic still, film grain --ar 2.39:1 --style raw'
    },
    annotations: [
      { kind: 'arrow', points: [{ x: 0.16, y: 0.86 }, { x: 0.42, y: 0.58 }], color: '#ffd400' },
      { kind: 'arrow', points: [{ x: 0.86, y: 0.86 }, { x: 0.60, y: 0.58 }], color: '#ffd400' },
      { kind: 'text', points: [{ x: 0.40, y: 0.93 }], text: 'push in', color: '#ffd400' },
      { kind: 'arrow', points: [{ x: 0.06, y: 0.34 }, { x: 0.24, y: 0.40 }], color: '#ff5533' },
      { kind: 'text', points: [{ x: 0.05, y: 0.24 }], text: 'gang enters L', color: '#ff5533' }
    ]
  },
  {
    clip: 'primary',
    timeS: 8.2,
    label: '2B — WOK FIRE, INSERT',
    shot: { sceneNo: '2', shotNo: '2B', shotSize: 'extreme close-up', cameraAngle: 'eye level', lens: '50mm macro', movement: 'Static', transition: 'Cut' },
    durationS: 1.5
    // left un-prompted: an insert still on the to-do list
  },
  {
    clip: 'primary',
    timeS: 16.5,
    label: '3A — VENDOR, THE WARNING',
    shot: { sceneNo: '3', shotNo: '3A', shotSize: 'medium shot', cameraAngle: 'eye level', lens: '50mm', movement: 'Static', transition: 'Cut' },
    durationS: 2.5,
    crop: { aspect: '4:3', x: 0.147, y: 0.03, w: 0.705, h: 0.94 },
    prompt: {
      profileId: 'midjourney',
      text: 'older female market vendor at her stall, weathered face lit by warm lantern glow, watching something off-camera with concern, night-market bustle blurred behind, 50mm, medium shot, warm practical light, melancholy mood, cinematic still, film grain --ar 4:3 --style raw'
    }
  },
  {
    clip: 'portrait',
    timeS: 6.5,
    label: '3D — LOOKOUT, FLAT CAP',
    shot: { sceneNo: '3', shotNo: '3D', shotSize: 'close-up', cameraAngle: 'eye level', lens: '85mm', movement: 'Pan L→R', transition: 'Match cut' },
    durationS: 2,
    prompt: {
      profileId: 'midjourney',
      text: 'close-up of a young lookout in a flat cap, half his face in warm lantern light, eyes tracking left, out-of-focus market neon behind, 85mm, shallow depth of field, tense mood, cinematic still, film grain --ar 16:9 --style raw'
    }
  },
  {
    clip: 'patrol',
    timeS: 2.0,
    label: '4B — STREET PATROL, TRACKING',
    shot: { sceneNo: '4', shotNo: '4B', shotSize: 'wide shot', cameraAngle: 'eye level', lens: '35mm', movement: 'Track L', transition: 'Cut' },
    durationS: 4,
    prompt: {
      profileId: 'flux',
      text: 'Tracking wide shot moving with a line of young men walking abreast through the night market, jackets and gold chains, stalls and hanging lights streaking past on either side, wet ground catching red and green neon. Handheld energy, 35mm, cinematic photograph.'
    }
  },
  {
    clip: 'primary',
    timeS: 36.3,
    label: '5A — THE BLADE, INSERT',
    shot: { sceneNo: '5', shotNo: '5A', shotSize: 'extreme close-up', cameraAngle: 'low angle', lens: '50mm', movement: 'Push-in', transition: 'Smash cut' },
    durationS: 1.25
    // left un-prompted: an insert still on the to-do list
  },
  {
    clip: 'primary',
    timeS: 22.2,
    label: '6C — HERO, FINAL STARE',
    shot: { sceneNo: '6', shotNo: '6C', shotSize: 'medium close-up', cameraAngle: 'eye level', lens: '85mm', movement: 'Static', transition: 'Fade out' },
    durationS: 3.5,
    crop: { aspect: '9:16', x: 0.348, y: 0.02, w: 0.304, h: 0.96 },
    prompt: {
      profileId: 'midjourney',
      text: 'medium close-up of the hero staring down camera, jaw set, red and amber market light raking across his face, deep shadow behind, 85mm, shallow depth of field, ominous mood, cinematic still, film grain --ar 9:16 --style raw'
    }
  }
]

/**
 * Import the clips, then extract a full-res still for each card at its source
 * time and create the board frame with all its metadata — the same store
 * actions Auto-board + the Inspector use. Returns the frame ids in board order.
 */
async function stageBoard(): Promise<string[]> {
  // Resolve which clip id backs each card. Extra clips fall back to the primary
  // clip (and a spread of times) when their footage isn't present.
  const fallbackTimes = CARDS.map((_, i) => Math.min(5.6, 0.5 + i * 0.7))
  const resolved = CARDS.map((c, i) => {
    const id = clipIds[c.clip] ?? primaryId
    const usingPrimaryFallback = id === primaryId && c.clip !== 'primary'
    const timeS = clipIds[c.clip] ? c.timeS : usingPrimaryFallback ? fallbackTimes[i]! : c.timeS
    // When falling back to the synth clip (short), clamp all times into range.
    return { ...c, mediaId: id, timeS: FOOTAGE_DIR ? timeS : fallbackTimes[i]! }
  })

  return page.evaluate(async (cards) => {
    const s = window.__sbr.store.getState()
    const sep = s.projectFolder.includes('\\') ? '\\' : '/'
    const outDir = `${s.projectFolder}${sep}.frames`
    await window.sbr.ensureDir(outDir)
    const ids: string[] = []
    for (const c of cards) {
      const media = s.media(c.mediaId)
      const abs = s.mediaAbsPath(c.mediaId)
      const frame = s.addFrame(c.mediaId, c.timeS, c.label)
      const outPng = `${outDir}${sep}${frame.id}.png`
      const r = await window.sbr.extractFrame(abs, c.timeS, outPng)
      if (r.ok) s.setStill(frame.id, { path: r.path ?? outPng, width: media.width, height: media.height })
      s.setFrameShot(frame.id, c.shot)
      s.setFrameDuration(frame.id, c.durationS)
      if (c.crop) s.setFrameCrop(frame.id, c.crop)
      if (c.prompt) s.setFramePrompt(frame.id, c.prompt.text, c.prompt.profileId, 'template')
      if (c.annotations) for (const a of c.annotations) s.addAnnotation(frame.id, a)
      ids.push(frame.id)
    }
    return ids
  }, resolved)
}

/** Clear any lingering toasts so they don't clutter a capture. */
async function clearToasts(): Promise<void> {
  await page.evaluate(() => {
    const s = window.__sbr.store.getState()
    for (const t of [...s.toasts]) s.dismissToast(t.id)
  })
  await page.waitForTimeout(150)
}

test.beforeAll(async () => {
  test.skip(GATE, 'docs generator — set README_SHOTS=1 to run')
  mkdirSync(OUT, { recursive: true })
  smokeDir = mkdtempSync(join(tmpdir(), 'sbr-readme-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    // Offline: prompts are staged as offline-template text, no API key needed.
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

test('hero — a working night-market board with a cinematic frame on the stage', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(300_000)

  // Import the clips (primary always; patrol + portrait when footage is present).
  const primary = await importFile(FOOTAGE_DIR ? clipSource('night-market-scene1.mov') || makeReferenceClip(smokeDir) : makeReferenceClip(smokeDir))
  primaryId = primary.id
  const patrolSrc = clipSource('street-patrol.mp4')
  const portraitSrc = clipSource('night-market-portrait.mp4')
  if (patrolSrc) clipIds.patrol = (await importFile(patrolSrc)).id
  if (portraitSrc) clipIds.portrait = (await importFile(portraitSrc)).id

  frameIds = await stageBoard()

  // Open the signature "gang walk-up" frame on the center stage (with its
  // camera-move annotations), keep the primary clip in the bin.
  await page.evaluate((id) => {
    const s = window.__sbr.store.getState()
    s.selectMedia(s.doc.media[0].id)
    s.selectFrame(id)
  }, frameIds[1])
  await page.waitForTimeout(1400)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/hero.png` })
  verify('hero.png')
})

test('viewer — the reference clip with an in/out range', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await page.evaluate(() => {
    const s = window.__sbr.store.getState()
    s.selectFrame(null)
    s.selectMedia(s.doc.media[0].id)
  })
  await page.waitForTimeout(600)

  // Decode enough of the video to render a real frame under the transport.
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
        void v.play().then(() => setTimeout(ready, 300)).catch(() => resolve())
      })
  )
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    if (v) v.currentTime = 4.4
  })
  await page.waitForTimeout(500)

  // Drag the IN/OUT handles to set a visible range around the shot.
  const scrub = page.locator('.scrub')
  const box = await scrub.boundingBox()
  if (box) {
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.18, y, { steps: 8 })
    await page.mouse.up()
    await page.mouse.move(box.x + box.width - 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.74, y, { steps: 8 })
    await page.mouse.up()
    await page.mouse.click(box.x + box.width * 0.42, y)
  }
  await page.waitForTimeout(400)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/viewer.png` })
  verify('viewer.png')
})

test('stage — the frame stage with a reframe crop, guides, and annotations', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  // The gang walk-up frame: add a scope reframe + turn guides on so the crop
  // overlay, rule-of-thirds / action-safe guides, and the camera-move
  // annotations all read together on the big stage.
  const crop = { aspect: '2.39:1', x: 0.17, y: 0.30, w: 0.64, h: 0.476 }
  await page.evaluate(
    ({ id, crop }) => {
      const s = window.__sbr.store.getState()
      s.selectMedia(s.doc.media[0].id)
      s.selectFrame(id)
      // A punchy scope reframe pulled onto the hero, clearly inset from the full
      // frame so the crop rectangle + corner handles + guides read on the stage.
      s.setFrameCrop(id, crop)
      s.setGuidesOn(true)
    },
    { id: frameIds[1], crop }
  )
  // The crop overlay measures its container on mount; nudge it once more after
  // the stage has laid out so the rect + guides render at the right size.
  await page.waitForTimeout(500)
  await page.evaluate(({ id, crop }) => window.__sbr.store.getState().setFrameCrop(id, crop), {
    id: frameIds[1],
    crop
  })
  await page.waitForTimeout(700)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/stage.png` })
  verify('stage.png')
})

test('inspector — a frame with filled shot metadata, duration, and a prompt', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  // The vendor frame: a full shot row (scene/shot/size/angle/lens/movement/
  // transition), a hold time, a 4:3 reframe, and a strong Midjourney prompt.
  await page.evaluate((id) => {
    const s = window.__sbr.store.getState()
    s.setGuidesOn(false)
    s.selectMedia(s.doc.media[0].id)
    s.selectFrame(id)
  }, frameIds[3])
  await page.waitForTimeout(1100)
  // The Inspector is taller than the viewport; scroll it so the shot fields and
  // the filled Midjourney prompt are both in frame.
  await page.evaluate(() => {
    const el = document.querySelector('.inspector-col') as HTMLElement | null
    if (el) el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(300)
  await clearToasts()
  await page.screenshot({ path: `${OUT}/inspector.png` })
  verify('inspector.png')
})

test('present — Present mode playing the board fullscreen with a metadata strip', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await clearToasts()
  await page.evaluate(() => {
    const s = window.__sbr.store.getState()
    s.setPresentOpen(true)
  })
  // Present resets to the first frame and holds it (4s) — capture inside the hold.
  await page.waitForTimeout(1300)
  await page.screenshot({ path: `${OUT}/present.png` })
  verify('present.png')
  await page.evaluate(() => window.__sbr.store.getState().setPresentOpen(false))
  await page.waitForTimeout(300)
})

test('export — the Export menu open over the finished board', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(180_000)
  // Run a real board export so the deliverables are proven, then open the
  // Export ▾ menu over the full board for the capture.
  await page.evaluate(async () => {
    const s = window.__sbr.store.getState()
    const frames = s.orderedFrames()
    const inputs: any[] = []
    for (const f of frames) {
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
        mediaName: media.name,
        durationS: f.durationS,
        shot: f.shot,
        annotations: f.annotations
      })
    }
    const sep = s.projectFolder.includes('\\') ? '\\' : '/'
    await window.sbr.exportBoard({ projectName: s.doc.name, exportsRoot: `${s.projectFolder}${sep}exports`, frames: inputs })
    s.selectFrame(null)
    s.selectMedia(s.doc.media[0].id)
  })
  await clearToasts()
  await page.getByRole('button', { name: 'Export ▾' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/export.png` })
  verify('export.png')
})

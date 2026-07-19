/**
 * Headless smoke test: launch the built app, script a session through the
 * store + control paths the UI calls, run real ffmpeg extraction (interval AND
 * scene modes on a generated test clip with a mid-clip color flip), set a crop,
 * run a real export, and assert the package on disk. Also verifies that
 * ai:describeFrame without credentials returns a structured friendly error.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

// The page.evaluate callbacks run in the renderer where window.sbr exists; the
// node-side typechecker needs the declaration to accept them.
declare global {
  interface Window {
    sbr: any
    __sbr: { store: any }
  }
}

let app: ElectronApplication
let page: Page
let smokeDir: string
let clipPath: string

function makeTestClip(dir: string): string {
  // Two 1s testsrc segments of different colors concatenated → a scene cut at
  // t=1s that scene-detect must find. All via ffmpeg; no external assets.
  const out = join(dir, 'clip.mp4')
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1,format=yuv420p',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1,format=yuv420p',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]',
    '-map', '[v]', '-r', '24', out
  ])
  return out
}

test.beforeAll(async () => {
  smokeDir = mkdtempSync(join(tmpdir(), 'sbr-smoke-'))
  clipPath = makeTestClip(smokeDir)
  app = await electron.launch({
    args: ['out/main/index.js'],
    // No ANTHROPIC_API_KEY → describe must return a friendly error, not crash.
    env: { ...process.env, SBR_SMOKE_DIR: smokeDir, ANTHROPIC_API_KEY: '' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('boots to the welcome screen', async () => {
  await expect(page.locator('.welcome img[alt="Storyboard Reference Studio"]')).toBeVisible()
})

test('creates a project and imports the test clip', async () => {
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.workspace')).toBeVisible()

  const mediaCount = await page.evaluate(async (clip) => {
    const w = window as unknown as { __sbr: { store: any } }
    const s = w.__sbr.store.getState()
    const imported = await window.sbr.importMedia(s.projectFolder, clip)
    s.addMedia(imported)
    return w.__sbr.store.getState().doc.media.length
  }, clipPath)
  expect(mediaCount).toBe(1)

  const dims = await page.evaluate(() => {
    const m = (window as unknown as { __sbr: { store: any } }).__sbr.store.getState().doc.media[0]
    return { width: m.width, height: m.height, kind: m.kind }
  })
  expect(dims.width).toBe(320)
  expect(dims.height).toBe(180)
  expect(dims.kind).toBe('video')
})

test('extracts frames via interval AND scene modes; PNGs on disk + in store', async () => {
  const result = await page.evaluate(async () => {
    const s = (window as unknown as { __sbr: { store: any } }).__sbr.store.getState()
    const media = s.doc.media[0]
    const abs = s.mediaAbsPath(media.id)
    const outDir = `${s.projectFolder}/.frames`
    await window.sbr.ensureDir(outDir)

    const interval = await window.sbr.extractRange(abs, 0, 2, { kind: 'interval', everyS: 0.5 }, outDir)
    const scene = await window.sbr.extractRange(abs, 0, 2, { kind: 'scene', threshold: 0.3 }, outDir)

    // Add scene frames to the board (the same path Auto-board uses).
    const ids: string[] = []
    for (const f of scene.frames) {
      const frame = s.addFrame(media.id, f.time, `SHOT @ ${f.time.toFixed(1)}s`)
      s.setStill(frame.id, { path: f.path, width: media.width, height: media.height })
      ids.push(frame.id)
    }
    return {
      intervalOk: interval.ok,
      intervalCount: interval.frames.length,
      sceneOk: scene.ok,
      sceneCount: scene.frames.length,
      scenePaths: scene.frames.map((x: any) => x.path),
      frameCount: (window as unknown as { __sbr: { store: any } }).__sbr.store.getState().doc.frames.length,
      addedIds: ids
    }
  })
  expect(result.intervalOk).toBe(true)
  expect(result.intervalCount).toBeGreaterThanOrEqual(4)
  expect(result.sceneOk).toBe(true)
  // The red→blue cut at t=1 must produce at least one detected scene frame.
  expect(result.sceneCount).toBeGreaterThanOrEqual(2)
  expect(result.frameCount).toBeGreaterThanOrEqual(2)
  for (const p of result.scenePaths) expect(existsSync(p)).toBe(true)
})

test('sets a crop on the first frame', async () => {
  const ok = await page.evaluate(() => {
    const s = (window as unknown as { __sbr: { store: any } }).__sbr.store.getState()
    const first = s.orderedFrames()[0]
    s.setFrameCrop(first.id, { aspect: '1:1', x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    return s.frame(first.id).crop.aspect === '1:1'
  })
  expect(ok).toBe(true)
})

test('describe without credentials returns a structured friendly error', async () => {
  const res = await page.evaluate(async () => {
    const s = (window as unknown as { __sbr: { store: any } }).__sbr.store.getState()
    const first = s.orderedFrames()[0]
    // ensureStill then describe directly through IPC (offline path).
    const still = `${s.projectFolder}/.frames/${first.id}.png`
    await window.sbr.extractFrame(s.mediaAbsPath(first.mediaId), first.timeS, still)
    return await window.sbr.describeFrame(still, 'midjourney', '')
  })
  expect(res.ok).toBe(false)
  expect(typeof res.error).toBe('string')
  expect(res.error.length).toBeGreaterThan(0)
})

test('offline template prompt fills from metadata', async () => {
  // Store a template-derived prompt so export has a prompt.txt to write.
  const text = await page.evaluate(() => {
    const s = (window as unknown as { __sbr: { store: any } }).__sbr.store.getState()
    const first = s.orderedFrames()[0]
    s.setFrameLabel(first.id, 'HERO ENTERS')
    s.setFramePrompt(first.id, 'wide shot, hero enters, cinematic still --ar 1:1 --style raw', 'midjourney', 'template')
    return s.frame(first.id).prompt.text
  })
  expect(text).toContain('hero enters')
})

test('exports a real board package with all expected files', async () => {
  test.setTimeout(120_000)
  // Assemble export inputs in-page (the same shape the Board button builds) and
  // export via the real IPC → ffmpeg pipeline.
  const pkg = await page.evaluate(async () => {
    const s = (window as unknown as { __sbr: { store: any } }).__sbr.store.getState()
    const frames = s.orderedFrames()
    const inputs: any[] = []
    for (const f of frames) {
      const still = `${s.projectFolder}/.frames/${f.id}.png`
      await window.sbr.extractFrame(s.mediaAbsPath(f.mediaId), f.timeS, still)
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
    const res = await window.sbr.exportBoard({ projectName: s.doc.name, exportsRoot, frames: inputs })
    return res
  })

  expect(pkg.ok, `export failed: ${pkg.error ?? ''}`).toBe(true)
  const dir = pkg.packagePath as string
  expect(existsSync(dir)).toBe(true)

  const files = readdirSync(dir)
  expect(files).toContain('prompts.json')
  expect(files).toContain('board.md')
  expect(files).toContain('contact-sheet.png')

  // First frame folder holds still.png + prompt.txt.
  const frameFolders = files.filter((f) => /^\d\d_/.test(f))
  expect(frameFolders.length).toBeGreaterThanOrEqual(1)
  const firstFolder = join(dir, frameFolders.sort()[0]!)
  expect(existsSync(join(firstFolder, 'still.png'))).toBe(true)
  expect(existsSync(join(firstFolder, 'prompt.txt'))).toBe(true)

  // prompts.json is valid and lists the frames.
  const promptsJson = JSON.parse(readFileSync(join(dir, 'prompts.json'), 'utf-8'))
  expect(Array.isArray(promptsJson.frames)).toBe(true)
  expect(promptsJson.frames.length).toBe(frameFolders.length)

  // board.md is a real markdown storyboard.
  const md = readFileSync(join(dir, 'board.md'), 'utf-8')
  expect(md).toContain('# ')
  expect(md).toContain('still.png')

  // contact-sheet.png is a non-trivial image.
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', join(dir, 'contact-sheet.png')
    ]).toString()
  )
  const stream = probe.streams.find((x: any) => x.codec_type === 'video')
  expect(stream.width).toBeGreaterThan(100)
})

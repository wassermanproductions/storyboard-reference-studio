/**
 * Upgrade end-to-end: schema v1→v2 migration, per-frame duration + shot meta +
 * annotations, and the new exports (animatic MP4, PDF, shot-list CSV) plus
 * Present mode. Runs against the built app with real ffmpeg, the same way the
 * smoke test does. Wired into `npm run e2e`.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, existsSync, statSync, readFileSync, readdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

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
  const out = join(dir, 'clip.mp4')
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1,format=yuv420p',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1,format=yuv420p',
    '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=1,format=yuv420p',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[v]',
    '-map', '[v]', '-r', '24', out
  ])
  return out
}

test.beforeAll(async () => {
  smokeDir = mkdtempSync(join(tmpdir(), 'sbr-upgrade-'))
  clipPath = makeTestClip(smokeDir)
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, SBR_SMOKE_DIR: smokeDir, ANTHROPIC_API_KEY: '' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('boots and creates a project', async () => {
  await expect(page.locator('.welcome img[alt="Storyboard Reference Studio"]')).toBeVisible()
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.workspace')).toBeVisible()
})

test('migrates a v1 project.json to v2 without throwing', async () => {
  const migrated = await page.evaluate(() => {
    const v1 = {
      version: 1,
      id: 'proj_old',
      name: 'Legacy',
      media: [{ id: 'm1', kind: 'video', sourceFile: 'media/x.mp4', name: 'x.mp4', width: 320, height: 180 }],
      frames: [{ id: 'f1', mediaId: 'm1', timeS: 0, label: 'OLD', notes: '', order: 0, crop: null, prompt: null }],
      settings: { defaultProfileId: 'midjourney' }
    }
    const s = window.__sbr.store.getState()
    const ok = s.loadFromJson(s.projectFolder, JSON.stringify(v1))
    const doc = window.__sbr.store.getState().doc
    const f = doc.frames[0]
    return {
      ok,
      version: doc.version,
      durationS: f.durationS,
      hasShot: !!f.shot && typeof f.shot.sceneNo === 'string',
      annotations: Array.isArray(f.annotations) ? f.annotations.length : -1,
      audioFile: doc.settings.audioFile
    }
  })
  expect(migrated.ok).toBe(true)
  expect(migrated.version).toBe(2)
  expect(migrated.durationS).toBe(2)
  expect(migrated.hasShot).toBe(true)
  expect(migrated.annotations).toBe(0)
  expect(migrated.audioFile).toBe(null)
})

test('imports a clip and builds a board with durations, shot meta, annotations', async () => {
  const result = await page.evaluate(async (clip) => {
    // Fresh project so the migrated legacy doc doesn't linger.
    const s0 = window.__sbr.store.getState()
    s0.newProject(s0.projectFolder, 'Upgrade')
    const s = window.__sbr.store.getState()
    const imported = await window.sbr.importMedia(s.projectFolder, clip)
    const media = s.addMedia(imported)
    const abs = s.mediaAbsPath(media.id)
    const outDir = `${s.projectFolder}/.frames`
    await window.sbr.ensureDir(outDir)
    const res = await window.sbr.extractRange(abs, 0, 2.8, { kind: 'count', n: 3 }, outDir)
    const ids: string[] = []
    res.frames.forEach((f: any, i: number) => {
      const frame = s.addFrame(media.id, f.time, `SHOT ${i + 1}`)
      s.setStill(frame.id, { path: f.path, width: media.width, height: media.height })
      ids.push(frame.id)
    })
    const durations = [1, 1.5, 2]
    ids.forEach((id, i) => s.setFrameDuration(id, durations[i]))
    s.setFrameShot(ids[0], { sceneNo: '1', shotNo: '1A', shotSize: 'wide shot', cameraAngle: 'low angle', lens: '35mm', movement: 'Dolly in', transition: 'Cut' })
    s.addAnnotation(ids[0], { kind: 'arrow', points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], color: '#ff5533' })
    s.addAnnotation(ids[1], { kind: 'text', points: [{ x: 0.5, y: 0.5 }], text: 'push in', color: '#ffd400' })
    const st = window.__sbr.store.getState()
    return {
      frameCount: st.doc.frames.length,
      d0: st.frame(ids[0]).durationS,
      d1: st.frame(ids[1]).durationS,
      shotSize: st.frame(ids[0]).shot.shotSize,
      anno0: st.frame(ids[0]).annotations.length,
      anno1: st.frame(ids[1]).annotations.length,
      ids
    }
  }, clipPath)
  expect(result.frameCount).toBe(3)
  expect(result.d0).toBe(1)
  expect(result.d1).toBe(1.5)
  expect(result.shotSize).toBe('wide shot')
  expect(result.anno0).toBe(1)
  expect(result.anno1).toBe(1)
})

test('exports an animatic MP4 at 1920×1080 with duration ≈ sum of holds', async () => {
  test.setTimeout(120_000)
  const out = await page.evaluate(async () => {
    const s = window.__sbr.store.getState()
    const frames = s.orderedFrames()
    const inputs = frames.map((f: any) => {
      const media = s.media(f.mediaId)
      return {
        sourcePng: s.stills[f.id].path,
        label: f.label,
        notes: f.notes,
        promptText: f.prompt?.text ?? '',
        profileId: 'midjourney',
        crop: f.crop,
        sourceWidth: media.width,
        sourceHeight: media.height,
        timeS: f.timeS,
        mediaName: media.name,
        durationS: f.durationS,
        shot: f.shot,
        annotations: f.annotations
      }
    })
    const exportsRoot = `${s.projectFolder}/exports`
    return window.sbr.exportAnimatic({ projectName: s.doc.name, exportsRoot, frames: inputs }, { burnLabel: false, audioPath: null })
  })
  expect(out.ok, `animatic failed: ${out.error ?? ''}`).toBe(true)
  expect(existsSync(out.videoPath)).toBe(true)

  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', out.videoPath
    ]).toString()
  )
  const v = probe.streams.find((x: any) => x.codec_type === 'video')
  expect(v.width).toBe(1920)
  expect(v.height).toBe(1080)
  const duration = Number(probe.format.duration)
  // Sum of holds is 1 + 1.5 + 2 = 4.5s; allow slack for the concat demuxer /
  // constant-frame-rate resample.
  expect(duration).toBeGreaterThan(3.9)
  expect(duration).toBeLessThan(5.2)
})

test('exports a PDF storyboard (>10KB)', async () => {
  test.setTimeout(120_000)
  const out = await page.evaluate(async () => {
    const s = window.__sbr.store.getState()
    const frames = s.orderedFrames()
    const inputs = frames.map((f: any) => {
      const media = s.media(f.mediaId)
      return {
        sourcePng: s.stills[f.id].path,
        label: f.label, notes: f.notes, promptText: '', profileId: 'midjourney',
        crop: f.crop, sourceWidth: media.width, sourceHeight: media.height,
        timeS: f.timeS, mediaName: media.name, durationS: f.durationS, shot: f.shot, annotations: f.annotations
      }
    })
    const exportsRoot = `${s.projectFolder}/exports`
    return window.sbr.exportPdf({ projectName: s.doc.name, exportsRoot, frames: inputs })
  })
  expect(out.ok, `pdf failed: ${out.error ?? ''}`).toBe(true)
  expect(existsSync(out.pdfPath)).toBe(true)
  expect(statSync(out.pdfPath).size).toBeGreaterThan(10_000)
})

test('exports a PDF from a big board (stills beyond the data-URL cap)', async () => {
  test.setTimeout(180_000)
  // Real boards embed full-res stills whose combined data URLs exceed
  // Chromium's ~2MB URL limit — loading the print page via a data: URL
  // fails with ERR_INVALID_URL. Guard the temp-file load path with eight
  // high-entropy (poorly compressible) 1600×900 stills.
  const bigDir = join(smokeDir, 'big-stills')
  mkdirSync(bigDir, { recursive: true })
  const bigStills: string[] = []
  for (let i = 0; i < 8; i++) {
    const p = join(bigDir, `noise-${i}.png`)
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `nullsrc=s=1600x900,geq=random(${i + 1})*255:random(${i + 2})*255:random(${i + 3})*255`,
      '-frames:v', '1', p
    ])
    bigStills.push(p)
  }
  const totalBytes = bigStills.reduce((n, p) => n + statSync(p).size, 0)
  expect(totalBytes).toBeGreaterThan(2_000_000) // must actually exceed the URL cap

  const out = await page.evaluate(async (stills: string[]) => {
    const s = window.__sbr.store.getState()
    const frames = stills.map((p, i) => ({
      sourcePng: p,
      label: `BIG ${i + 1}`, notes: '', promptText: '', profileId: 'midjourney',
      crop: null, sourceWidth: 1600, sourceHeight: 900,
      timeS: i, mediaName: 'noise.png', durationS: 2,
      shot: { sceneNo: '1', shotNo: `${i + 1}`, shotSize: '', cameraAngle: '', lens: '', movement: '', transition: '' },
      annotations: []
    }))
    const exportsRoot = `${s.projectFolder}/exports`
    return window.sbr.exportPdf({ projectName: 'Big Board', exportsRoot, frames })
  }, bigStills)
  expect(out.ok, `big-board pdf failed: ${out.error ?? ''}`).toBe(true)
  expect(statSync(out.pdfPath).size).toBeGreaterThan(100_000)
})

test('exports a shot-list CSV with a header + one row per frame', async () => {
  const out = await page.evaluate(async () => {
    const s = window.__sbr.store.getState()
    const frames = s.orderedFrames()
    const inputs = frames.map((f: any) => {
      const media = s.media(f.mediaId)
      return {
        sourcePng: s.stills[f.id].path,
        label: f.label, notes: f.notes, promptText: f.prompt?.text ?? '', profileId: 'midjourney',
        crop: f.crop, sourceWidth: media.width, sourceHeight: media.height,
        timeS: f.timeS, mediaName: media.name, durationS: f.durationS, shot: f.shot, annotations: f.annotations
      }
    })
    const exportsRoot = `${s.projectFolder}/exports`
    return window.sbr.exportShotlist({ projectName: s.doc.name, exportsRoot, frames: inputs })
  })
  expect(out.ok, `shotlist failed: ${out.error ?? ''}`).toBe(true)
  expect(existsSync(out.csvPath)).toBe(true)
  const csv = readFileSync(out.csvPath, 'utf-8').trim().split(/\r?\n/)
  expect(csv[0]).toContain('Scene')
  expect(csv[0]).toContain('Movement')
  expect(csv[0]).toContain('Duration (s)')
  expect(csv.length).toBe(1 + 3) // header + 3 frames
})

test('board export composites annotations via the renderer (no hidden windows)', async () => {
  test.setTimeout(120_000)
  const folder = await page.evaluate(() => window.__sbr.store.getState().projectFolder as string)
  // Click the real Export board button — this runs buildExportInputs, which
  // composites annotations onto the annotated frames' stills renderer-side.
  await page.getByRole('button', { name: 'Export board' }).click()
  await expect(page.locator('.toast.success')).toBeVisible({ timeout: 60_000 })
  // The doc must still be present (no renderer reset from a hidden window).
  const stillHasDoc = await page.evaluate(() => !!window.__sbr.store.getState().doc)
  expect(stillHasDoc).toBe(true)
  // A composited anno-*.png was written for the annotated frames.
  const annoFiles = readdirSync(join(folder, '.frames')).filter((f) => f.startsWith('anno-'))
  expect(annoFiles.length).toBeGreaterThanOrEqual(1)
  // And a board package landed in exports/.
  const boards = readdirSync(join(folder, 'exports')).filter((f) => f.startsWith('board-'))
  expect(boards.length).toBeGreaterThanOrEqual(1)
})

test('present mode opens and closes', async () => {
  await page.evaluate(() => window.__sbr.store.getState().setPresentOpen(true))
  await expect(page.locator('.present-overlay')).toBeVisible()
  await page.evaluate(() => window.__sbr.store.getState().setPresentOpen(false))
  await expect(page.locator('.present-overlay')).toHaveCount(0)
})

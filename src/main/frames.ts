/**
 * Frame extraction from videos via ffmpeg. Three range modes:
 *   - interval: one frame every N seconds
 *   - count:    N evenly-spaced frames
 *   - scene:    ffmpeg scene-change detection (select gt(scene,threshold))
 */

import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { resolveFfmpeg, run } from './ffmpeg'

/** Extract a single full-resolution PNG at time t. */
export async function extractFrame(
  mediaPath: string,
  timeS: number,
  outPng: string
): Promise<{ ok: boolean; error?: string; path: string }> {
  const ffmpeg = await resolveFfmpeg()
  await mkdir(dirname(outPng), { recursive: true })
  // -ss before -i is fast (keyframe seek); accurate enough for stills.
  const res = await run(ffmpeg, [
    '-y', '-ss', String(Math.max(0, timeS)), '-i', mediaPath, '-frames:v', '1', outPng
  ])
  if (res.code !== 0) return { ok: false, error: res.stderr.slice(-400), path: outPng }
  return { ok: true, path: outPng }
}

export type RangeMode =
  | { kind: 'interval'; everyS: number }
  | { kind: 'scene'; threshold: number }
  | { kind: 'count'; n: number }

export interface ExtractRangeResult {
  ok: boolean
  error?: string
  frames: { time: number; path: string }[]
}

const SCENE_CAP = 40

/**
 * Extract frames across [startS, endS] per the mode. Returns the PNG paths and
 * their source times. outDir receives files named frame-<index>.png.
 */
export async function extractRange(
  mediaPath: string,
  startS: number,
  endS: number,
  mode: RangeMode,
  outDir: string
): Promise<ExtractRangeResult> {
  await mkdir(outDir, { recursive: true })
  const span = Math.max(0, endS - startS)

  if (mode.kind === 'scene') {
    return extractScene(mediaPath, startS, endS, mode.threshold, outDir)
  }

  // interval / count → compute times, extract each with an accurate seek.
  let times: number[] = []
  if (mode.kind === 'interval') {
    const step = Math.max(0.05, mode.everyS)
    for (let t = startS; t <= endS + 1e-6 && times.length < 300; t += step) times.push(t)
  } else {
    const n = Math.max(1, Math.floor(mode.n))
    if (n === 1) times = [startS + span / 2]
    else for (let i = 0; i < n; i++) times.push(startS + (span * i) / (n - 1))
  }

  const frames: { time: number; path: string }[] = []
  for (let i = 0; i < times.length; i++) {
    const path = join(outDir, `frame-${String(i).padStart(3, '0')}.png`)
    const r = await extractFrame(mediaPath, times[i]!, path)
    if (r.ok) frames.push({ time: times[i]!, path })
  }
  if (frames.length === 0) return { ok: false, error: 'no frames extracted', frames: [] }
  return { ok: true, frames }
}

/**
 * Scene-change extraction: select='gt(scene,threshold)',showinfo and parse
 * pts_time from the showinfo lines on stderr, then extract a PNG at each.
 */
async function extractScene(
  mediaPath: string,
  startS: number,
  endS: number,
  threshold: number,
  outDir: string
): Promise<ExtractRangeResult> {
  const ffmpeg = await resolveFfmpeg()
  const th = Math.min(0.99, Math.max(0.01, threshold))
  // Detect across the whole clip (showinfo reports ABSOLUTE source pts_time),
  // then keep only cuts inside the requested window. A trim+setpts here would
  // zero the timestamps and lose the real cut times.
  const nullSink = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const res = await run(ffmpeg, [
    '-i', mediaPath,
    '-vf', `select='gt(scene\\,${th})',showinfo`,
    '-vsync', 'vfr', '-f', 'null', nullSink
  ])
  // showinfo lines look like: ... pts_time:12.345 ...
  const times: number[] = []
  const re = /pts_time:([\d.]+)/g
  let m: RegExpExecArray | null
  const windowed = endS > startS
  while ((m = re.exec(res.stderr)) !== null) {
    const t = Number(m[1])
    if (!isFinite(t)) continue
    if (windowed && (t < startS - 1e-3 || t > endS + 1e-3)) continue
    times.push(t)
    if (times.length >= SCENE_CAP) break
  }
  // Always include the start frame so a cut-less section still yields something.
  if (times.length === 0 || times[0]! - startS > 0.25) times.unshift(startS)

  const frames: { time: number; path: string }[] = []
  for (let i = 0; i < times.length; i++) {
    const path = join(outDir, `scene-${String(i).padStart(3, '0')}.png`)
    const r = await extractFrame(mediaPath, times[i]!, path)
    if (r.ok) frames.push({ time: times[i]!, path })
  }
  if (frames.length === 0) return { ok: false, error: 'no scene frames extracted', frames: [] }
  return { ok: true, frames }
}

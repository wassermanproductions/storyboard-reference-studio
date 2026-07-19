/**
 * Board export. Given the project and an ordered list of frames (each with a
 * resolved source media path + optional crop + prompt text), write a package:
 *
 *   exports/board-<stamp>/
 *     NN_<slug>/still.png     full-res still, crop applied via ffmpeg
 *     NN_<slug>/prompt.txt    the frame's prompt (or template scaffold)
 *     prompts.json            whole board, machine-readable
 *     contact-sheet.png       ffmpeg tile montage with labels burned via drawtext
 *     board.md                readable markdown storyboard
 *
 * Runs in the main process. Returns the package path on success.
 */

import { mkdir, writeFile, copyFile } from 'fs/promises'
import { join } from 'path'
import { resolveFfmpeg, run } from './ffmpeg'
import { slugLabel, emptyShotMeta } from '../shared/types'
import type { Crop, ShotMeta, Annotation } from '../shared/types'

/**
 * Each frame's `sourcePng` is a full-resolution still with any annotations
 * already composited on (the renderer draws them onto a canvas before export —
 * see frameOps.compositeAnnotated). The main process only crops + assembles.
 */
export interface ExportFrameInput {
  /** Absolute path to the source still already extracted at full res (PNG). */
  sourcePng: string
  label: string
  notes: string
  promptText: string
  profileId: string
  crop: Crop | null
  /** Source media dimensions (for turning normalized crop → pixels). */
  sourceWidth: number
  sourceHeight: number
  timeS: number
  mediaName: string
  /** Animatic hold time (seconds). Optional; defaults to 2. */
  durationS?: number
  /** Shot-list metadata. Optional; defaults to all-blank. */
  shot?: ShotMeta
  /** Camera-move / action annotations (already composited into sourcePng). */
  annotations?: Annotation[]
}

export interface ExportInput {
  projectName: string
  exportsRoot: string
  frames: ExportFrameInput[]
}

export interface ExportOutput {
  ok: boolean
  error?: string
  packagePath: string
}

export function exportStamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')
}

function stamp(): string {
  return exportStamp()
}

/**
 * Produce a display PNG for a frame: the crop applied at full resolution to the
 * (already annotation-composited) source still. Used by the PDF export. Falls
 * back to the plain still if cropping fails, so a frame is never lost.
 */
export async function renderDisplayStill(
  f: ExportFrameInput,
  workDir: string,
  index: number
): Promise<string> {
  const ffmpeg = await resolveFfmpeg()
  await mkdir(workDir, { recursive: true })
  const filter = cropFilter(f.crop, f.sourceWidth, f.sourceHeight)
  if (!filter) return f.sourcePng
  const out = join(workDir, `disp-${String(index).padStart(3, '0')}.png`)
  const res = await run(ffmpeg, ['-y', '-i', f.sourcePng, '-vf', filter, out])
  return res.code === 0 ? out : f.sourcePng
}

/** ffmpeg crop filter from a normalized crop, snapped to even pixels. */
function cropFilter(crop: Crop | null, w: number, h: number): string | null {
  if (!crop) return null
  if (crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1) return null
  const cw = Math.max(2, Math.round((crop.w * w) / 2) * 2)
  const ch = Math.max(2, Math.round((crop.h * h) / 2) * 2)
  const cx = Math.max(0, Math.round(crop.x * w))
  const cy = Math.max(0, Math.round(crop.y * h))
  return `crop=${cw}:${ch}:${cx}:${cy}`
}

/** Escape a string for ffmpeg drawtext (colons, quotes, backslashes). */
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "’")
    .replace(/%/g, '\\%')
}

export async function exportBoard(input: ExportInput): Promise<ExportOutput> {
  const ffmpeg = await resolveFfmpeg()
  const st = stamp()
  const pkg = join(input.exportsRoot, `board-${st}`)
  await mkdir(pkg, { recursive: true })

  const stillPaths: string[] = []
  const promptsJson: unknown[] = []
  const mdLines: string[] = [`# ${input.projectName} — storyboard`, '', `_${input.frames.length} frames · exported ${st}_`, '']

  for (let i = 0; i < input.frames.length; i++) {
    const f = input.frames[i]!
    const nn = String(i + 1).padStart(2, '0')
    const folderName = `${nn}_${slugLabel(f.label)}`
    const dir = join(pkg, folderName)
    await mkdir(dir, { recursive: true })
    const stillOut = join(dir, 'still.png')

    // sourcePng already has annotations composited (renderer-side). Apply the
    // crop at full source resolution if one is set, else copy.
    const filter = cropFilter(f.crop, f.sourceWidth, f.sourceHeight)
    if (filter) {
      const res = await run(ffmpeg, ['-y', '-i', f.sourcePng, '-vf', filter, stillOut])
      if (res.code !== 0) {
        // Fall back to the uncropped still so the export never loses a frame.
        await copyFile(f.sourcePng, stillOut)
      }
    } else {
      await copyFile(f.sourcePng, stillOut)
    }
    stillPaths.push(stillOut)

    await writeFile(join(dir, 'prompt.txt'), f.promptText || '', 'utf-8')

    promptsJson.push({
      index: i + 1,
      folder: folderName,
      label: f.label,
      notes: f.notes,
      timeS: f.timeS,
      source: f.mediaName,
      profileId: f.profileId,
      crop: f.crop,
      prompt: f.promptText
    })

    mdLines.push(
      `## ${nn} — ${f.label || '(untitled)'}`,
      '',
      `![${f.label}](${folderName}/still.png)`,
      ''
    )
    if (f.notes) mdLines.push(`**Notes:** ${f.notes}`, '')
    if (f.promptText) mdLines.push('```', f.promptText, '```', '')
  }

  await writeFile(
    join(pkg, 'prompts.json'),
    JSON.stringify({ project: input.projectName, exportedAt: st, frames: promptsJson }, null, 2),
    'utf-8'
  )
  await writeFile(join(pkg, 'board.md'), mdLines.join('\n'), 'utf-8')

  await buildContactSheet(ffmpeg, pkg, input.frames, stillPaths)

  return { ok: true, packagePath: pkg }
}

/**
 * Contact sheet: normalize each still to a fixed cell (scale+pad), burn its
 * NN + label with drawtext, then tile them into a grid via xstack-free montage
 * using the tile filter on a concat of labeled cells.
 */
async function buildContactSheet(
  ffmpeg: string,
  pkg: string,
  frames: ExportFrameInput[],
  stillPaths: string[]
): Promise<void> {
  if (stillPaths.length === 0) return
  const cellW = 480
  const cellH = 270
  const cols = Math.min(4, stillPaths.length)
  const rows = Math.ceil(stillPaths.length / cols)

  // Build one labeled cell per still into a temp file, then tile.
  const cellDir = join(pkg, '.cells')
  await mkdir(cellDir, { recursive: true })
  const cellFiles: string[] = []
  for (let i = 0; i < stillPaths.length; i++) {
    const f = frames[i]!
    const label = escapeDrawtext(`${String(i + 1).padStart(2, '0')}  ${f.label || ''}`.trim())
    const cell = join(cellDir, `cell-${String(i).padStart(3, '0')}.png`)
    const vf = [
      `scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease`,
      `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:color=0x18181b`,
      `drawtext=text='${label}':x=8:y=${cellH - 26}:fontsize=18:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=6`
    ].join(',')
    const res = await run(ffmpeg, ['-y', '-i', stillPaths[i]!, '-vf', vf, cell])
    if (res.code === 0) cellFiles.push(cell)
  }
  if (cellFiles.length === 0) return

  // Tile the cells: feed as an image sequence via concat demuxer then tile.
  const listPath = join(cellDir, 'list.txt')
  await writeFile(listPath, cellFiles.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8')
  const sheetOut = join(pkg, 'contact-sheet.png')
  const res = await run(ffmpeg, [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', `tile=${cols}x${rows}:padding=8:margin=8:color=0x111113`,
    '-frames:v', '1', sheetOut
  ])
  if (res.code !== 0) {
    // Last resort: at least copy the first cell so the file exists.
    await copyFile(cellFiles[0]!, sheetOut)
  }
}

/* ------------------------------ animatic ------------------------------- */

export interface AnimaticOptions {
  /** Burn each frame's label into the bottom of the picture. */
  burnLabel?: boolean
  /** Absolute path to a scratch-track audio file to mux (or null). */
  audioPath?: string | null
}

export interface AnimaticOutput {
  ok: boolean
  error?: string
  videoPath: string
}

const ANIMATIC_W = 1920
const ANIMATIC_H = 1080

/**
 * Export an animatic MP4: each frame held for its durationS, scaled/padded to
 * 1920×1080 (letterbox, crop + annotations respected), 24fps, yuv420p. If an
 * audio scratch track is supplied it is muxed with -shortest.
 */
export async function exportAnimatic(input: ExportInput, opts: AnimaticOptions = {}): Promise<AnimaticOutput> {
  const ffmpeg = await resolveFfmpeg()
  const st = stamp()
  await mkdir(input.exportsRoot, { recursive: true })
  const videoPath = join(input.exportsRoot, `animatic-${st}.mp4`)

  if (input.frames.length === 0) return { ok: false, error: 'no frames to export', videoPath }

  // Encode one constant-framerate segment per frame, each held for exactly its
  // duration (deterministic totals), then concat the segments. sourcePng already
  // has annotations composited; we crop + scale/pad to 1920×1080 here.
  const cellDir = join(input.exportsRoot, `.animatic-${st}`)
  await mkdir(cellDir, { recursive: true })

  const segs: string[] = []
  for (let i = 0; i < input.frames.length; i++) {
    const f = input.frames[i]!
    const dur = Math.max(0.25, Math.min(30, f.durationS ?? 2))
    const parts: string[] = []
    const crop = cropFilter(f.crop, f.sourceWidth, f.sourceHeight)
    if (crop) parts.push(crop)
    parts.push(`scale=${ANIMATIC_W}:${ANIMATIC_H}:force_original_aspect_ratio=decrease`)
    parts.push(`pad=${ANIMATIC_W}:${ANIMATIC_H}:(ow-iw)/2:(oh-ih)/2:color=black`)
    if (opts.burnLabel && f.label) {
      parts.push(
        `drawtext=text='${escapeDrawtext(f.label)}':x=40:y=${ANIMATIC_H - 72}:fontsize=36:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=12`
      )
    }
    const seg = join(cellDir, `seg-${String(i).padStart(4, '0')}.mp4`)
    const res = await run(ffmpeg, [
      '-y', '-loop', '1', '-i', f.sourcePng, '-t', dur.toFixed(3),
      '-vf', parts.join(','), '-r', '24', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', seg
    ])
    if (res.code === 0) segs.push(seg)
  }
  if (segs.length === 0) return { ok: false, error: 'no frames rendered', videoPath }

  const q = (p: string): string => `file '${p.replace(/'/g, "'\\''")}'`
  const listPath = join(cellDir, 'list.txt')
  await writeFile(listPath, segs.map(q).join('\n') + '\n', 'utf-8')

  // Concat the segments; mux the scratch track (if any) with -shortest.
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]
  if (opts.audioPath) {
    args.push('-i', opts.audioPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest')
  } else {
    args.push('-c', 'copy')
  }
  args.push(videoPath)

  const enc = await run(ffmpeg, args)
  if (enc.code !== 0) return { ok: false, error: enc.stderr.slice(-400), videoPath }
  return { ok: true, videoPath }
}

/* ------------------------------ shot list ------------------------------ */

export interface ShotListOutput {
  ok: boolean
  error?: string
  csvPath: string
}

function csvCell(s: string | number): string {
  const v = String(s ?? '')
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/** Export the board as a shot-list CSV. Returns the file path. */
export async function exportShotList(input: ExportInput): Promise<ShotListOutput> {
  const st = stamp()
  await mkdir(input.exportsRoot, { recursive: true })
  const csvPath = join(input.exportsRoot, `shotlist-${st}.csv`)
  const header = [
    '#', 'Scene', 'Shot', 'Label', 'Size', 'Angle', 'Lens', 'Movement',
    'Transition', 'Duration (s)', 'Time in source', 'Notes', 'Prompt profile', 'Prompt'
  ]
  const rows = [header.map(csvCell).join(',')]
  input.frames.forEach((f, i) => {
    const shot = f.shot ?? emptyShotMeta()
    rows.push(
      [
        i + 1,
        shot.sceneNo,
        shot.shotNo,
        f.label,
        shot.shotSize,
        shot.cameraAngle,
        shot.lens,
        shot.movement,
        shot.transition,
        (f.durationS ?? 2).toFixed(2),
        f.timeS.toFixed(2),
        f.notes,
        f.profileId,
        f.promptText
      ]
        .map(csvCell)
        .join(',')
    )
  })
  try {
    await writeFile(csvPath, rows.join('\r\n') + '\r\n', 'utf-8')
  } catch (e) {
    return { ok: false, error: (e as Error).message, csvPath }
  }
  return { ok: true, csvPath }
}

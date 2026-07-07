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
import { slugLabel } from '../shared/types'
import type { Crop } from '../shared/types'

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
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\..+$/, '')
  const pkg = join(input.exportsRoot, `board-${stamp}`)
  await mkdir(pkg, { recursive: true })

  const stillPaths: string[] = []
  const promptsJson: unknown[] = []
  const mdLines: string[] = [`# ${input.projectName} — storyboard`, '', `_${input.frames.length} frames · exported ${stamp}_`, '']

  for (let i = 0; i < input.frames.length; i++) {
    const f = input.frames[i]!
    const nn = String(i + 1).padStart(2, '0')
    const folderName = `${nn}_${slugLabel(f.label)}`
    const dir = join(pkg, folderName)
    await mkdir(dir, { recursive: true })
    const stillOut = join(dir, 'still.png')

    // Apply crop at full source resolution if one is set, else copy.
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
    JSON.stringify({ project: input.projectName, exportedAt: stamp, frames: promptsJson }, null, 2),
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

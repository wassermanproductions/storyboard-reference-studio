/**
 * PDF storyboard export (main process, zero new dependencies).
 *
 * Builds a self-contained print-layout HTML string (inline CSS, stills embedded
 * as data URLs with crop + annotations already applied), renders it in a hidden
 * BrowserWindow, and captures it with webContents.printToPDF (A4 landscape).
 * A cover page precedes a 2×3 grid of frame cells.
 */

import { BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { exportStamp, renderDisplayStill, type ExportInput } from './export'
import { emptyShotMeta } from '../shared/types'

export interface PdfOutput {
  ok: boolean
  error?: string
  pdfPath: string
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function dataUrl(pngPath: string): Promise<string> {
  const b64 = (await readFile(pngPath)).toString('base64')
  return `data:image/png;base64,${b64}`
}

function metaLine(parts: (string | undefined)[]): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join(' · ')
}

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #16161a; background: #fff; }
  .page { width: 297mm; height: 210mm; padding: 12mm 12mm 10mm; page-break-after: always; position: relative; }
  .page:last-child { page-break-after: auto; }
  .cover { display: flex; flex-direction: column; justify-content: center; }
  .cover h1 { font-size: 34pt; font-weight: 800; letter-spacing: 0.02em; }
  .cover .sub { margin-top: 10px; font-size: 13pt; color: #55555f; }
  .cover .credit { position: absolute; bottom: 12mm; left: 12mm; font-size: 9pt; color: #9a9aa4; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 6mm; height: 100%; }
  .cell { border: 1px solid #d8d8de; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; }
  .cell .pic { flex: 1; min-height: 0; background: #000; display: flex; align-items: center; justify-content: center; }
  .cell .pic img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .cell .cap { padding: 5px 8px; border-top: 1px solid #e4e4ea; }
  .cell .cap .label { font-weight: 700; font-size: 10pt; }
  .cell .cap .meta { font-size: 8pt; color: #55555f; margin-top: 2px; }
  .cell .cap .notes { font-size: 8pt; color: #33333a; margin-top: 2px; }
  .cell .idx { font-size: 8pt; color: #9a9aa4; font-weight: 700; }
  .cellhead { display: flex; align-items: baseline; gap: 6px; }
`

/** Build the print HTML for the whole board. */
function buildHtml(projectName: string, stills: string[], input: ExportInput): string {
  const dateStr = new Date().toLocaleDateString()
  const cover = `
    <div class="page cover">
      <h1>${esc(projectName)}</h1>
      <div class="sub">${input.frames.length} frames · ${esc(dateStr)}</div>
      <div class="credit">Storyboard Reference Studio</div>
    </div>`

  const cells = input.frames.map((f, i) => {
    const shot = f.shot ?? emptyShotMeta()
    const scene = metaLine([shot.sceneNo && `Sc ${shot.sceneNo}`, shot.shotNo && `Sh ${shot.shotNo}`])
    const tech = metaLine([shot.shotSize, shot.cameraAngle, shot.lens, shot.movement, `${(f.durationS ?? 2).toFixed(2)}s`])
    const trans = shot.transition ? `→ ${esc(shot.transition)}` : ''
    return `
      <div class="cell">
        <div class="pic"><img src="${stills[i]}" /></div>
        <div class="cap">
          <div class="cellhead"><span class="idx">${String(i + 1).padStart(2, '0')}</span><span class="label">${esc(f.label || '(untitled)')}</span></div>
          ${scene ? `<div class="meta">${esc(scene)}</div>` : ''}
          ${tech ? `<div class="meta">${esc(tech)}</div>` : ''}
          ${f.notes ? `<div class="notes">${esc(f.notes)}</div>` : ''}
          ${trans ? `<div class="meta">${trans}</div>` : ''}
        </div>
      </div>`
  })

  const pages: string[] = [cover]
  for (let i = 0; i < cells.length; i += 6) {
    pages.push(`<div class="page"><div class="grid">${cells.slice(i, i + 6).join('')}</div></div>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLES}</style></head><body>${pages.join('')}</body></html>`
}

/** Render the board to a PDF at exports/storyboard-<stamp>.pdf. */
export async function exportPdf(input: ExportInput): Promise<PdfOutput> {
  const st = exportStamp()
  await mkdir(input.exportsRoot, { recursive: true })
  const pdfPath = join(input.exportsRoot, `storyboard-${st}.pdf`)
  const workDir = join(input.exportsRoot, `.pdf-${st}`)

  let win: BrowserWindow | null = null
  try {
    // Render each frame to a cropped + annotated display still, embed as data URL.
    const stills: string[] = []
    for (let i = 0; i < input.frames.length; i++) {
      const disp = await renderDisplayStill(input.frames[i]!, workDir, i)
      stills.push(await dataUrl(disp))
    }

    const html = buildHtml(input.projectName || 'Storyboard', stills, input)
    win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 850,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false }
    })
    // Load from a temp file, NOT a data: URL — with real boards the embedded
    // stills push the URL past Chromium's ~2MB cap and the load fails with
    // ERR_INVALID_URL.
    const htmlPath = join(workDir, 'print.html')
    await writeFile(htmlPath, html, 'utf-8')
    await win.loadFile(htmlPath)
    const pdf = await win.webContents.printToPDF({
      landscape: true,
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    await writeFile(pdfPath, pdf)
    return { ok: true, pdfPath }
  } catch (e) {
    return { ok: false, error: (e as Error).message, pdfPath }
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

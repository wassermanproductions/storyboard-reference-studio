/**
 * Pure renderer for frame annotations → an SVG string. Shared by the renderer
 * (drawn as an overlay on the stage + board cards) and the main process (used
 * to composite annotations onto exported stills). No DOM / Node imports.
 *
 * Coordinates are normalized 0..1 in source-image space; the SVG is emitted in
 * a `0 0 w h` viewBox so it scales identically whether shown small on a card or
 * rasterized at full resolution for export.
 */

import type { Annotation, Frame } from './types'

/** Palette offered in the Annotate toolbar. */
export const ANNOTATION_COLORS = ['#ff5533', '#ffd400', '#38e07a', '#4aa8ff']

/** Escape text for inclusion in SVG markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Stable id fragment for a color (used for per-color arrowhead markers). */
function colorKey(color: string): string {
  return color.replace(/[^a-z0-9]/gi, '')
}

/**
 * Build an SVG string (viewBox 0 0 w h) rendering a frame's annotations.
 * Returns '' when there are no annotations. `w`/`h` are the coordinate space
 * (typically the source still dimensions).
 */
export function renderAnnotationsSvg(frame: Frame, w: number, h: number): string {
  const annos = frame.annotations ?? []
  if (annos.length === 0 || w <= 0 || h <= 0) return ''

  const base = Math.min(w, h)
  const stroke = Math.max(2, Math.round(base * 0.008))
  const fontSize = Math.max(12, Math.round(base * 0.05))

  const colors = Array.from(new Set(annos.filter((a) => a.kind === 'arrow').map((a) => a.color)))
  const markers = colors
    .map((c) => {
      const id = `sbr-arrow-${colorKey(c)}`
      return `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${esc(c)}"/></marker>`
    })
    .join('')

  const body = annos.map((a) => renderOne(a, w, h, stroke, fontSize)).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">` +
    `<defs>${markers}<filter id="sbr-anno-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${Math.round(stroke * 0.6)}" stdDeviation="${Math.round(stroke * 0.6)}" flood-color="#000" flood-opacity="0.55"/></filter></defs>` +
    body +
    `</svg>`
  )
}

function renderOne(a: Annotation, w: number, h: number, stroke: number, fontSize: number): string {
  if (a.kind === 'arrow') {
    const tail = a.points[0]
    const head = a.points[1] ?? a.points[0]
    if (!tail || !head) return ''
    const x1 = tail.x * w
    const y1 = tail.y * h
    const x2 = head.x * w
    const y2 = head.y * h
    const id = `sbr-arrow-${colorKey(a.color)}`
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${esc(a.color)}" stroke-width="${stroke}" stroke-linecap="round" marker-end="url(#${id})" filter="url(#sbr-anno-shadow)"/>`
  }
  // text
  const p = a.points[0]
  if (!p) return ''
  const x = p.x * w
  const y = p.y * h
  const text = esc((a.text ?? '').toUpperCase())
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="${esc(a.color)}" font-size="${fontSize}" font-weight="800" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" letter-spacing="0.04em" dominant-baseline="middle" filter="url(#sbr-anno-shadow)">${text}</text>`
}

/** A short hash of a frame's annotations (for export caching keys). */
export function annotationsHash(frame: Frame): string {
  const annos = frame.annotations ?? []
  if (annos.length === 0) return 'none'
  const json = JSON.stringify(
    annos.map((a) => [a.kind, a.color, a.text ?? '', a.points.map((p) => [Math.round(p.x * 1e4), Math.round(p.y * 1e4)])])
  )
  let hash = 0
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 31 + json.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

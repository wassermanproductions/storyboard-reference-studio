/**
 * Center-stage view of the selected board frame: its full-res still with the
 * crop overlay (generalized CropEditor), rule-of-thirds / action-safe guides,
 * an annotation layer (draw arrows + text), and a "back to clip" affordance.
 *
 * The annotation tool + color + guides toggle live in the store (ephemeral view
 * state); the Inspector's Annotate section drives them, the stage renders them.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useAbsUrl } from '../lib/useMediaUrl'
import { ensureStill } from '../lib/frameOps'
import { CropEditor } from './CropEditor'
import { renderAnnotationsSvg } from '@shared/annotations'
import type { Frame } from '@shared/types'

function useContentRect(
  boxRef: React.RefObject<HTMLDivElement>,
  imgW: number,
  imgH: number
): () => { left: number; top: number; w: number; h: number } {
  return useCallback(() => {
    const el = boxRef.current
    if (!el || !imgW || !imgH) return { left: 0, top: 0, w: 1, h: 1 }
    const bw = el.clientWidth
    const bh = el.clientHeight
    const scale = Math.min(bw / imgW, bh / imgH)
    const w = imgW * scale
    const h = imgH * scale
    return { left: (bw - w) / 2, top: (bh - h) / 2, w, h }
  }, [boxRef, imgW, imgH])
}

export function FrameStage({ frame }: { frame: Frame }): JSX.Element {
  const still = useStore((s) => s.stills[frame.id])
  const folder = useStore((s) => s.projectFolder)
  const media = useStore((s) => s.media(frame.mediaId))
  const annotTool = useStore((s) => s.annotTool)
  const annotColor = useStore((s) => s.annotColor)
  const guidesOn = useStore((s) => s.guidesOn)
  const setGuidesOn = useStore((s) => s.setGuidesOn)
  const selectedAnnotationId = useStore((s) => s.selectedAnnotationId)
  const selectAnnotation = useStore((s) => s.selectAnnotation)
  const setViewMode = useStore((s) => s.setViewMode)
  const addAnnotation = useStore((s) => s.addAnnotation)
  const updateAnnotation = useStore((s) => s.updateAnnotation)
  const setAnnotTool = useStore((s) => s.setAnnotTool)

  const stillUrl = useAbsUrl(still?.path ?? null)
  const boxRef = useRef<HTMLDivElement>(null)
  const contentRect = useContentRect(boxRef, still?.width ?? 16, still?.height ?? 9)
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    if (!still) void ensureStill(frame.id)
  }, [frame.id, still])

  const save = useCallback(() => {
    const json = currentProjectJson()
    if (json && folder) void window.sbr.saveProject(folder, json)
  }, [folder])

  const toNorm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = boxRef.current
      const r = contentRect()
      if (!el) return { x: 0, y: 0 }
      const box = el.getBoundingClientRect()
      const px = clientX - box.left - r.left
      const py = clientY - box.top - r.top
      return {
        x: Math.max(0, Math.min(1, px / r.w)),
        y: Math.max(0, Math.min(1, py / r.h))
      }
    },
    [contentRect]
  )

  const onDrawDown = useCallback(
    (e: React.MouseEvent) => {
      if (annotTool === 'none') return
      e.preventDefault()
      e.stopPropagation()
      const p = toNorm(e.clientX, e.clientY)
      if (annotTool === 'text') {
        const created = addAnnotation(frame.id, { kind: 'text', points: [p], text: '', color: annotColor })
        save()
        setEditing(created.id)
        selectAnnotation(created.id)
        setAnnotTool('none')
        return
      }
      // arrow: drag tail → head
      setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
      const onMove = (ev: MouseEvent): void => {
        const q = toNorm(ev.clientX, ev.clientY)
        setDrag((d) => (d ? { ...d, x2: q.x, y2: q.y } : d))
      }
      const onUp = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const q = toNorm(ev.clientX, ev.clientY)
        const dist = Math.hypot(q.x - p.x, q.y - p.y)
        setDrag(null)
        if (dist < 0.01) return
        addAnnotation(frame.id, {
          kind: 'arrow',
          points: [p, q],
          color: annotColor
        })
        save()
        setAnnotTool('none')
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [annotTool, annotColor, frame.id, toNorm, addAnnotation, save, selectAnnotation, setAnnotTool]
  )

  const rect = contentRect()
  const overlayStyle = { left: rect.left, top: rect.top, width: rect.w, height: rect.h }
  const svg = renderAnnotationsSvg(frame, still?.width ?? 16, still?.height ?? 9)

  const editingAnno = editing ? frame.annotations.find((a) => a.id === editing) : null

  return (
    <div className="viewer">
      <div className="viewer-stage frame-stage" ref={boxRef}>
        {stillUrl ? <img src={stillUrl} alt={frame.label} /> : <div className="viewer-empty">Extracting still…</div>}

        {/* Annotation display layer (behind the draw-capture layer). */}
        {svg && (
          <div
            className="anno-layer"
            style={overlayStyle}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}

        {/* Live arrow preview while dragging. */}
        {drag && (
          <svg className="anno-preview" style={overlayStyle} viewBox="0 0 100 100" preserveAspectRatio="none">
            <line
              x1={drag.x1 * 100}
              y1={drag.y1 * 100}
              x2={drag.x2 * 100}
              y2={drag.y2 * 100}
              stroke={annotColor}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {/* Crop overlay (draggable) when a crop is set. */}
        {still && stillUrl && frame.crop && (
          <CropEditor frameId={frame.id} crop={frame.crop} imgW={still.width} imgH={still.height} guides={guidesOn} />
        )}

        {/* Draw-capture layer, only active while a tool is selected. */}
        {annotTool !== 'none' && (
          <div className="anno-capture" style={overlayStyle} onMouseDown={onDrawDown} />
        )}

        {/* Inline text editor for a freshly-placed / selected text annotation. */}
        {editingAnno && editingAnno.kind === 'text' && (
          <input
            className="anno-text-input"
            autoFocus
            style={{
              left: rect.left + (editingAnno.points[0]?.x ?? 0) * rect.w,
              top: rect.top + (editingAnno.points[0]?.y ?? 0) * rect.h - 14
            }}
            defaultValue={editingAnno.text ?? ''}
            onChange={(e) => updateAnnotation(frame.id, editingAnno.id, { text: e.target.value })}
            onBlur={() => {
              const a = useStore.getState().frame(frame.id)?.annotations.find((x) => x.id === editingAnno.id)
              if (a && !(a.text ?? '').trim()) useStore.getState().removeAnnotation(frame.id, editingAnno.id)
              setEditing(null)
              save()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        )}

        {/* Click-to-select existing annotations (for delete) when idle. */}
        {annotTool === 'none' &&
          frame.annotations.map((a) => {
            const p = a.points[0]
            if (!p) return null
            return (
              <button
                key={a.id}
                className={`anno-hit ${selectedAnnotationId === a.id ? 'sel' : ''}`}
                style={{ left: rect.left + p.x * rect.w - 9, top: rect.top + p.y * rect.h - 9 }}
                title={a.kind === 'text' ? 'Text annotation' : 'Arrow annotation'}
                onClick={() => selectAnnotation(a.id)}
                onDoubleClick={() => {
                  if (a.kind === 'text') setEditing(a.id)
                }}
              />
            )
          })}
      </div>

      <div className="transport">
        <span className="time">{media?.name ?? 'frame'}</span>
        <div style={{ flex: 1 }} />
        {frame.crop && (
          <button
            className={`btn small ${guidesOn ? 'primary' : ''}`}
            onClick={() => setGuidesOn(!guidesOn)}
            title="Toggle rule-of-thirds + action-safe guides (G)"
          >
            ⊞ Guides
          </button>
        )}
        <button className="btn small" onClick={() => setViewMode('clip')} title="Back to the clip">
          ↩ Back to clip
        </button>
      </div>
    </div>
  )
}

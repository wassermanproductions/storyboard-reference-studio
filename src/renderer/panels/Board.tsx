/**
 * Bottom board: horizontal strip of frame cards in order. Drag to reorder,
 * click to select, ⌫ to remove (confirm if it has a prompt). "Prompt all
 * missing" and "Export board" with running counts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useAbsUrl } from '../lib/useMediaUrl'
import { ensureStill, generatePrompt, buildExportInputs, audioAbsPath } from '../lib/frameOps'
import { renderAnnotationsSvg } from '@shared/annotations'
import type { Frame } from '@shared/types'

function BoardCard({ frame, index }: { frame: Frame; index: number }): JSX.Element {
  const active = useStore((s) => s.selectedFrameId === frame.id)
  const still = useStore((s) => s.stills[frame.id])
  const selectFrame = useStore((s) => s.selectFrame)
  const removeFrame = useStore((s) => s.removeFrame)
  const reorderFrame = useStore((s) => s.reorderFrame)
  const folder = useStore((s) => s.projectFolder)
  const [dragOver, setDragOver] = useState(false)
  const url = useAbsUrl(still?.path ?? null)

  const onRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (frame.prompt && frame.prompt.text) {
        if (!window.confirm('This frame has a prompt. Remove it from the board?')) return
      }
      removeFrame(frame.id)
      const json = currentProjectJson()
      if (json && folder) void window.sbr.saveProject(folder, json)
    },
    [frame, removeFrame, folder]
  )

  return (
    <div
      className={`board-card ${active ? 'active' : ''} ${dragOver ? 'drag-over' : ''}`}
      draggable
      onClick={() => selectFrame(frame.id)}
      onDragStart={(e) => e.dataTransfer.setData('text/frame-id', frame.id)}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const id = e.dataTransfer.getData('text/frame-id')
        if (id && id !== frame.id) {
          reorderFrame(id, index)
          const json = currentProjectJson()
          if (json && folder) void window.sbr.saveProject(folder, json)
        }
      }}
    >
      <button className="board-card-del" onClick={onRemove} title="Remove (⌫)">✕</button>
      <div className="board-card-thumb-wrap">
        {url ? <img className="board-card-thumb" src={url} alt={frame.label} /> : <div className="board-card-thumb" />}
        {frame.annotations.length > 0 && still && (
          <div
            className="board-card-anno"
            dangerouslySetInnerHTML={{ __html: renderAnnotationsSvg(frame, still.width, still.height) }}
          />
        )}
        <span className="board-card-dur">{frame.durationS.toFixed(1)}s</span>
      </div>
      <div className="board-card-body">
        <div className="board-card-label" title={frame.label}>{frame.label || '(untitled)'}</div>
        <div className="board-card-meta">
          <span className="board-index">{String(index + 1).padStart(2, '0')}</span>
          <span className={`dot ${frame.prompt?.text ? 'has-prompt' : ''}`} title={frame.prompt?.text ? 'Has prompt' : 'No prompt'} />
        </div>
      </div>
    </div>
  )
}

export function Board(): JSX.Element {
  // Select the raw array (stable ref) and sort in a memo — returning a fresh
  // array from the selector would loop React (new ref every render).
  const rawFrames = useStore((s) => s.doc?.frames)
  const frames = useMemo(() => [...(rawFrames ?? [])].sort((a, b) => a.order - b.order), [rawFrames])
  const folder = useStore((s) => s.projectFolder)
  const projectName = useStore((s) => s.doc?.name ?? 'Storyboard')
  const defaultProfile = useStore((s) => s.doc?.settings.defaultProfileId ?? 'midjourney')
  const promptingAll = useStore((s) => s.promptingAll)
  const setPromptingAll = useStore((s) => s.setPromptingAll)
  const setPresentOpen = useStore((s) => s.setPresentOpen)
  const toast = useStore((s) => s.toast)
  const [exporting, setExporting] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportMenu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setExportMenu(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [exportMenu])

  const withPrompt = frames.filter((f) => f.prompt?.text).length
  const missing = frames.length - withPrompt

  const onPromptAll = useCallback(async () => {
    setPromptingAll(true)
    let done = 0
    let failed = 0
    for (const f of frames) {
      if (f.prompt?.text) continue
      const res = await generatePrompt(f.id, f.prompt?.profileId ?? defaultProfile, f.notes)
      if (res.ok) done++
      else {
        failed++
        toast(res.error ?? 'Prompt failed', 'error')
        break // stop on first hard failure (usually auth) to avoid a wall of toasts
      }
    }
    setPromptingAll(false)
    const json = currentProjectJson()
    if (json && folder) await window.sbr.saveProject(folder, json)
    if (done) toast(`Generated ${done} prompt${done > 1 ? 's' : ''}.`, 'success')
    if (!done && !failed) toast('All frames already have prompts.', 'info')
  }, [frames, defaultProfile, folder, setPromptingAll, toast])

  const runExport = useCallback(
    async (kind: 'board' | 'animatic' | 'pdf' | 'shotlist') => {
      if (!folder || frames.length === 0) return
      setExportMenu(false)
      setExporting(true)
      try {
        for (const f of frames) await ensureStill(f.id)
        const inputs = await buildExportInputs()
        const exportsRoot = `${folder}${folder.includes('\\') ? '\\' : '/'}exports`
        const payload = { projectName, exportsRoot, frames: inputs }
        if (kind === 'board') {
          const res = await window.sbr.exportBoard(payload)
          toast(res.ok ? 'Board exported — revealed in Finder.' : `Export failed: ${res.error ?? ''}`, res.ok ? 'success' : 'error')
        } else if (kind === 'animatic') {
          const res = await window.sbr.exportAnimatic(payload, { burnLabel: true, audioPath: audioAbsPath() })
          toast(res.ok ? 'Animatic exported — revealed in Finder.' : `Animatic failed: ${res.error ?? ''}`, res.ok ? 'success' : 'error')
        } else if (kind === 'pdf') {
          const res = await window.sbr.exportPdf(payload)
          toast(res.ok ? 'PDF exported — revealed in Finder.' : `PDF failed: ${res.error ?? ''}`, res.ok ? 'success' : 'error')
        } else {
          const res = await window.sbr.exportShotlist(payload)
          toast(res.ok ? 'Shot list exported — revealed in Finder.' : `Shot list failed: ${res.error ?? ''}`, res.ok ? 'success' : 'error')
        }
      } finally {
        setExporting(false)
      }
    },
    [folder, frames, projectName, toast]
  )

  const onExport = useCallback(() => runExport('board'), [runExport])

  return (
    <div className="board">
      <div className="board-bar">
        <span className="panel-title" style={{ margin: 0 }}>Board</span>
        <span className="board-count">{frames.length} frames · {withPrompt} prompted · {missing} missing</span>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={() => setPresentOpen(true)} disabled={frames.length === 0} title="Present / play the board (P)">
          ▶ Present
        </button>
        <button className="btn small" onClick={onPromptAll} disabled={promptingAll || missing === 0}>
          {promptingAll ? 'Prompting…' : 'Prompt all missing'}
        </button>
        <button className="btn small primary" onClick={onExport} disabled={exporting || frames.length === 0}>
          {exporting ? 'Exporting…' : 'Export board'}
        </button>
        <div className="export-menu-wrap" ref={menuRef}>
          <button className="btn small" onClick={() => setExportMenu((v) => !v)} disabled={exporting || frames.length === 0} title="More export formats">
            Export ▾
          </button>
          {exportMenu && (
            <div className="export-menu">
              <button onClick={() => runExport('board')}>Board package</button>
              <button onClick={() => runExport('animatic')}>Animatic (MP4)</button>
              <button onClick={() => runExport('pdf')}>PDF storyboard</button>
              <button onClick={() => runExport('shotlist')}>Shot list (CSV)</button>
            </div>
          )}
        </div>
      </div>
      <div className="board-strip">
        {frames.length === 0 ? (
          <div className="board-empty">
            Bookmark frames from a clip, add images, or Auto-board a section — they land here as cards.
          </div>
        ) : (
          frames.map((f, i) => <BoardCard key={f.id} frame={f} index={i} />)
        )}
      </div>
    </div>
  )
}

/**
 * Bottom board: horizontal strip of frame cards in order. Drag to reorder,
 * click to select, ⌫ to remove (confirm if it has a prompt). "Prompt all
 * missing" and "Export board" with running counts.
 */

import { useCallback, useMemo, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useAbsUrl } from '../lib/useMediaUrl'
import { ensureStill, generatePrompt, buildExportInputs } from '../lib/frameOps'
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
      {url ? <img className="board-card-thumb" src={url} alt={frame.label} /> : <div className="board-card-thumb" />}
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
  const toast = useStore((s) => s.toast)
  const [exporting, setExporting] = useState(false)

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

  const onExport = useCallback(async () => {
    if (!folder || frames.length === 0) return
    setExporting(true)
    try {
      // Make sure every frame has a still on disk before exporting.
      for (const f of frames) await ensureStill(f.id)
      const inputs = await buildExportInputs()
      const exportsRoot = `${folder}${folder.includes('\\') ? '\\' : '/'}exports`
      const res = await window.sbr.exportBoard({ projectName, exportsRoot, frames: inputs })
      if (res.ok) toast('Board exported — revealed in Finder.', 'success')
      else toast(`Export failed: ${res.error ?? ''}`, 'error')
    } finally {
      setExporting(false)
    }
  }, [folder, frames, projectName, toast])

  return (
    <div className="board">
      <div className="board-bar">
        <span className="panel-title" style={{ margin: 0 }}>Board</span>
        <span className="board-count">{frames.length} frames · {withPrompt} prompted · {missing} missing</span>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={onPromptAll} disabled={promptingAll || missing === 0}>
          {promptingAll ? 'Prompting…' : 'Prompt all missing'}
        </button>
        <button className="btn small primary" onClick={onExport} disabled={exporting || frames.length === 0}>
          {exporting ? 'Exporting…' : 'Export board'}
        </button>
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

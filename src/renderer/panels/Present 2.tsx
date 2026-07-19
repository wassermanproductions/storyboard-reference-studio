/**
 * Present / Play mode: a fullscreen dark overlay that plays the board in order,
 * holding each frame for its durationS. Space toggles play/pause, arrows step,
 * M toggles the metadata strip, Esc exits. A scratch track (if set) plays in
 * sync, re-seeking to the cumulative offset whenever the frame jumps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useAbsUrl } from '../lib/useMediaUrl'
import { ensureStill, audioAbsPath } from '../lib/frameOps'

function metaStrip(frame: { shot: { sceneNo: string; shotNo: string; shotSize: string; cameraAngle: string; lens: string; movement: string; transition: string } }): string {
  const s = frame.shot
  return [
    s.sceneNo && `Sc ${s.sceneNo}`,
    s.shotNo && `Sh ${s.shotNo}`,
    s.shotSize,
    s.cameraAngle,
    s.lens,
    s.movement,
    s.transition && `→ ${s.transition}`
  ]
    .filter(Boolean)
    .join('  ·  ')
}

export function Present(): JSX.Element | null {
  const open = useStore((s) => s.presentOpen)
  const setPresentOpen = useStore((s) => s.setPresentOpen)
  const rawFrames = useStore((s) => s.doc?.frames)
  const folder = useStore((s) => s.projectFolder)
  const audioFile = useStore((s) => s.doc?.settings.audioFile ?? null)
  const stills = useStore((s) => s.stills)

  const frames = useMemo(() => [...(rawFrames ?? [])].sort((a, b) => a.order - b.order), [rawFrames])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [showMeta, setShowMeta] = useState(true)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const current = frames[index]
  const still = current ? stills[current.id] : undefined
  const url = useAbsUrl(still?.path ?? null)

  // Cumulative time offset (seconds) of the current frame's start.
  const offsetFor = useCallback(
    (i: number) => frames.slice(0, i).reduce((sum, f) => sum + f.durationS, 0),
    [frames]
  )

  // On open, reset and make sure every frame has a still on disk.
  useEffect(() => {
    if (!open) return
    setIndex(0)
    setPlaying(true)
    setShowMeta(true)
    void (async () => {
      for (const f of frames) await ensureStill(f.id)
    })()
    // Intentionally keyed on `open` only: reset once per present-mode open.
  }, [open])

  // Load the scratch-track audio as a blob URL.
  useEffect(() => {
    if (!open || !audioFile || !folder) {
      setAudioUrl(null)
      return
    }
    let alive = true
    const abs = audioAbsPath()
    if (!abs) return
    const rel = abs.startsWith(folder) ? abs.slice(folder.length).replace(/^[/\\]/, '') : abs
    void window.sbr
      .readProjectFile(folder, rel)
      .then((buf) => {
        if (alive) setAudioUrl(URL.createObjectURL(new Blob([buf])))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, audioFile, folder])

  // Auto-advance while playing.
  useEffect(() => {
    if (!open || !playing || !current) return
    const ms = Math.max(250, current.durationS * 1000)
    const t = setTimeout(() => {
      setIndex((i) => {
        if (i + 1 >= frames.length) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, ms)
    return () => clearTimeout(t)
  }, [open, playing, index, current, frames.length])

  // Keep the scratch track in sync with the current frame + play state.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = offsetFor(index)
    if (playing) void a.play().catch(() => {})
    else a.pause()
  }, [index, playing, offsetFor, audioUrl])

  const step = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(frames.length - 1, i + delta)))
    },
    [frames.length]
  )

  // Present-mode keyboard, captured so the global map doesn't also fire.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPresentOpen(false)
      } else if (e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        setPlaying(false)
        step(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        setPlaying(false)
        step(1)
      } else if (e.key === 'm' || e.key === 'M') {
        e.stopPropagation()
        setShowMeta((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, step, setPresentOpen])

  if (!open) return null

  return (
    <div className="present-overlay">
      {audioUrl && <audio ref={audioRef} src={audioUrl} />}
      <div className="present-stage">
        {url ? <img src={url} alt={current?.label ?? ''} /> : <div className="present-loading">Loading…</div>}
      </div>

      {showMeta && current && (
        <div className="present-meta">
          <div className="present-label">{current.label || '(untitled)'}</div>
          <div className="present-shot">{metaStrip(current)}</div>
        </div>
      )}

      <div className="present-bar">
        <button className="btn small" onClick={() => { setPlaying(false); step(-1) }} title="Previous (←)">◀</button>
        <button className="btn small primary" onClick={() => setPlaying((p) => !p)} title="Play / pause (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="btn small" onClick={() => { setPlaying(false); step(1) }} title="Next (→)">▶</button>
        <span className="present-count">{frames.length ? index + 1 : 0} / {frames.length}</span>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={() => setShowMeta((v) => !v)} title="Toggle metadata (M)">Meta</button>
        <button className="btn small" onClick={() => setPresentOpen(false)} title="Exit (Esc)">✕ Exit</button>
      </div>
    </div>
  )
}

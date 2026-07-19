/**
 * Left rail: the media bin. Import (file dialog) + Paste (clipboard PNG),
 * thumbnails, click to open in the viewer.
 */

import { useCallback, useEffect, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useMediaUrl } from '../lib/useMediaUrl'
import type { MediaItem } from '@shared/types'

const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac']

function isAudioPath(p: string): boolean {
  const ext = p.toLowerCase().split('.').pop() ?? ''
  return AUDIO_EXTS.includes(ext)
}

function BinItem({ item }: { item: MediaItem }): JSX.Element {
  const url = useMediaUrl(item)
  const active = useStore((s) => s.selectedMediaId === item.id)
  const selectMedia = useStore((s) => s.selectMedia)
  const dims = item.width && item.height ? `${item.width}×${item.height}` : '—'
  const dur = item.durationS ? ` · ${item.durationS.toFixed(1)}s` : ''
  return (
    <div className={`bin-item ${active ? 'active' : ''}`} onClick={() => selectMedia(item.id)}>
      {item.kind === 'video' ? (
        url ? <video className="bin-thumb" src={url} muted preload="metadata" /> : <div className="bin-thumb" />
      ) : url ? (
        <img className="bin-thumb" src={url} alt={item.name} />
      ) : (
        <div className="bin-thumb" />
      )}
      <div className="bin-meta">
        <div className="bin-name" title={item.name}>{item.name}</div>
        <div className="bin-sub">{dims}{dur}</div>
        <div className="bin-kind">{item.kind.toUpperCase()}</div>
      </div>
    </div>
  )
}

export function MediaBin(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const folder = useStore((s) => s.projectFolder)
  const addMedia = useStore((s) => s.addMedia)
  const setAudioFile = useStore((s) => s.setAudioFile)
  const audioFile = useStore((s) => s.doc?.settings.audioFile ?? null)
  const toast = useStore((s) => s.toast)

  // Remember the scratch track so the bin row can toggle it on/off without
  // losing the copied file (audioFile is the *active* animatic track).
  const [scratch, setScratch] = useState<{ sourceFile: string; name: string } | null>(null)
  useEffect(() => {
    if (audioFile) {
      setScratch((prev) =>
        prev && prev.sourceFile === audioFile ? prev : { sourceFile: audioFile, name: audioFile.split(/[/\\]/).pop() ?? audioFile }
      )
    }
  }, [audioFile])

  const onImport = useCallback(async () => {
    if (!folder) return
    const paths = await window.sbr.importMediaDialog()
    if (!paths.length) return
    let audioCount = 0
    let mediaCount = 0
    for (const p of paths) {
      try {
        if (isAudioPath(p)) {
          const a = await window.sbr.importAudio(folder, p)
          setScratch(a)
          setAudioFile(a.sourceFile)
          audioCount++
        } else {
          const imported = await window.sbr.importMedia(folder, p)
          addMedia(imported)
          mediaCount++
        }
      } catch (e) {
        toast(`Import failed: ${(e as Error).message}`, 'error')
      }
    }
    const json = currentProjectJson()
    if (json) await window.sbr.saveProject(folder, json)
    if (mediaCount) toast(`Imported ${mediaCount} file${mediaCount > 1 ? 's' : ''}.`, 'success')
    if (audioCount) toast('Added scratch track.', 'success')
  }, [folder, addMedia, setAudioFile, toast])

  const toggleScratch = useCallback(() => {
    if (!scratch) return
    setAudioFile(audioFile === scratch.sourceFile ? null : scratch.sourceFile)
    const json = currentProjectJson()
    if (json && folder) void window.sbr.saveProject(folder, json)
  }, [scratch, audioFile, setAudioFile, folder])

  const onPaste = useCallback(async () => {
    if (!folder) return
    try {
      const items = await navigator.clipboard.read()
      let n = 0
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'))
        if (!type) continue
        const blob = await it.getType(type)
        const buf = await blob.arrayBuffer()
        const imported = await window.sbr.pasteImage(folder, buf, ++n)
        addMedia(imported)
      }
      if (n === 0) {
        toast('No image found on the clipboard.', 'error')
        return
      }
      const json = currentProjectJson()
      if (json) await window.sbr.saveProject(folder, json)
      toast(`Pasted ${n} image${n > 1 ? 's' : ''}.`, 'success')
    } catch (e) {
      toast(`Paste failed: ${(e as Error).message}`, 'error')
    }
  }, [folder, addMedia, toast])

  return (
    <div className="bin panel">
      <div className="bin-actions">
        <button className="btn small" onClick={onImport}>＋ Import</button>
        <button className="btn small" onClick={onPaste}>⧉ Paste</button>
      </div>
      <div className="bin-list">
        {(doc?.media.length ?? 0) === 0 ? (
          <div className="hint" style={{ padding: 8 }}>
            Import videos, images, or an audio scratch track — or paste a screenshot — to start.
          </div>
        ) : (
          doc!.media.map((m) => <BinItem key={m.id} item={m} />)
        )}
        {scratch && (
          <div
            className={`bin-item scratch ${audioFile === scratch.sourceFile ? 'active' : ''}`}
            onClick={toggleScratch}
            title="Click to set / unset as the animatic scratch track"
          >
            <div className="bin-thumb scratch-thumb">♪</div>
            <div className="bin-meta">
              <div className="bin-name" title={scratch.name}>{scratch.name}</div>
              <div className="bin-sub">{audioFile === scratch.sourceFile ? 'scratch track' : 'audio (off)'}</div>
              <div className="bin-kind">AUDIO</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

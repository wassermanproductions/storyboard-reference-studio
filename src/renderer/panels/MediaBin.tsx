/**
 * Left rail: the media bin. Import (file dialog) + Paste (clipboard PNG),
 * thumbnails, click to open in the viewer.
 */

import { useCallback } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useMediaUrl } from '../lib/useMediaUrl'
import type { MediaItem } from '@shared/types'

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
  const toast = useStore((s) => s.toast)

  const onImport = useCallback(async () => {
    if (!folder) return
    const paths = await window.sbr.importMediaDialog()
    if (!paths.length) return
    for (const p of paths) {
      try {
        const imported = await window.sbr.importMedia(folder, p)
        addMedia(imported)
      } catch (e) {
        toast(`Import failed: ${(e as Error).message}`, 'error')
      }
    }
    const json = currentProjectJson()
    if (json) await window.sbr.saveProject(folder, json)
    toast(`Imported ${paths.length} file${paths.length > 1 ? 's' : ''}.`, 'success')
  }, [folder, addMedia, toast])

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
            Import videos or images, or paste a screenshot, to start pulling reference frames.
          </div>
        ) : (
          doc!.media.map((m) => <BinItem key={m.id} item={m} />)
        )}
      </div>
    </div>
  )
}

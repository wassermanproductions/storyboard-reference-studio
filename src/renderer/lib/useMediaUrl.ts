import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { projectFileUrl, mimeForMedia } from './paths'
import type { MediaItem } from '@shared/types'

/** Resolve a project media item to a blob URL for <img>/<video>. */
export function useMediaUrl(media: MediaItem | null): string | null {
  const folder = useStore((s) => s.projectFolder)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!media || !folder) {
      setUrl(null)
      return
    }
    void projectFileUrl(folder, media.sourceFile, mimeForMedia(media.name)).then((u) => {
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [media?.id, folder])
  return url
}

/** Resolve an absolute in-project PNG path (extracted still) to a blob URL. */
export function useAbsUrl(absPath: string | null): string | null {
  const folder = useStore((s) => s.projectFolder)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!absPath || !folder) {
      setUrl(null)
      return
    }
    const rel = absPath.startsWith(folder) ? absPath.slice(folder.length).replace(/^[/\\]/, '') : absPath
    void window.sbr
      .readProjectFile(folder, rel)
      .then((buf) => {
        if (!alive) return
        setUrl(URL.createObjectURL(new Blob([buf], { type: 'image/png' })))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [absPath, folder])
  return url
}

/**
 * Draggable crop overlay rendered over a frame's still. Maintains the target
 * aspect ratio while dragging corners; the whole rect can be moved. Crop is
 * stored normalized (0..1) in source coordinates.
 */

import { useCallback, useRef } from 'react'
import { useStore } from '../store'
import { aspectRatio } from '@shared/types'
import type { Crop } from '@shared/types'

export function CropEditor({ frameId, crop, imgW, imgH }: {
  frameId: string
  crop: Crop
  imgW: number
  imgH: number
}): JSX.Element {
  const setFrameCrop = useStore((s) => s.setFrameCrop)
  const boxRef = useRef<HTMLDivElement>(null)

  // The displayed image is letterboxed inside the box; compute the content rect.
  const contentRect = useCallback((): { left: number; top: number; w: number; h: number } => {
    const el = boxRef.current
    if (!el || !imgW || !imgH) return { left: 0, top: 0, w: 1, h: 1 }
    const bw = el.clientWidth
    const bh = el.clientHeight
    const scale = Math.min(bw / imgW, bh / imgH)
    const w = imgW * scale
    const h = imgH * scale
    return { left: (bw - w) / 2, top: (bh - h) / 2, w, h }
  }, [imgW, imgH])

  const ar = aspectRatio(crop.aspect)

  const clampAspect = useCallback(
    (c: Crop): Crop => {
      if (!ar) return c
      // Fit the requested aspect into the source; keep w, derive h (px) → norm.
      const targetHNorm = (c.w * imgW) / ar / imgH
      let h = targetHNorm
      let w = c.w
      if (h > 1) {
        h = 1
        w = (h * imgH * ar) / imgW
      }
      const x = Math.max(0, Math.min(c.x, 1 - w))
      const y = Math.max(0, Math.min(c.y, 1 - h))
      return { ...c, x, y, w, h }
    },
    [ar, imgW, imgH]
  )

  const startMove = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = contentRect()
      const startX = e.clientX
      const startY = e.clientY
      const start = { ...crop }
      const onMove = (ev: MouseEvent): void => {
        const dx = (ev.clientX - startX) / rect.w
        const dy = (ev.clientY - startY) / rect.h
        const x = Math.max(0, Math.min(1 - start.w, start.x + dx))
        const y = Math.max(0, Math.min(1 - start.h, start.y + dy))
        setFrameCrop(frameId, { ...start, x, y })
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [crop, frameId, setFrameCrop, contentRect]
  )

  const startResize = useCallback(
    (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = contentRect()
      const startX = e.clientX
      const startY = e.clientY
      const start = { ...crop }
      const anchorX = corner === 'nw' || corner === 'sw' ? start.x + start.w : start.x
      const anchorY = corner === 'nw' || corner === 'ne' ? start.y + start.h : start.y
      const onMove = (ev: MouseEvent): void => {
        const dx = (ev.clientX - startX) / rect.w
        const dy = (ev.clientY - startY) / rect.h
        let curX = corner === 'nw' || corner === 'sw' ? start.x + dx : start.x + start.w + dx
        let curY = corner === 'nw' || corner === 'ne' ? start.y + dy : start.y + start.h + dy
        curX = Math.max(0, Math.min(1, curX))
        curY = Math.max(0, Math.min(1, curY))
        const w = Math.max(0.05, Math.abs(anchorX - curX))
        const h = Math.max(0.05, Math.abs(anchorY - curY))
        const x = Math.min(anchorX, curX)
        const y = Math.min(anchorY, curY)
        let next: Crop = { ...start, x, y, w, h }
        if (ar) next = clampAspect({ ...next })
        setFrameCrop(frameId, next)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [crop, frameId, setFrameCrop, contentRect, ar, clampAspect]
  )

  // Position the rect in box pixels using the content rect.
  const rect = contentRect()
  const style = {
    left: rect.left + crop.x * rect.w,
    top: rect.top + crop.y * rect.h,
    width: crop.w * rect.w,
    height: crop.h * rect.h
  }

  return (
    <div className="crop-editor" ref={boxRef}>
      <div className="crop-rect" style={style} onMouseDown={startMove}>
        <div className="handle nw" onMouseDown={startResize('nw')} />
        <div className="handle ne" onMouseDown={startResize('ne')} />
        <div className="handle sw" onMouseDown={startResize('sw')} />
        <div className="handle se" onMouseDown={startResize('se')} />
      </div>
    </div>
  )
}

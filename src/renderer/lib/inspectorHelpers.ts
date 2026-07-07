import { aspectRatio, CROP_ASPECTS as ASPECTS } from '@shared/types'
import type { Crop, CropAspect } from '@shared/types'

export const CROP_ASPECTS = ASPECTS

/** Build a centered crop for an aspect fitted inside the source dimensions. */
export function fullCropSafe(aspect: CropAspect, imgW: number, imgH: number): Crop {
  const ar = aspectRatio(aspect)
  if (!ar || !imgW || !imgH) return { aspect, x: 0, y: 0, w: 1, h: 1 }
  const srcAr = imgW / imgH
  let w = 1
  let h = 1
  if (ar > srcAr) {
    // Wider than source → full width, shorter height.
    h = srcAr / ar
  } else {
    // Taller than source → full height, narrower width.
    w = ar / srcAr
  }
  return { aspect, x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

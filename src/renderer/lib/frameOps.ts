/**
 * Frame operations shared by the UI and the agent control handler: extract a
 * full-res still for a frame (cached), generate a prompt via Claude, and build
 * the export input. Keeping these here means the automation surface and the
 * buttons run the exact same code.
 */

import { useStore } from '../store'
import { getProfile } from '@shared/profiles'
import { renderAnnotationsSvg, annotationsHash } from '@shared/annotations'
import type { Frame } from '@shared/types'
import type { ExportFrameInput } from '../../preload/index'

/** Where extracted stills live: <project>/.frames/<frameId>.png (in-project so
 *  readProjectFile can serve them as blob URLs). */
function stillPathFor(folder: string, frameId: string): string {
  const sep = folder.includes('\\') ? '\\' : '/'
  return `${folder}${sep}.frames${sep}${frameId}.png`
}

/** Ensure a full-res still PNG exists on disk for a frame; return its abs path. */
export async function ensureStill(frameId: string): Promise<string | null> {
  const s = useStore.getState()
  const existing = s.stills[frameId]
  if (existing) return existing.path
  const frame = s.frame(frameId)
  if (!frame || !s.projectFolder) return null
  const media = s.media(frame.mediaId)
  if (!media) return null
  const abs = s.mediaAbsPath(frame.mediaId)
  if (!abs) return null

  const outPng = stillPathFor(s.projectFolder, frameId)
  await window.sbr.ensureDir(`${s.projectFolder}${s.projectFolder.includes('\\') ? '\\' : '/'}.frames`)

  if (media.kind === 'image') {
    // Images: the "extraction" is a copy at t=0 (ffmpeg re-encodes to PNG).
    const r = await window.sbr.extractFrame(abs, 0, outPng)
    if (!r.ok) return null
  } else {
    const r = await window.sbr.extractFrame(abs, frame.timeS, outPng)
    if (!r.ok) return null
  }
  useStore.getState().setStill(frameId, { path: outPng, width: media.width, height: media.height })
  return outPng
}

/** Generate a Claude prompt for a frame; returns ok/error. */
export async function generatePrompt(
  frameId: string,
  profileId: string,
  extraContext = ''
): Promise<{ ok: boolean; error?: string }> {
  const still = await ensureStill(frameId)
  if (!still) return { ok: false, error: 'Could not extract the frame image.' }
  const result = await window.sbr.describeFrame(still, profileId, extraContext)
  if (!result.ok) return { ok: false, error: result.error }
  useStore.getState().setFramePrompt(frameId, result.description.promptText, profileId, 'claude-opus-4-8')
  return { ok: true }
}

/** Load an image element from a src (blob/data URL). */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/**
 * If a frame has annotations, composite them onto its full-res still with a
 * canvas (renderer-side — no hidden windows) and write the result to
 * .frames/anno-<id>-<hash>.png, returning that path. Otherwise returns the
 * original still. The composite is cached by annotations hash.
 */
export async function compositeAnnotated(frame: Frame, stillPath: string, w: number, h: number): Promise<string> {
  if (!frame.annotations || frame.annotations.length === 0 || w <= 0 || h <= 0) return stillPath
  const svg = renderAnnotationsSvg(frame, w, h)
  if (!svg) return stillPath
  const s = useStore.getState()
  const folder = s.projectFolder
  if (!folder) return stillPath
  const sep = folder.includes('\\') ? '\\' : '/'
  const rel = `.frames${sep}anno-${frame.id}-${annotationsHash(frame)}.png`
  try {
    const stillRel = stillPath.startsWith(folder) ? stillPath.slice(folder.length).replace(/^[/\\]/, '') : stillPath
    const buf = await window.sbr.readProjectFile(folder, stillRel)
    const stillUrl = URL.createObjectURL(new Blob([buf], { type: 'image/png' }))
    const svgUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return stillPath
    ctx.drawImage(await loadImage(stillUrl), 0, 0, w, h)
    ctx.drawImage(await loadImage(svgUrl), 0, 0, w, h)
    URL.revokeObjectURL(stillUrl)
    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const ok = await window.sbr.writeProjectPng(folder, rel, base64)
    return ok ? `${folder}${sep}${rel}` : stillPath
  } catch {
    return stillPath
  }
}

/** Build the export inputs for the whole board (extracts any missing stills). */
export async function buildExportInputs(): Promise<ExportFrameInput[]> {
  const s = useStore.getState()
  const ordered = s.orderedFrames()
  const inputs: ExportFrameInput[] = []
  for (const frame of ordered) {
    const still = await ensureStill(frame.id)
    if (!still) continue
    const media = s.media(frame.mediaId)
    const source = await compositeAnnotated(frame, still, media?.width ?? 0, media?.height ?? 0)
    inputs.push({
      sourcePng: source,
      label: frame.label,
      notes: frame.notes,
      promptText: frame.prompt?.text ?? '',
      profileId: frame.prompt?.profileId ?? s.doc?.settings.defaultProfileId ?? 'midjourney',
      crop: frame.crop,
      sourceWidth: media?.width ?? 0,
      sourceHeight: media?.height ?? 0,
      timeS: frame.timeS,
      mediaName: media?.name ?? '',
      durationS: frame.durationS,
      shot: frame.shot,
      annotations: frame.annotations
    })
  }
  return inputs
}

/** Absolute path to the project's scratch-track audio, or null. */
export function audioAbsPath(): string | null {
  const s = useStore.getState()
  const rel = s.doc?.settings.audioFile
  if (!rel || !s.projectFolder) return null
  const sep = s.projectFolder.includes('\\') ? '\\' : '/'
  return `${s.projectFolder}${sep}${rel.replace(/[/\\]/g, sep)}`
}

/** Offline template prompt for a frame using its metadata + dropdown fields. */
export function templatePrompt(
  frame: Frame,
  profileId: string,
  fields: { shotSize: string; cameraAngle: string; lighting: string; mood: string }
): string {
  const profile = getProfile(profileId)
  return profile.formatPrompt({
    label: frame.label,
    notes: frame.notes,
    shotSize: fields.shotSize,
    cameraAngle: fields.cameraAngle,
    lighting: fields.lighting,
    mood: fields.mood,
    aspect: frame.crop?.aspect ?? null
  })
}

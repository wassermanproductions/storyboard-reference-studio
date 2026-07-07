/**
 * Frame operations shared by the UI and the agent control handler: extract a
 * full-res still for a frame (cached), generate a prompt via Claude, and build
 * the export input. Keeping these here means the automation surface and the
 * buttons run the exact same code.
 */

import { useStore } from '../store'
import { getProfile } from '@shared/profiles'
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

/** Build the export inputs for the whole board (extracts any missing stills). */
export async function buildExportInputs(): Promise<ExportFrameInput[]> {
  const s = useStore.getState()
  const ordered = s.orderedFrames()
  const inputs: ExportFrameInput[] = []
  for (const frame of ordered) {
    const still = await ensureStill(frame.id)
    if (!still) continue
    const media = s.media(frame.mediaId)
    inputs.push({
      sourcePng: still,
      label: frame.label,
      notes: frame.notes,
      promptText: frame.prompt?.text ?? '',
      profileId: frame.prompt?.profileId ?? s.doc?.settings.defaultProfileId ?? 'midjourney',
      crop: frame.crop,
      sourceWidth: media?.width ?? 0,
      sourceHeight: media?.height ?? 0,
      timeS: frame.timeS,
      mediaName: media?.name ?? ''
    })
  }
  return inputs
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

/**
 * Document factories and (de)serialization. Pure — shared by main + renderer.
 * parseProject never throws on malformed input; it returns { doc, issues }.
 */

import type { Project, MediaItem, Frame, MediaKind, Crop, ShotMeta, Annotation } from './types'
import { PROJECT_VERSION, DEFAULT_FRAME_DURATION_S, emptyShotMeta } from './types'
import { DEFAULT_PROFILE_ID } from './profiles'

/** Short, collision-resistant id (no external deps). */
export function newId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const time = Date.now().toString(36).slice(-6)
  return `${prefix}_${time}${rand}`
}

export function createProject(name: string): Project {
  return {
    version: PROJECT_VERSION,
    id: newId('proj'),
    name,
    media: [],
    frames: [],
    settings: { defaultProfileId: DEFAULT_PROFILE_ID, audioFile: null }
  }
}

export function createMediaItem(
  fields: Omit<MediaItem, 'id'> & { id?: string }
): MediaItem {
  return {
    id: fields.id ?? newId('media'),
    kind: fields.kind,
    sourceFile: fields.sourceFile,
    name: fields.name,
    durationS: fields.durationS,
    width: fields.width,
    height: fields.height,
    fps: fields.fps
  }
}

export function createFrame(
  mediaId: string,
  timeS: number,
  order: number,
  label = ''
): Frame {
  return {
    id: newId('frame'),
    mediaId,
    timeS,
    label,
    notes: '',
    order,
    crop: null,
    prompt: null,
    durationS: DEFAULT_FRAME_DURATION_S,
    shot: emptyShotMeta(),
    annotations: []
  }
}

export function fullCrop(aspect: Crop['aspect'] = null): Crop {
  return { aspect, x: 0, y: 0, w: 1, h: 1 }
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export interface ParseIssue {
  message: string
}

export interface ParseOutcome {
  doc: Project | null
  issues: ParseIssue[]
}

/** Best-effort validate + migrate. Never breaks on an existing file. */
export function parseProject(json: string): ParseOutcome {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    return { doc: null, issues: [{ message: `invalid JSON: ${(e as Error).message}` }] }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { doc: null, issues: [{ message: 'project is not an object' }] }
  }
  const o = raw as Record<string, unknown>
  const issues: ParseIssue[] = []

  const media: MediaItem[] = Array.isArray(o.media)
    ? (o.media as unknown[]).map((m) => sanitizeMedia(m, issues)).filter(Boolean as unknown as (x: MediaItem | null) => x is MediaItem)
    : []
  const frames: Frame[] = Array.isArray(o.frames)
    ? (o.frames as unknown[]).map((f) => sanitizeFrame(f, issues)).filter(Boolean as unknown as (x: Frame | null) => x is Frame)
    : []

  const settings = (o.settings as Record<string, unknown>) ?? {}
  // Migrate any older/newer document to the current version; sanitizeFrame +
  // settings handling above fill in every v2 default, so this is a silent v1→v2.
  const doc: Project = {
    version: PROJECT_VERSION,
    id: typeof o.id === 'string' ? o.id : newId('proj'),
    name: typeof o.name === 'string' ? o.name : 'Untitled',
    media,
    frames,
    settings: {
      defaultProfileId:
        typeof settings.defaultProfileId === 'string'
          ? (settings.defaultProfileId as string)
          : DEFAULT_PROFILE_ID,
      audioFile: typeof settings.audioFile === 'string' ? (settings.audioFile as string) : null
    }
  }
  return { doc, issues }
}

function sanitizeMedia(m: unknown, issues: ParseIssue[]): MediaItem | null {
  if (typeof m !== 'object' || m === null) {
    issues.push({ message: 'dropped a malformed media item' })
    return null
  }
  const o = m as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.sourceFile !== 'string') {
    issues.push({ message: 'dropped a media item missing id/sourceFile' })
    return null
  }
  const kind: MediaKind = o.kind === 'video' ? 'video' : 'image'
  return {
    id: o.id,
    kind,
    sourceFile: o.sourceFile,
    name: typeof o.name === 'string' ? o.name : o.sourceFile,
    durationS: typeof o.durationS === 'number' ? o.durationS : undefined,
    width: typeof o.width === 'number' ? o.width : 0,
    height: typeof o.height === 'number' ? o.height : 0,
    fps: typeof o.fps === 'number' ? o.fps : undefined
  }
}

function sanitizeFrame(f: unknown, issues: ParseIssue[]): Frame | null {
  if (typeof f !== 'object' || f === null) {
    issues.push({ message: 'dropped a malformed frame' })
    return null
  }
  const o = f as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.mediaId !== 'string') {
    issues.push({ message: 'dropped a frame missing id/mediaId' })
    return null
  }
  let crop: Crop | null = null
  if (o.crop && typeof o.crop === 'object') {
    const c = o.crop as Record<string, unknown>
    crop = {
      aspect: (c.aspect ?? null) as Crop['aspect'],
      x: typeof c.x === 'number' ? c.x : 0,
      y: typeof c.y === 'number' ? c.y : 0,
      w: typeof c.w === 'number' ? c.w : 1,
      h: typeof c.h === 'number' ? c.h : 1
    }
  }
  const prompt =
    o.prompt && typeof o.prompt === 'object'
      ? {
          text: String((o.prompt as Record<string, unknown>).text ?? ''),
          profileId: String((o.prompt as Record<string, unknown>).profileId ?? DEFAULT_PROFILE_ID),
          generatedAt: String((o.prompt as Record<string, unknown>).generatedAt ?? ''),
          model: String((o.prompt as Record<string, unknown>).model ?? '')
        }
      : null
  return {
    id: o.id,
    mediaId: o.mediaId,
    timeS: typeof o.timeS === 'number' ? o.timeS : 0,
    label: typeof o.label === 'string' ? o.label : '',
    notes: typeof o.notes === 'string' ? o.notes : '',
    order: typeof o.order === 'number' ? o.order : 0,
    crop,
    prompt,
    durationS:
      typeof o.durationS === 'number' && isFinite(o.durationS) && o.durationS > 0
        ? o.durationS
        : DEFAULT_FRAME_DURATION_S,
    shot: sanitizeShot(o.shot),
    annotations: Array.isArray(o.annotations)
      ? (o.annotations as unknown[]).map(sanitizeAnnotation).filter(Boolean as unknown as (x: Annotation | null) => x is Annotation)
      : []
  }
}

function sanitizeShot(s: unknown): ShotMeta {
  const base = emptyShotMeta()
  if (typeof s !== 'object' || s === null) return base
  const o = s as Record<string, unknown>
  const str = (k: keyof ShotMeta): string => (typeof o[k] === 'string' ? (o[k] as string) : '')
  return {
    sceneNo: str('sceneNo'),
    shotNo: str('shotNo'),
    shotSize: str('shotSize'),
    cameraAngle: str('cameraAngle'),
    lens: str('lens'),
    movement: str('movement'),
    transition: str('transition')
  }
}

function sanitizeAnnotation(a: unknown): Annotation | null {
  if (typeof a !== 'object' || a === null) return null
  const o = a as Record<string, unknown>
  const kind = o.kind === 'text' ? 'text' : o.kind === 'arrow' ? 'arrow' : null
  if (!kind) return null
  const points = Array.isArray(o.points)
    ? (o.points as unknown[])
        .map((p) => {
          if (typeof p !== 'object' || p === null) return null
          const pp = p as Record<string, unknown>
          const x = typeof pp.x === 'number' ? pp.x : 0
          const y = typeof pp.y === 'number' ? pp.y : 0
          return { x, y }
        })
        .filter(Boolean as unknown as (x: { x: number; y: number } | null) => x is { x: number; y: number })
    : []
  if (points.length === 0) return null
  return {
    id: typeof o.id === 'string' ? o.id : newId('anno'),
    kind,
    points,
    text: typeof o.text === 'string' ? o.text : undefined,
    color: typeof o.color === 'string' ? o.color : '#ff5533'
  }
}

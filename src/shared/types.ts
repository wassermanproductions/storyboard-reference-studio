/**
 * The Storyboard Reference Studio document model. Pure data — no DOM, no
 * Electron, no Node imports; safe to use from both the main and renderer
 * processes. Projects are folders on disk: project.json (this, pretty-printed)
 * plus a media/ subfolder holding COPIES of every imported file.
 */

export type MediaKind = 'image' | 'video'

/** A source file imported into the project's media/ folder. */
export interface MediaItem {
  id: string
  kind: MediaKind
  /** Path relative to the project folder, e.g. "media/abc-clip.mp4". */
  sourceFile: string
  /** Original filename, for display. */
  name: string
  durationS?: number
  width: number
  height: number
  fps?: number
}

export type CropAspect = '16:9' | '9:16' | '1:1' | '4:3' | '2.39:1' | 'free'

/** A reframe rectangle in normalized (0..1) source coordinates. */
export interface Crop {
  aspect: CropAspect | null
  x: number
  y: number
  w: number
  h: number
}

/** A generated (or template) prompt attached to a frame. */
export interface FramePrompt {
  text: string
  profileId: string
  generatedAt: string
  /** The model id used, or "template" for the offline scaffold. */
  model: string
}

/**
 * Shot-list metadata for a frame. All fields default to '' and reuse the
 * option lists in profiles.ts (SHOT_SIZES, CAMERA_ANGLES, MOVEMENTS, TRANSITIONS).
 */
export interface ShotMeta {
  sceneNo: string
  shotNo: string
  shotSize: string
  cameraAngle: string
  lens: string
  movement: string
  transition: string
}

export type AnnotationKind = 'arrow' | 'text'

/**
 * A camera-move / action annotation drawn over a frame. Coordinates are
 * normalized 0..1 in source-image space. Arrows use points[0]=tail,
 * points[1]=head; text uses points[0]=anchor.
 */
export interface Annotation {
  id: string
  kind: AnnotationKind
  points: { x: number; y: number }[]
  text?: string
  color: string
}

/** One card on the storyboard: a still pulled from a media item. */
export interface Frame {
  id: string
  mediaId: string
  /** Source time in seconds; 0 for images. */
  timeS: number
  label: string
  notes: string
  /** Sort position on the board (lower = earlier). */
  order: number
  crop: Crop | null
  prompt: FramePrompt | null
  /** Animatic hold time in seconds (default 2). */
  durationS: number
  /** Shot-list metadata (default all ''). */
  shot: ShotMeta
  /** Camera-move / action annotations (default []). */
  annotations: Annotation[]
}

export interface ProjectSettings {
  defaultProfileId: string
  /** Project-relative path to an imported scratch-track audio in media/. */
  audioFile: string | null
}

export interface Project {
  version: number
  id: string
  name: string
  media: MediaItem[]
  frames: Frame[]
  settings: ProjectSettings
}

export const PROJECT_VERSION = 2

/** Default animatic hold time (seconds) for a new frame. */
export const DEFAULT_FRAME_DURATION_S = 2

/** An empty ShotMeta with all fields blank. */
export function emptyShotMeta(): ShotMeta {
  return { sceneNo: '', shotNo: '', shotSize: '', cameraAngle: '', lens: '', movement: '', transition: '' }
}

/** Structured description Claude returns for a frame (see main/describe.ts). */
export interface FrameDescription {
  shotSize: string
  cameraAngle: string
  lensFeel: string
  subjects: string
  blocking: string
  environment: string
  lighting: string
  colorMood: string
  styleKeywords: string[]
  /** Already phrased for the requested generator profile. */
  promptText: string
}

export type DescribeResult =
  | { ok: true; description: FrameDescription }
  | { ok: false; error: string }

/** Aspect ratio as a numeric width/height, or null for "free". */
export function aspectRatio(aspect: CropAspect | null): number | null {
  switch (aspect) {
    case '16:9':
      return 16 / 9
    case '9:16':
      return 9 / 16
    case '1:1':
      return 1
    case '4:3':
      return 4 / 3
    case '2.39:1':
      return 2.39
    case 'free':
    case null:
      return null
  }
}

export const CROP_ASPECTS: CropAspect[] = ['16:9', '9:16', '1:1', '4:3', '2.39:1', 'free']

/** Filesystem-safe slug for a frame label (used in export folder names). */
export function slugLabel(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'frame'
}

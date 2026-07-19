/**
 * Application state (zustand). One store owns the document, selection, and the
 * viewer/board interaction state. All document edits flow through mutate(),
 * which marks the project dirty; components never edit the doc directly.
 *
 * This is a lighter app than Blockout — no undo stack is required (destructive
 * actions confirm in the UI) — but mutate() + a dirty flag + autosave give the
 * same crash-safety guarantees.
 */

import { create } from 'zustand'
import type { Project, MediaItem, Frame, Crop, CropAspect, ShotMeta, Annotation } from '@shared/types'
import {
  createProject,
  createMediaItem,
  createFrame,
  serializeProject,
  parseProject,
  fullCrop,
  newId
} from '@shared/schema'
import { DEFAULT_PROFILE_ID } from '@shared/profiles'
import { absMediaPath } from './lib/paths'

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'success'
}

export interface ExtractedStill {
  /** Absolute path on disk to the full-res extracted PNG for a frame. */
  path: string
  width: number
  height: number
}

interface SbrState {
  projectFolder: string | null
  doc: Project | null
  /** Selected media item (opens in the viewer). */
  selectedMediaId: string | null
  /** Selected board frame (opens in the inspector). */
  selectedFrameId: string | null
  dirty: boolean
  toasts: Toast[]
  helpOpen: boolean
  /** Cache of extracted full-res stills, keyed by frame id (for crop + export). */
  stills: Record<string, ExtractedStill>
  /** True while a batch prompt run is in flight. */
  promptingAll: boolean

  /* ephemeral view/tool state (not part of the saved document) */
  /** Center stage shows the selected frame ('frame') or the clip ('clip'). */
  viewMode: 'clip' | 'frame'
  /** Active annotation tool on the stage. */
  annotTool: 'none' | 'arrow' | 'text'
  /** Active annotation color. */
  annotColor: string
  /** Rule-of-thirds + action-safe guides visible on the stage. */
  guidesOn: boolean
  /** Selected annotation (for delete), or null. */
  selectedAnnotationId: string | null
  /** Present / play mode overlay open. */
  presentOpen: boolean

  /* lifecycle */
  newProject(folder: string, name: string): void
  loadFromJson(folder: string, json: string): boolean
  markSaved(): void
  setHelpOpen(open: boolean): void

  /* selection */
  selectMedia(id: string | null): void
  selectFrame(id: string | null): void
  setViewMode(mode: 'clip' | 'frame'): void
  setAnnotTool(tool: 'none' | 'arrow' | 'text'): void
  setAnnotColor(color: string): void
  setGuidesOn(on: boolean): void
  selectAnnotation(id: string | null): void
  setPresentOpen(open: boolean): void

  /* mutations */
  mutate(label: string, fn: (doc: Project) => void): void

  /* accessors */
  media(id: string | null): MediaItem | null
  frame(id: string | null): Frame | null
  orderedFrames(): Frame[]
  mediaAbsPath(mediaId: string): string | null

  /* media + frames */
  addMedia(item: Omit<MediaItem, 'id'>): MediaItem
  addFrame(mediaId: string, timeS: number, label?: string): Frame
  removeFrame(frameId: string): void
  reorderFrame(frameId: string, toIndex: number): void
  setFrameLabel(frameId: string, label: string): void
  setFrameNotes(frameId: string, notes: string): void
  setFrameCrop(frameId: string, crop: Crop | null): void
  setFrameCropAspect(frameId: string, aspect: CropAspect | null): void
  setFramePrompt(frameId: string, text: string, profileId: string, model: string): void
  setDefaultProfile(id: string): void
  setFrameDuration(frameId: string, durationS: number): void
  setFrameShot(frameId: string, patch: Partial<ShotMeta>): void
  addAnnotation(frameId: string, annotation: Omit<Annotation, 'id'> & { id?: string }): Annotation
  updateAnnotation(frameId: string, annotationId: string, patch: Partial<Annotation>): void
  removeAnnotation(frameId: string, annotationId: string): void
  clearAnnotations(frameId: string): void
  setAudioFile(path: string | null): void

  /* still cache */
  setStill(frameId: string, still: ExtractedStill): void

  /* misc */
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: string): void
  setPromptingAll(on: boolean): void
}

let toastSeq = 0

export const useStore = create<SbrState>((set, get) => ({
  projectFolder: null,
  doc: null,
  selectedMediaId: null,
  selectedFrameId: null,
  dirty: false,
  toasts: [],
  helpOpen: false,
  stills: {},
  promptingAll: false,
  viewMode: 'clip',
  annotTool: 'none',
  annotColor: '#ff5533',
  guidesOn: false,
  selectedAnnotationId: null,
  presentOpen: false,

  newProject(folder, name) {
    const doc = createProject(name)
    set({
      doc,
      projectFolder: folder,
      selectedMediaId: null,
      selectedFrameId: null,
      stills: {},
      dirty: true
    })
  },

  loadFromJson(folder, json) {
    const { doc } = parseProject(json)
    if (!doc) {
      get().toast('Could not open project: invalid project.json', 'error')
      return false
    }
    set({
      doc,
      projectFolder: folder,
      selectedMediaId: doc.media[0]?.id ?? null,
      selectedFrameId: doc.frames[0]?.id ?? null,
      stills: {},
      dirty: false
    })
    return true
  },

  markSaved: () => set({ dirty: false }),
  setHelpOpen: (open) => set({ helpOpen: open }),

  selectMedia: (id) => set({ selectedMediaId: id, viewMode: 'clip' }),
  selectFrame: (id) =>
    set({ selectedFrameId: id, viewMode: id ? 'frame' : 'clip', selectedAnnotationId: null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setAnnotTool: (tool) => set({ annotTool: tool }),
  setAnnotColor: (color) => set({ annotColor: color }),
  setGuidesOn: (on) => set({ guidesOn: on }),
  selectAnnotation: (id) => set({ selectedAnnotationId: id }),
  setPresentOpen: (open) => set({ presentOpen: open }),

  mutate(_label, fn) {
    const doc = get().doc
    if (!doc) return
    // Structured clone keeps the update immutable-ish (new object → re-render)
    // without a full serialize round-trip.
    const next = structuredClone(doc) as Project
    fn(next)
    set({ doc: next, dirty: true })
  },

  media(id) {
    if (!id) return null
    return get().doc?.media.find((m) => m.id === id) ?? null
  },
  frame(id) {
    if (!id) return null
    return get().doc?.frames.find((f) => f.id === id) ?? null
  },
  orderedFrames() {
    const frames = get().doc?.frames ?? []
    return [...frames].sort((a, b) => a.order - b.order)
  },
  mediaAbsPath(mediaId) {
    const s = get()
    const m = s.doc?.media.find((x) => x.id === mediaId)
    if (!m || !s.projectFolder) return null
    return absMediaPath(s.projectFolder, m.sourceFile)
  },

  addMedia(item) {
    const created = createMediaItem(item)
    get().mutate('import media', (doc) => {
      doc.media.push(created)
    })
    set({ selectedMediaId: created.id })
    return created
  },

  addFrame(mediaId, timeS, label = '') {
    const order = (get().doc?.frames.length ?? 0)
    const frame = createFrame(mediaId, timeS, order, label)
    get().mutate('add frame', (doc) => {
      doc.frames.push(frame)
    })
    set({ selectedFrameId: frame.id })
    return frame
  },

  removeFrame(frameId) {
    get().mutate('remove frame', (doc) => {
      doc.frames = doc.frames.filter((f) => f.id !== frameId)
      doc.frames.forEach((f, i) => (f.order = i))
    })
    const stills = { ...get().stills }
    delete stills[frameId]
    set({
      stills,
      selectedFrameId: get().selectedFrameId === frameId ? null : get().selectedFrameId
    })
  },

  reorderFrame(frameId, toIndex) {
    get().mutate('reorder', (doc) => {
      const ordered = [...doc.frames].sort((a, b) => a.order - b.order)
      const from = ordered.findIndex((f) => f.id === frameId)
      if (from === -1) return
      const [moved] = ordered.splice(from, 1)
      ordered.splice(Math.max(0, Math.min(toIndex, ordered.length)), 0, moved!)
      ordered.forEach((f, i) => {
        const target = doc.frames.find((x) => x.id === f.id)!
        target.order = i
      })
    })
  },

  setFrameLabel(frameId, label) {
    get().mutate('label', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.label = label
    })
  },
  setFrameNotes(frameId, notes) {
    get().mutate('notes', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.notes = notes
    })
  },
  setFrameCrop(frameId, crop) {
    get().mutate('crop', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.crop = crop
    })
  },
  setFrameCropAspect(frameId, aspect) {
    get().mutate('crop aspect', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (!f) return
      if (!aspect) {
        f.crop = f.crop ? { ...f.crop, aspect: null } : null
        return
      }
      f.crop = f.crop ? { ...f.crop, aspect } : fullCrop(aspect)
    })
  },
  setFramePrompt(frameId, text, profileId, model) {
    get().mutate('prompt', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.prompt = { text, profileId, generatedAt: new Date().toISOString(), model }
    })
  },
  setDefaultProfile(id) {
    get().mutate('default profile', (doc) => {
      doc.settings.defaultProfileId = id
    })
  },
  setFrameDuration(frameId, durationS) {
    const clamped = Math.max(0.25, Math.min(30, isFinite(durationS) ? durationS : 2))
    get().mutate('duration', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.durationS = clamped
    })
  },
  setFrameShot(frameId, patch) {
    get().mutate('shot meta', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.shot = { ...f.shot, ...patch }
    })
  },
  addAnnotation(frameId, annotation) {
    const created: Annotation = { ...annotation, id: annotation.id ?? newId('anno') }
    get().mutate('add annotation', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.annotations = [...f.annotations, created]
    })
    return created
  },
  updateAnnotation(frameId, annotationId, patch) {
    get().mutate('update annotation', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (!f) return
      f.annotations = f.annotations.map((a) => (a.id === annotationId ? { ...a, ...patch } : a))
    })
  },
  removeAnnotation(frameId, annotationId) {
    get().mutate('remove annotation', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.annotations = f.annotations.filter((a) => a.id !== annotationId)
    })
  },
  clearAnnotations(frameId) {
    get().mutate('clear annotations', (doc) => {
      const f = doc.frames.find((x) => x.id === frameId)
      if (f) f.annotations = []
    })
  },
  setAudioFile(path) {
    get().mutate('scratch track', (doc) => {
      doc.settings.audioFile = path
    })
  },

  setStill(frameId, still) {
    set({ stills: { ...get().stills, [frameId]: still } })
  },

  toast(text, kind = 'info') {
    const id = `t${++toastSeq}`
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => get().dismissToast(id), 5000)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  setPromptingAll: (on) => set({ promptingAll: on })
}))

/** Serialize the current doc (or null if none). */
export function currentProjectJson(): string | null {
  const doc = useStore.getState().doc
  return doc ? serializeProject(doc) : null
}

export { DEFAULT_PROFILE_ID }

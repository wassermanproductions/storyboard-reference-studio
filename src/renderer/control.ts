/**
 * Renderer side of the agent control server (see src/main/control.ts and
 * mcp/storyboard-mcp.mjs). External agents drive the app through a whitelist
 * of actions executed here against the same store/frameOps paths the UI uses,
 * so everything an agent does is dirty-tracked, autosaved, and visible live.
 */

import { useStore, currentProjectJson } from './store'
import { ensureStill, generatePrompt, buildExportInputs } from './lib/frameOps'
import type { RangeMode } from '../preload/index'

type Params = Record<string, unknown>
type ControlResult = { ok: boolean; data?: unknown; error?: string }

const str = (p: Params, k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined)
const num = (p: Params, k: string): number | undefined =>
  typeof p[k] === 'number' && isFinite(p[k] as number) ? (p[k] as number) : undefined

function requireDoc(): void {
  if (!useStore.getState().doc) {
    throw new Error('No project open — create or open a project in the app first.')
  }
}

async function saveNow(): Promise<void> {
  const s = useStore.getState()
  const json = currentProjectJson()
  if (json && s.projectFolder) await window.sbr.saveProject(s.projectFolder, json)
}

function stateSummary(): unknown {
  const s = useStore.getState()
  const doc = s.doc
  return {
    project: doc?.name ?? null,
    folder: s.projectFolder,
    media: (doc?.media ?? []).map((m) => ({
      id: m.id, kind: m.kind, name: m.name, width: m.width, height: m.height, durationS: m.durationS, fps: m.fps
    })),
    frames: s.orderedFrames().map((f, i) => ({
      id: f.id, index: i + 1, mediaId: f.mediaId, timeS: f.timeS, label: f.label,
      hasPrompt: !!f.prompt?.text, crop: f.crop?.aspect ?? null
    })),
    defaultProfile: doc?.settings.defaultProfileId ?? null
  }
}

async function execute(action: string, params: Params): Promise<unknown> {
  const s = useStore.getState()
  switch (action) {
    case 'get_state':
      return stateSummary()

    case 'add_frame': {
      requireDoc()
      const mediaId = str(params, 'mediaId')
      if (!mediaId) throw new Error('mediaId is required — call get_state for ids.')
      const frame = s.addFrame(mediaId, num(params, 'timeS') ?? 0, str(params, 'label') ?? '')
      await saveNow()
      return { frameId: frame.id }
    }

    case 'auto_board': {
      requireDoc()
      const mediaId = str(params, 'mediaId')
      const media = s.media(mediaId ?? null)
      const abs = mediaId ? s.mediaAbsPath(mediaId) : null
      if (!media || !abs || !s.projectFolder) throw new Error('valid mediaId is required.')
      const startS = num(params, 'startS') ?? 0
      const endS = num(params, 'endS') ?? media.durationS ?? 0
      const modeName = str(params, 'mode') ?? 'scene'
      const mode: RangeMode =
        modeName === 'interval'
          ? { kind: 'interval', everyS: num(params, 'everyS') ?? 2 }
          : modeName === 'count'
            ? { kind: 'count', n: num(params, 'count') ?? 6 }
            : { kind: 'scene', threshold: num(params, 'threshold') ?? 0.35 }
      const outDir = `${s.projectFolder}${s.projectFolder.includes('\\') ? '\\' : '/'}.frames`
      await window.sbr.ensureDir(outDir)
      const res = await window.sbr.extractRange(abs, startS, endS, mode, outDir)
      if (!res.ok) throw new Error(res.error ?? 'extraction failed')
      const ids: string[] = []
      for (const { time, path } of res.frames) {
        const frame = s.addFrame(mediaId!, time, `SHOT @ ${time.toFixed(1)}s`)
        s.setStill(frame.id, { path, width: media.width, height: media.height })
        ids.push(frame.id)
      }
      await saveNow()
      return { added: ids.length, frameIds: ids }
    }

    case 'set_label': {
      requireDoc()
      const frameId = str(params, 'frameId')
      const label = str(params, 'label')
      if (!frameId || label === undefined) throw new Error('frameId and label are required.')
      s.setFrameLabel(frameId, label)
      await saveNow()
      return { ok: true }
    }

    case 'set_crop': {
      requireDoc()
      const frameId = str(params, 'frameId')
      const aspect = str(params, 'aspect')
      if (!frameId) throw new Error('frameId is required.')
      const x = num(params, 'x') ?? 0
      const y = num(params, 'y') ?? 0
      const w = num(params, 'w') ?? 1
      const h = num(params, 'h') ?? 1
      s.setFrameCrop(frameId, { aspect: (aspect ?? null) as any, x, y, w, h })
      await saveNow()
      return { ok: true }
    }

    case 'describe_frame': {
      requireDoc()
      const frameId = str(params, 'frameId')
      if (!frameId) throw new Error('frameId is required.')
      const profileId = str(params, 'profileId') ?? s.doc?.settings.defaultProfileId ?? 'midjourney'
      const res = await generatePrompt(frameId, profileId, str(params, 'context') ?? '')
      if (!res.ok) throw new Error(res.error ?? 'describe failed')
      await saveNow()
      const f = useStore.getState().frame(frameId)
      return { prompt: f?.prompt?.text ?? '' }
    }

    case 'extract_frame': {
      requireDoc()
      const frameId = str(params, 'frameId')
      if (!frameId) throw new Error('frameId is required.')
      const path = await ensureStill(frameId)
      if (!path) throw new Error('could not extract still')
      return { path }
    }

    case 'export_board': {
      requireDoc()
      if (!s.projectFolder) throw new Error('no project folder')
      for (const f of s.orderedFrames()) await ensureStill(f.id)
      const inputs = await buildExportInputs()
      const exportsRoot = `${s.projectFolder}${s.projectFolder.includes('\\') ? '\\' : '/'}exports`
      const res = await window.sbr.exportBoard({
        projectName: s.doc?.name ?? 'Storyboard',
        exportsRoot,
        frames: inputs
      })
      if (!res.ok) throw new Error(res.error ?? 'export failed')
      return { packagePath: res.packagePath }
    }

    default:
      throw new Error(`Unknown action "${action}".`)
  }
}

export function registerControlHandler(): () => void {
  return window.sbr.onControlInvoke((id, action, params) => {
    void (async () => {
      let result: ControlResult
      try {
        const data = await execute(action, (params ?? {}) as Params)
        result = { ok: true, data }
      } catch (e) {
        result = { ok: false, error: (e as Error).message }
      }
      window.sbr.controlResult(id, result)
    })()
  })
}

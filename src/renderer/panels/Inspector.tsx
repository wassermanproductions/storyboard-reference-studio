/**
 * Right panel: inspector for the selected board card. Label, notes, aspect
 * select with a live crop overlay editor on the still, and the prompt panel —
 * profile select, Generate (Claude), editable prompt, Copy, and offline
 * template controls used when there's no API key.
 */

import { useCallback, useEffect, useState } from 'react'
import { useStore, currentProjectJson } from '../store'
import { useAbsUrl } from '../lib/useMediaUrl'
import { CropEditor } from './CropEditor'
import { ensureStill, generatePrompt, templatePrompt } from '../lib/frameOps'
import { BUILTIN_PROFILES, SHOT_SIZES, CAMERA_ANGLES, LIGHTING_STYLES, MOODS } from '@shared/profiles'
import { CROP_ASPECTS, fullCropSafe } from '../lib/inspectorHelpers'
import type { CropAspect } from '@shared/types'

export function Inspector(): JSX.Element {
  const frameId = useStore((s) => s.selectedFrameId)
  const frame = useStore((s) => s.frame(frameId))
  const doc = useStore((s) => s.doc)
  const folder = useStore((s) => s.projectFolder)
  const still = useStore((s) => (frameId ? s.stills[frameId] : undefined))
  const toast = useStore((s) => s.toast)

  const setFrameLabel = useStore((s) => s.setFrameLabel)
  const setFrameNotes = useStore((s) => s.setFrameNotes)
  const setFrameCrop = useStore((s) => s.setFrameCrop)
  const setFrameCropAspect = useStore((s) => s.setFrameCropAspect)
  const setFramePrompt = useStore((s) => s.setFramePrompt)
  const setDefaultProfile = useStore((s) => s.setDefaultProfile)

  const [profileId, setProfileId] = useState(doc?.settings.defaultProfileId ?? 'midjourney')
  const [promptText, setPromptText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [showTemplate, setShowTemplate] = useState(false)
  const [tpl, setTpl] = useState({ shotSize: SHOT_SIZES[4]!, cameraAngle: CAMERA_ANGLES[0]!, lighting: LIGHTING_STYLES[0]!, mood: MOODS[0]! })

  const stillUrl = useAbsUrl(still?.path ?? null)

  // Ensure a still exists when a frame is opened (for the crop editor).
  useEffect(() => {
    if (frameId && !still) void ensureStill(frameId)
  }, [frameId, still])

  // Sync local prompt/profile from the selected frame.
  useEffect(() => {
    if (!frame) return
    setProfileId(frame.prompt?.profileId ?? doc?.settings.defaultProfileId ?? 'midjourney')
    setPromptText(frame.prompt?.text ?? '')
    setError('')
  }, [frameId])

  const save = useCallback(async () => {
    const json = currentProjectJson()
    if (json && folder) await window.sbr.saveProject(folder, json)
  }, [folder])

  const onGenerate = useCallback(async () => {
    if (!frameId) return
    setGenerating(true)
    setError('')
    const res = await generatePrompt(frameId, profileId, frame?.notes ?? '')
    setGenerating(false)
    if (!res.ok) {
      setError(res.error ?? 'Failed to generate.')
      setShowTemplate(true)
      return
    }
    const updated = useStore.getState().frame(frameId)
    setPromptText(updated?.prompt?.text ?? '')
    setDefaultProfile(profileId)
    await save()
    toast('Prompt generated.', 'success')
  }, [frameId, profileId, frame?.notes, setDefaultProfile, save, toast])

  const onApplyTemplate = useCallback(async () => {
    if (!frame || !frameId) return
    const text = templatePrompt(frame, profileId, tpl)
    setPromptText(text)
    setFramePrompt(frameId, text, profileId, 'template')
    await save()
  }, [frame, frameId, profileId, tpl, setFramePrompt, save])

  const onCopy = useCallback(async () => {
    await navigator.clipboard.writeText(promptText)
    toast('Prompt copied.', 'success')
  }, [promptText, toast])

  if (!frame) {
    return (
      <div className="inspector-col panel">
        <div className="inspector-empty">Select a board card to label, reframe, and prompt it.</div>
      </div>
    )
  }

  const crop = frame.crop
  const onAspect = (aspect: CropAspect | null): void => {
    if (aspect === null) {
      setFrameCrop(frame.id, null)
    } else if (!crop) {
      setFrameCrop(frame.id, fullCropSafe(aspect, still?.width ?? 16, still?.height ?? 9))
    } else {
      setFrameCropAspect(frame.id, aspect)
    }
    void save()
  }

  return (
    <div className="inspector-col panel">
      <div className="inspector-still-wrap">
        {stillUrl ? (
          <img className="inspector-still" src={stillUrl} alt="frame still" />
        ) : (
          <div className="inspector-still" />
        )}
        {crop && still && stillUrl && (
          <CropEditor frameId={frame.id} crop={crop} imgW={still.width} imgH={still.height} />
        )}
      </div>

      <div className="panel-section">
        <div className="field">
          <label>Label</label>
          <input
            type="text"
            value={frame.label}
            placeholder="SHOT 1A — HERO ENTERS"
            onChange={(e) => setFrameLabel(frame.id, e.target.value)}
            onBlur={save}
          />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea value={frame.notes} onChange={(e) => setFrameNotes(frame.id, e.target.value)} onBlur={save} />
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Reframe</div>
        <div className="seg">
          <button className={!crop ? 'active' : ''} onClick={() => onAspect(null)}>none</button>
          {CROP_ASPECTS.map((a) => (
            <button key={a} className={crop?.aspect === a ? 'active' : ''} onClick={() => onAspect(a)}>
              {a}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {crop ? 'Drag the overlay to reframe. The crop is applied full-res on export.' : 'Pick an aspect to add a crop overlay.'}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Prompt</div>
        <div className="field">
          <label>Generator profile</label>
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {BUILTIN_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <button className="btn primary block" onClick={onGenerate} disabled={generating}>
          {generating ? 'Generating…' : '✨ Generate prompt'}
        </button>
        {error && <div className="err-text" style={{ marginTop: 8 }}>{error}</div>}
        <textarea
          className="prompt-box"
          style={{ marginTop: 10 }}
          value={promptText}
          placeholder="Generate a prompt, use the template below, or write your own…"
          onChange={(e) => setPromptText(e.target.value)}
          onBlur={() => {
            if (frameId) setFramePrompt(frameId, promptText, profileId, frame.prompt?.model ?? 'edited')
            void save()
          }}
        />
        <div className="field-row" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={onCopy} disabled={!promptText}>Copy prompt</button>
          <button className="btn small" onClick={() => setShowTemplate((v) => !v)}>
            {showTemplate ? 'Hide template' : 'Offline template'}
          </button>
        </div>

        {showTemplate && (
          <div style={{ marginTop: 12 }}>
            <div className="hint" style={{ marginBottom: 8 }}>
              No API? Fill these and build a prompt scaffold from the frame's metadata.
            </div>
            <TplSelect label="Shot size" options={SHOT_SIZES} value={tpl.shotSize} onChange={(v) => setTpl({ ...tpl, shotSize: v })} />
            <TplSelect label="Camera angle" options={CAMERA_ANGLES} value={tpl.cameraAngle} onChange={(v) => setTpl({ ...tpl, cameraAngle: v })} />
            <TplSelect label="Lighting" options={LIGHTING_STYLES} value={tpl.lighting} onChange={(v) => setTpl({ ...tpl, lighting: v })} />
            <TplSelect label="Mood" options={MOODS} value={tpl.mood} onChange={(v) => setTpl({ ...tpl, mood: v })} />
            <button className="btn block" onClick={onApplyTemplate}>Build template prompt</button>
          </div>
        )}
      </div>
    </div>
  )
}

function TplSelect({ label, options, value, onChange }: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}

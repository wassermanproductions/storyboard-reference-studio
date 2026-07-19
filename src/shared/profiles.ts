/**
 * Generator profiles — data-driven prompt phrasing for the supported image
 * generators. Each profile carries:
 *   - phrasingGuide: fed to Claude's system prompt so the model returns a
 *     promptText already shaped for that generator.
 *   - formatPrompt: a pure OFFLINE fallback used by the template mode, which
 *     assembles a prompt from the user's dropdown selections + label/notes
 *     (no API needed).
 *
 * Pure module: no DOM / Electron / Node imports.
 */

import type { CropAspect } from './types'

/** Fields the offline template mode fills from user-editable dropdowns. */
export interface TemplateFields {
  label: string
  notes: string
  shotSize: string
  cameraAngle: string
  lighting: string
  mood: string
  /** The frame's target crop aspect (for --ar and similar). */
  aspect: CropAspect | null
}

export interface GeneratorProfile {
  id: string
  name: string
  /** One-line description shown in the UI. */
  blurb: string
  /** Guidance handed to Claude so promptText is phrased for this generator. */
  phrasingGuide: string
  /** Offline fallback: build a prompt string from template fields. */
  formatPrompt(fields: TemplateFields): string
}

/** Midjourney's --ar takes "W:H"; map our aspects (free → omit). */
function mjAspectArg(aspect: CropAspect | null): string {
  if (!aspect || aspect === 'free') return ''
  return ` --ar ${aspect.replace(':', ':')}`
}

/** Drop empty template parts and join with a separator. */
function joinParts(parts: (string | undefined)[], sep: string): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join(sep)
}

export const BUILTIN_PROFILES: GeneratorProfile[] = [
  {
    id: 'midjourney',
    name: 'Midjourney',
    blurb: 'Comma-phrased keywords, trailing --ar and --style raw.',
    phrasingGuide:
      'Phrase promptText for Midjourney v6: a single line of comma-separated visual phrases (no full sentences), ordered subject → action/blocking → environment → lighting → color/mood → lens & shot size → style keywords. Do NOT append any --ar or --style flags yourself; the app adds them. Keep it vivid and concrete.',
    formatPrompt: (f) =>
      joinParts(
        [
          f.label && f.label.toLowerCase(),
          f.notes,
          f.shotSize,
          f.cameraAngle,
          f.lighting,
          f.mood,
          'cinematic still, film grain, detailed'
        ],
        ', '
      ) + mjAspectArg(f.aspect) + ' --style raw'
  },
  {
    id: 'flux',
    name: 'Flux',
    blurb: 'Natural sentence, camera & lighting up front.',
    phrasingGuide:
      'Phrase promptText for Flux: fluent natural-language sentences. Lead with the camera (shot size, angle, lens feel), then the subject and blocking, then environment, then lighting and color/mood. Flux rewards descriptive prose; avoid keyword salad and avoid trailing flags.',
    formatPrompt: (f) =>
      joinParts(
        [
          joinParts([f.shotSize, f.cameraAngle], ', '),
          f.label ? `of ${f.label.toLowerCase()}` : '',
          f.notes ? `— ${f.notes}` : '',
          f.lighting ? `Lit with ${f.lighting.toLowerCase()}.` : '',
          f.mood ? `${f.mood} mood.` : '',
          'Cinematic photograph.'
        ],
        ' '
      )
  },
  {
    id: 'gpt-image',
    name: 'GPT-Image',
    blurb: 'Detailed instructive paragraph.',
    phrasingGuide:
      'Phrase promptText for GPT-Image / DALL·E-style models: one detailed, instructive paragraph that describes the exact image to create. Be explicit and directive ("Create a … shot showing …"). Cover framing, subject and blocking, setting, lighting, and color/mood in complete sentences. No flags.',
    formatPrompt: (f) =>
      joinParts(
        [
          `Create a ${joinParts([f.shotSize, f.cameraAngle], ' ')} shot`,
          f.label ? `of ${f.label.toLowerCase()}` : 'of the scene',
          f.notes ? `. ${f.notes}` : '',
          f.lighting ? `. The scene is lit with ${f.lighting.toLowerCase()}` : '',
          f.mood ? `, with a ${f.mood.toLowerCase()} mood` : '',
          '. Render it as a cinematic film still.'
        ],
        ''
      )
  },
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    blurb: 'Concise scene + explicit "match this framing" clause.',
    phrasingGuide:
      'Phrase promptText for Nano Banana (Gemini image): a concise scene description in 1-2 sentences, then a final clause beginning "Match this framing:" that names the shot size, camera angle, and lens feel precisely so the generator reproduces the reference composition. Keep it tight.',
    formatPrompt: (f) =>
      joinParts(
        [
          joinParts([f.label ? f.label.toLowerCase() : 'the scene', f.notes], ', '),
          f.lighting ? `${f.lighting}.` : '',
          f.mood ? `${f.mood} mood.` : '',
          `Match this framing: ${joinParts([f.shotSize, f.cameraAngle], ', ')}.`
        ],
        ' '
      )
  },
  {
    id: 'sdxl',
    name: 'SDXL',
    blurb: 'Tag-style, quality tags, no trailing args.',
    phrasingGuide:
      'Phrase promptText for SDXL: a comma-separated list of short tags (booru/keyword style), ordered subject, action, environment, lighting, color/mood, shot size, angle, lens, then quality tags. No full sentences, no flags, no negative prompt.',
    formatPrompt: (f) =>
      joinParts(
        [
          f.label && f.label.toLowerCase(),
          f.notes,
          f.shotSize,
          f.cameraAngle,
          f.lighting,
          f.mood,
          'cinematic, highly detailed, sharp focus, film still, 8k, masterpiece'
        ],
        ', '
      )
  },
  {
    id: 'generic',
    name: 'Generic',
    blurb: 'Clean cinematic description, no generator-specific syntax.',
    phrasingGuide:
      'Phrase promptText as a clean, generator-agnostic cinematic description: 2-4 sentences covering shot size and angle, subject and blocking, environment, lighting, and color/mood. No flags, no tags, no tool-specific syntax.',
    formatPrompt: (f) =>
      joinParts(
        [
          joinParts([f.shotSize, f.cameraAngle], ', ') + '.',
          f.label ? `Subject: ${f.label.toLowerCase()}.` : '',
          f.notes ? `${f.notes}.` : '',
          f.lighting ? `Lighting: ${f.lighting.toLowerCase()}.` : '',
          f.mood ? `Mood: ${f.mood.toLowerCase()}.` : '',
          'Cinematic film still.'
        ],
        ' '
      )
  }
]

export const PROFILE_MAP: Record<string, GeneratorProfile> = Object.fromEntries(
  BUILTIN_PROFILES.map((p) => [p.id, p])
)

export const DEFAULT_PROFILE_ID = 'midjourney'

export function getProfile(id: string): GeneratorProfile {
  return PROFILE_MAP[id] ?? PROFILE_MAP[DEFAULT_PROFILE_ID]!
}

/* Dropdown option lists for the offline template controls. */
export const SHOT_SIZES = [
  'extreme wide shot',
  'wide shot',
  'full shot',
  'medium wide shot',
  'medium shot',
  'medium close-up',
  'close-up',
  'extreme close-up'
]

export const CAMERA_ANGLES = [
  'eye level',
  'low angle',
  'high angle',
  'overhead / top-down',
  'dutch angle',
  'over-the-shoulder',
  'point of view'
]

export const LIGHTING_STYLES = [
  'soft daylight',
  'golden hour',
  'hard sunlight',
  'overcast',
  'blue hour',
  'night exterior',
  'warm interior',
  'cool interior',
  'neon / practical',
  'low-key chiaroscuro',
  'high-key'
]

export const MOVEMENTS = [
  'Static',
  'Pan L→R',
  'Pan R→L',
  'Tilt up',
  'Tilt down',
  'Dolly in',
  'Dolly out',
  'Push-in',
  'Pull-back',
  'Track L',
  'Track R',
  'Crane up',
  'Crane down',
  'Handheld',
  'Whip pan',
  'Zoom in',
  'Zoom out'
]

export const TRANSITIONS = [
  'Cut',
  'Match cut',
  'Dissolve',
  'Fade in',
  'Fade out',
  'Whip',
  'Smash cut',
  'J-cut',
  'L-cut'
]

export const MOODS = [
  'neutral',
  'tense',
  'warm',
  'melancholy',
  'dreamy',
  'gritty',
  'romantic',
  'ominous',
  'energetic',
  'serene'
]

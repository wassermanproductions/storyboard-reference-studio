/**
 * Per-frame prompt generation with Claude vision + structured output.
 *
 * Given a full-res frame PNG and a generator profile, downscale the image to
 * <=1568px long edge, send it to Claude (model claude-opus-4-8, adaptive
 * thinking, json_schema output), and return a structured description whose
 * promptText is already phrased for the requested generator.
 *
 * Runs in the Electron main process. The whole app works offline EXCEPT this;
 * a friendly error is returned when no credentials resolve.
 */

import Anthropic from '@anthropic-ai/sdk'
import { readFile, mkdir, rm, access } from 'fs/promises'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { resolveFfmpeg, run } from './ffmpeg'
import { getProfile } from '../shared/profiles'
import type { DescribeResult, FrameDescription } from '../shared/types'

const DESCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    shotSize: { type: 'string' },
    cameraAngle: { type: 'string' },
    lensFeel: { type: 'string' },
    subjects: { type: 'string' },
    blocking: { type: 'string' },
    environment: { type: 'string' },
    lighting: { type: 'string' },
    colorMood: { type: 'string' },
    styleKeywords: { type: 'array', items: { type: 'string' } },
    promptText: { type: 'string' }
  },
  required: [
    'shotSize', 'cameraAngle', 'lensFeel', 'subjects', 'blocking',
    'environment', 'lighting', 'colorMood', 'styleKeywords', 'promptText'
  ],
  additionalProperties: false
} as const

function buildSystemPrompt(profileId: string, extraContext: string): string {
  const profile = getProfile(profileId)
  return [
    'You are the shot-analysis engine of Storyboard Reference Studio. You are shown one still frame pulled from reference footage or a reference image. Describe its cinematography precisely so an image generator can recreate the framing and shot elements.',
    '',
    'Analyze and return, as structured fields:',
    '- shotSize: the shot size (e.g. wide shot, medium close-up, extreme close-up).',
    '- cameraAngle: the camera angle/height (eye level, low angle, high angle, overhead, dutch, over-the-shoulder, POV).',
    '- lensFeel: the lens/perspective feel (wide and distorted, normal, compressed telephoto; note depth of field).',
    '- subjects: who/what is in frame.',
    '- blocking: where subjects sit in the frame and how they relate spatially.',
    '- environment: the setting and notable set elements.',
    '- lighting: the lighting setup, direction, quality, and time of day.',
    '- colorMood: the color palette and emotional tone.',
    '- styleKeywords: 4-8 short style keywords (film stock, genre, references).',
    '- promptText: a ready-to-paste prompt for the target image generator.',
    '',
    `TARGET GENERATOR: ${profile.name}. ${profile.phrasingGuide}`,
    extraContext ? `\nADDITIONAL CONTEXT FROM THE USER: ${extraContext}` : ''
  ].join('\n')
}

/** Downscale to <=1568px long edge as JPEG (keeps payloads small). */
async function downscale(framePng: string): Promise<{ path: string; temp: boolean }> {
  const ffmpeg = await resolveFfmpeg()
  const dir = join(tmpdir(), 'sbr-describe')
  await mkdir(dir, { recursive: true })
  const out = join(dir, `frame-${Date.now()}.jpg`)
  // Scale down only if larger; keep aspect. -2 keeps dimension divisible by 2.
  const res = await run(ffmpeg, [
    '-y', '-i', framePng,
    '-vf', "scale='min(1568,iw)':-2",
    '-q:v', '3', out
  ])
  if (res.code === 0) return { path: out, temp: true }
  return { path: framePng, temp: false } // fall back to the original
}

/**
 * Finder-launched apps don't inherit shell env, so ANTHROPIC_API_KEY from a
 * profile never reaches a double-clicked build. Chain:
 *   1. ANTHROPIC_API_KEY (SDK reads it — return undefined so it does)
 *   2. an `ant auth login` profile (SDK, file-based, works from Finder)
 *   3. ~/.config/storyboard-reference/anthropic-api-key
 */
async function resolveApiKey(): Promise<string | undefined> {
  if (process.env.ANTHROPIC_API_KEY) return undefined
  try {
    const key = (
      await readFile(join(homedir(), '.config', 'storyboard-reference', 'anthropic-api-key'), 'utf-8')
    ).trim()
    return key || undefined
  } catch {
    return undefined
  }
}

const AUTH_HELP =
  'Claude API authentication failed. Either: (1) run `ant auth login` in a terminal, ' +
  '(2) save your key to ~/.config/storyboard-reference/anthropic-api-key, or ' +
  '(3) launch Storyboard Reference Studio from a terminal with ANTHROPIC_API_KEY set. ' +
  'You can still write prompts by hand with the offline template controls.'

export async function describeFrame(
  framePngPath: string,
  profileId: string,
  extraContext = ''
): Promise<DescribeResult> {
  let scaled: { path: string; temp: boolean } | null = null
  try {
    try {
      await access(framePngPath)
    } catch {
      return { ok: false, error: 'Frame image not found — re-extract the frame and try again.' }
    }
    scaled = await downscale(framePngPath)
    const bytes = await readFile(scaled.path)
    if (bytes.byteLength > 20 * 1024 * 1024) {
      return { ok: false, error: 'Frame image is larger than 20MB — try a smaller crop.' }
    }
    const isJpeg = scaled.path.endsWith('.jpg') || scaled.path.endsWith('.jpeg')
    const data = bytes.toString('base64')

    const client = new Anthropic({ apiKey: await resolveApiKey() })
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: buildSystemPrompt(profileId, extraContext),
      output_config: {
        format: { type: 'json_schema', schema: DESCRIPTION_SCHEMA as unknown as Record<string, unknown> }
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: (isJpeg ? 'image/jpeg' : 'image/png') as 'image/jpeg',
                data
              }
            },
            {
              type: 'text',
              text: 'Analyze this reference frame and produce a generator-ready prompt for the target generator.'
            }
          ]
        }
      ]
    })

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'The model declined to analyze this image.' }
    }
    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') {
      return { ok: false, error: 'No description returned — try a clearer frame.' }
    }
    const description = JSON.parse(text.text) as FrameDescription
    return { ok: true, description }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: AUTH_HELP }
    if (e instanceof Error && /apiKey|api key|ANTHROPIC_API_KEY/i.test(e.message)) {
      return { ok: false, error: AUTH_HELP }
    }
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Claude API error: ${e.message}` }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (scaled?.temp) {
      try {
        await rm(scaled.path)
      } catch {}
    }
  }
}

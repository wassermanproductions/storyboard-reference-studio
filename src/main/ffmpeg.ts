/**
 * ffmpeg / ffprobe resolution and spawning helpers.
 *
 * PACKAGING RULE (load-bearing): ffmpeg-static is EXTERNAL to the main bundle
 * and asar-unpacked. Bundling it rewrites the __dirname it uses to locate the
 * binary and breaks the path. See electron.vite.config.ts + electron-builder.yml.
 *
 * GUI apps launched from Finder do NOT inherit the shell PATH, so a bare
 * `ffmpeg` spawn fails even when Homebrew has it — hence the absolute-path probes.
 */

import { spawn } from 'child_process'
import { access } from 'fs/promises'

export async function resolveFfmpeg(): Promise<string> {
  if (process.env.SBR_FFMPEG) return process.env.SBR_FFMPEG
  try {
    const mod = await import('ffmpeg-static')
    const p = (mod.default ?? mod) as unknown as string
    if (p) {
      const real = p.replace('app.asar', 'app.asar.unpacked')
      await access(real)
      return real
    }
  } catch {}
  for (const candidate of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  return 'ffmpeg'
}

/** ffprobe usually sits next to ffmpeg; ffmpeg-static ships ffmpeg only, so
 *  we shell out to a PATH/absolute ffprobe and fall back to ffmpeg-based probing. */
export async function resolveFfprobe(): Promise<string | null> {
  if (process.env.SBR_FFPROBE) return process.env.SBR_FFPROBE
  for (const candidate of ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe', 'ffprobe']) {
    try {
      if (candidate === 'ffprobe') return 'ffprobe'
      await access(candidate)
      return candidate
    } catch {}
  }
  return null
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Spawn a process, capture stdout/stderr, resolve on close (never rejects). */
export function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(bin, args)
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000)
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }))
  })
}

export interface ProbeInfo {
  width: number
  height: number
  durationS?: number
  fps?: number
}

/** Probe media dimensions / duration / fps. Prefers ffprobe; falls back to
 *  parsing ffmpeg -i stderr, which is always available (ffmpeg-static). */
export async function probeMedia(filePath: string): Promise<ProbeInfo> {
  const ffprobe = await resolveFfprobe()
  if (ffprobe) {
    const res = await run(ffprobe, [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath
    ])
    if (res.code === 0 && res.stdout) {
      try {
        const json = JSON.parse(res.stdout)
        const v = (json.streams as any[]).find((s) => s.codec_type === 'video')
        if (v) {
          const fps = parseRational(v.avg_frame_rate) || parseRational(v.r_frame_rate)
          const durationS =
            Number(json.format?.duration) || Number(v.duration) || undefined
          return {
            width: Number(v.width) || 0,
            height: Number(v.height) || 0,
            durationS: durationS && isFinite(durationS) ? durationS : undefined,
            fps: fps && isFinite(fps) ? fps : undefined
          }
        }
      } catch {}
    }
  }
  // Fallback: ffmpeg -i writes stream info to stderr and exits non-zero.
  const ffmpeg = await resolveFfmpeg()
  const res = await run(ffmpeg, ['-i', filePath])
  return parseFfmpegStderr(res.stderr)
}

function parseRational(r: unknown): number | undefined {
  if (typeof r !== 'string') return undefined
  const [a, b] = r.split('/').map(Number)
  if (!b) return a || undefined
  const v = a! / b
  return isFinite(v) ? v : undefined
}

function parseFfmpegStderr(stderr: string): ProbeInfo {
  const dim = stderr.match(/,\s*(\d{2,5})x(\d{2,5})/)
  const fpsMatch = stderr.match(/([\d.]+)\s*fps/)
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
  let durationS: number | undefined
  if (durMatch) {
    durationS = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
  }
  return {
    width: dim ? Number(dim[1]) : 0,
    height: dim ? Number(dim[2]) : 0,
    durationS,
    fps: fpsMatch ? Number(fpsMatch[1]) : undefined
  }
}

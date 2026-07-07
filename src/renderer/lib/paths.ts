/**
 * Small renderer-side helpers for turning project-relative media paths into
 * absolute paths (for ffmpeg IPC) and blob URLs (for <img>/<video> src).
 */

const blobCache = new Map<string, string>()

/** Absolute path to a project-relative media file, e.g. "media/x.mp4". */
export function absMediaPath(folder: string, sourceFile: string): string {
  // Cross-platform join without importing node 'path' in the renderer.
  const sepChar = folder.includes('\\') ? '\\' : '/'
  const rel = sourceFile.replace(/[/\\]/g, sepChar)
  return folder.endsWith(sepChar) ? folder + rel : folder + sepChar + rel
}

/** Load a project file as a blob URL, cached by key. */
export async function projectFileUrl(
  folder: string,
  relativePath: string,
  mime: string
): Promise<string> {
  const key = `${folder}::${relativePath}`
  const cached = blobCache.get(key)
  if (cached) return cached
  const buf = await window.sbr.readProjectFile(folder, relativePath)
  const url = URL.createObjectURL(new Blob([buf], { type: mime }))
  blobCache.set(key, url)
  return url
}

/** Turn an absolute PNG path into a blob URL (for extracted frame previews). */
const absCache = new Map<string, string>()
export async function absFileUrl(folder: string, absPath: string, mime = 'image/png'): Promise<string> {
  const cached = absCache.get(absPath)
  if (cached) return cached
  // absPath is inside the project temp area; read it through readProjectFile
  // by making it project-relative when possible, else read via a data path.
  // For extracted frames we always keep them under the project folder's
  // .frames cache, so compute the relative segment.
  const rel = absPath.startsWith(folder) ? absPath.slice(folder.length).replace(/^[/\\]/, '') : absPath
  const buf = await window.sbr.readProjectFile(folder, rel)
  const url = URL.createObjectURL(new Blob([buf], { type: mime }))
  absCache.set(absPath, url)
  return url
}

export function mimeForMedia(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    default:
      return 'application/octet-stream'
  }
}

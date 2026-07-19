/**
 * Electron main process: window lifecycle, project folder I/O, media import
 * (copy into media/ + ffprobe), ffmpeg frame extraction, Claude prompt
 * generation, and board export. All filesystem + subprocess access lives here;
 * the renderer talks through the typed IPC surface in src/preload.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir, readFile, writeFile, copyFile, stat } from 'fs/promises'
import { join, basename, extname, resolve, sep } from 'path'
import { startControlServer } from './control'
import { probeMedia } from './ffmpeg'
import { extractFrame, extractRange, type RangeMode } from './frames'
import {
  exportBoard,
  exportAnimatic,
  exportShotList,
  type ExportInput,
  type AnimaticOptions
} from './export'
import { exportPdf } from './pdf'
import { version as APP_VERSION } from '../../package.json'

const isDev = !!process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: 'Storyboard Reference Studio',
    backgroundColor: '#111113',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (isDev) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  void startControlServer(() => mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ------------------------------- dialogs -------------------------------- */

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp']
const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm']
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac']

ipcMain.handle('dialog:newProject', async () => {
  if (process.env.SBR_SMOKE_DIR) {
    const folder = join(process.env.SBR_SMOKE_DIR, 'Smoke.sbref')
    await mkdir(join(folder, 'media'), { recursive: true })
    await mkdir(join(folder, 'exports'), { recursive: true })
    return folder
  }
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Create Storyboard Project',
    buttonLabel: 'Create',
    nameFieldLabel: 'Project name',
    defaultPath: join(app.getPath('documents'), 'Untitled.sbref')
  })
  if (result.canceled || !result.filePath) return null
  const folder = result.filePath.endsWith('.sbref') ? result.filePath : `${result.filePath}.sbref`
  await mkdir(join(folder, 'media'), { recursive: true })
  await mkdir(join(folder, 'exports'), { recursive: true })
  return folder
})

ipcMain.handle('dialog:openProject', async () => {
  if (process.env.SBR_SMOKE_DIR) {
    return join(process.env.SBR_SMOKE_DIR, 'Smoke.sbref')
  }
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Storyboard Project',
    properties: ['openDirectory'],
    message: 'Choose a .sbref project folder'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:importMedia', async () => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS] },
      { name: 'Images', extensions: IMAGE_EXTS },
      { name: 'Videos', extensions: VIDEO_EXTS },
      { name: 'Audio', extensions: AUDIO_EXTS }
    ]
  })
  if (result.canceled) return []
  return result.filePaths
})

/* ---------------------------- project I/O ------------------------------- */

ipcMain.handle('project:save', async (_e, folder: string, json: string) => {
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'project.json'), json, 'utf-8')
  return true
})

ipcMain.handle('project:saveBackup', async (_e, folder: string, json: string) => {
  await mkdir(join(folder, '.autosave'), { recursive: true })
  await writeFile(join(folder, '.autosave', 'project.autosave.json'), json, 'utf-8')
  return true
})

ipcMain.handle('project:load', async (_e, folder: string) => {
  const main = join(folder, 'project.json')
  const backup = join(folder, '.autosave', 'project.autosave.json')
  const out: { json: string | null; backupJson: string | null; backupNewer: boolean; folder: string } = {
    json: null,
    backupJson: null,
    backupNewer: false,
    folder
  }
  let mainTime = 0
  let backupTime = 0
  try {
    out.json = await readFile(main, 'utf-8')
    mainTime = (await stat(main)).mtimeMs
  } catch {}
  try {
    out.backupJson = await readFile(backup, 'utf-8')
    backupTime = (await stat(backup)).mtimeMs
  } catch {}
  out.backupNewer = backupTime > mainTime + 1500 && out.backupJson !== out.json
  return out
})

function guardPath(folder: string, relativePath: string): string {
  const base = resolve(folder)
  const full = resolve(base, relativePath)
  if (full !== base && !full.startsWith(base + sep)) throw new Error('path escapes project folder')
  return full
}

/** Copy a source file into media/ and probe it. Returns the new MediaItem shape. */
ipcMain.handle('project:importMedia', async (_e, folder: string, sourcePath: string) => {
  const mediaDir = join(folder, 'media')
  await mkdir(mediaDir, { recursive: true })
  const ext = extname(sourcePath).toLowerCase()
  const kind = VIDEO_EXTS.includes(ext.replace('.', '')) ? 'video' : 'image'
  const name = `${Date.now().toString(36)}-${basename(sourcePath)}`
  const dest = join(mediaDir, name)
  await copyFile(sourcePath, dest)
  const info = await probeMedia(dest)
  return {
    kind,
    sourceFile: join('media', name),
    name: basename(sourcePath),
    width: info.width,
    height: info.height,
    durationS: info.durationS,
    fps: info.fps
  }
})

/** Write pasted PNG bytes into media/pasted-<n>.png and probe. */
ipcMain.handle('project:pasteImage', async (_e, folder: string, data: ArrayBuffer, index: number) => {
  const mediaDir = join(folder, 'media')
  await mkdir(mediaDir, { recursive: true })
  const name = `pasted-${index}-${Date.now().toString(36)}.png`
  const dest = join(mediaDir, name)
  await writeFile(dest, Buffer.from(data))
  const info = await probeMedia(dest)
  return {
    kind: 'image' as const,
    sourceFile: join('media', name),
    name,
    width: info.width,
    height: info.height
  }
})

/** Copy an audio scratch track into media/ and return its project-relative path. */
ipcMain.handle('project:importAudio', async (_e, folder: string, sourcePath: string) => {
  const mediaDir = join(folder, 'media')
  await mkdir(mediaDir, { recursive: true })
  const name = `${Date.now().toString(36)}-${basename(sourcePath)}`
  const dest = join(mediaDir, name)
  await copyFile(sourcePath, dest)
  return { sourceFile: join('media', name), name: basename(sourcePath) }
})

ipcMain.handle('file:readProjectFile', async (_e, folder: string, relativePath: string) => {
  const full = guardPath(folder, relativePath)
  const data = await readFile(full)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
})

/** Write base64 PNG bytes to a project-relative path (used for annotation composites). */
ipcMain.handle('file:writeProjectPng', async (_e, folder: string, relativePath: string, base64: string) => {
  const full = guardPath(folder, relativePath)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, Buffer.from(base64, 'base64'))
  return true
})

ipcMain.handle('shell:showFolder', async (_e, path: string) => {
  shell.showItemInFolder(path)
})

const EXTERNAL_LINK_ALLOWLIST = new Set(['wassermanproductions.com', 'wasserman.ai', 'github.com'])

ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^www\./, '')
  if (parsed.protocol !== 'https:' || !EXTERNAL_LINK_ALLOWLIST.has(host)) return false
  await shell.openExternal(url)
  return true
})

/* --------------------------- frame extraction --------------------------- */

ipcMain.handle('frames:extract', async (_e, mediaPath: string, timeS: number, outPng: string) => {
  return extractFrame(mediaPath, timeS, outPng)
})

ipcMain.handle(
  'frames:extractRange',
  async (_e, mediaPath: string, startS: number, endS: number, mode: RangeMode, outDir: string) => {
    return extractRange(mediaPath, startS, endS, mode, outDir)
  }
)

/* ---------------------------- AI description ---------------------------- */

ipcMain.handle('ai:describeFrame', async (_e, framePngPath: string, profileId: string, extraContext: string) => {
  const { describeFrame } = await import('./describe')
  return describeFrame(framePngPath, profileId, extraContext)
})

/* -------------------------------- export -------------------------------- */

ipcMain.handle('export:board', async (_e, input: ExportInput) => {
  const out = await exportBoard(input)
  if (out.ok) shell.showItemInFolder(out.packagePath)
  return out
})

ipcMain.handle('export:animatic', async (_e, input: ExportInput, opts: AnimaticOptions) => {
  const out = await exportAnimatic(input, opts ?? {})
  if (out.ok) shell.showItemInFolder(out.videoPath)
  return out
})

ipcMain.handle('export:pdf', async (_e, input: ExportInput) => {
  const out = await exportPdf(input)
  if (out.ok) shell.showItemInFolder(out.pdfPath)
  return out
})

ipcMain.handle('export:shotlist', async (_e, input: ExportInput) => {
  const out = await exportShotList(input)
  if (out.ok) shell.showItemInFolder(out.csvPath)
  return out
})

/** Generic write used by the renderer for scratch frame extraction targets. */
ipcMain.handle('fs:ensureDir', async (_e, path: string) => {
  await mkdir(path, { recursive: true })
  return true
})

ipcMain.handle('app:versions', () => ({
  app: APP_VERSION,
  electron: process.versions.electron,
  node: process.versions.node
}))

ipcMain.handle('app:tempDir', () => app.getPath('temp'))

/**
 * Localhost-only HTTP control server. External agents (MCP clients, Codex,
 * Hermes, …) drive a running Storyboard Reference Studio by POSTing actions
 * here; each is forwarded to the renderer over IPC and its reply returned.
 *
 * Discovery + auth are file-based: on startup we write
 * ~/.config/storyboard-reference/control.json { port, token, pid } (mode 0600)
 * and delete it on quit. A client reads that file for the port and token.
 */

import { app, ipcMain, type BrowserWindow } from 'electron'
import http from 'http'
import crypto from 'crypto'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

interface Pending {
  resolve: (result: { ok: boolean; data?: unknown; error?: string }) => void
  timer: NodeJS.Timeout
}

const CONFIG_DIR = join(homedir(), '.config', 'storyboard-reference')
const DISCOVERY_FILE = join(CONFIG_DIR, 'control.json')
const MAX_BODY = 10 * 1024 * 1024 // 10 MB

function timeoutForAction(action: string): number {
  if (action === 'export_board' || action === 'export_animatic' || action === 'export_pdf') return 600_000
  if (action === 'describe_frame' || action === 'auto_board') return 300_000
  if (action === 'screenshot' || action === 'extract_frame') return 120_000
  return 30_000
}

export async function startControlServer(getWindow: () => BrowserWindow | null): Promise<void> {
  const token = crypto.randomBytes(24).toString('hex')
  const pending = new Map<string, Pending>()

  ipcMain.on('control:result', (_e, id: string, result: { ok: boolean; data?: unknown; error?: string }) => {
    const p = pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(id)
    p.resolve(result)
  })

  function invoke(action: string, params: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const win = getWindow()
    if (!win) return Promise.resolve({ ok: false, error: 'Studio window not open' })
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, error: 'timeout — is the app busy?' })
      }, timeoutForAction(action))
      pending.set(id, { resolve, timer })
      win.webContents.send('control:invoke', id, action, params ?? {})
    })
  }

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'GET' && req.url === '/health') {
      send(200, { ok: true, app: 'storyboard-reference' })
      return
    }

    if (req.method === 'POST' && req.url === '/rpc') {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${token}`) {
        send(401, { ok: false, error: 'unauthorized' })
        return
      }
      let body = ''
      let aborted = false
      req.on('data', (chunk: Buffer) => {
        body += chunk
        if (body.length > MAX_BODY) {
          aborted = true
          send(413, { ok: false, error: 'request body too large' })
          req.destroy()
        }
      })
      req.on('end', () => {
        if (aborted) return
        let parsed: { action?: unknown; params?: unknown }
        try {
          parsed = JSON.parse(body || '{}')
        } catch {
          send(400, { ok: false, error: 'invalid JSON body' })
          return
        }
        if (typeof parsed.action !== 'string') {
          send(400, { ok: false, error: 'missing "action"' })
          return
        }
        if (!getWindow()) {
          send(503, { ok: false, error: 'Studio window not open' })
          return
        }
        void invoke(parsed.action, parsed.params).then((result) => {
          if (result.error === 'timeout — is the app busy?') send(504, result)
          else send(200, result)
        })
      })
      return
    }

    send(404, { ok: false, error: 'not found' })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(
    DISCOVERY_FILE,
    JSON.stringify({ port, token, pid: process.pid, startedAt: new Date().toISOString() }),
    { mode: 0o600 }
  )

  app.on('will-quit', () => {
    void rm(DISCOVERY_FILE).catch(() => {})
  })

  console.log(`[storyboard-reference] control server on 127.0.0.1:${port}`)
}

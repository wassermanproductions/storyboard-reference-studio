/**
 * App shell: welcome screen, titlebar, the three-panel workspace + board,
 * global keyboard map, autosave, credits.
 */

import { useCallback, useEffect } from 'react'
import { useStore, currentProjectJson } from './store'
import { MediaBin } from './panels/MediaBin'
import { Viewer } from './panels/Viewer'
import { Inspector } from './panels/Inspector'
import { Board } from './panels/Board'
import { Toasts } from './panels/Toasts'
import { HelpOverlay } from './panels/Help'

function CreditLink({ url, children }: { url: string; children: string }): JSX.Element {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        void window.sbr.openExternal(url)
      }}
    >
      {children}
    </a>
  )
}

export function Credits(): JSX.Element {
  return (
    <div className="credits">
      Created by Sam Wasserman ·{' '}
      <CreditLink url="https://wassermanproductions.com">wassermanproductions.com</CreditLink> ·{' '}
      <CreditLink url="https://wasserman.ai">wasserman.ai</CreditLink>
      <br />
      Open source under Apache-2.0 — keep this credit when using or forking.
    </div>
  )
}

function Welcome(): JSX.Element {
  const newProject = useStore((s) => s.newProject)
  const loadFromJson = useStore((s) => s.loadFromJson)
  const toast = useStore((s) => s.toast)
  const setHelpOpen = useStore((s) => s.setHelpOpen)

  const onNew = useCallback(async () => {
    const folder = await window.sbr.newProjectDialog()
    if (!folder) return
    const name = folder.split(/[/\\]/).pop()?.replace(/\.sbref$/, '') ?? 'Untitled'
    newProject(folder, name)
    const json = currentProjectJson()
    if (json) await window.sbr.saveProject(folder, json)
  }, [newProject])

  const onOpen = useCallback(async () => {
    const folder = await window.sbr.openProjectDialog()
    if (!folder) return
    const { json, backupJson, backupNewer } = await window.sbr.loadProject(folder)
    if (!json && !backupJson) {
      toast('No project.json found in that folder.', 'error')
      return
    }
    if (backupNewer && backupJson && loadFromJson(folder, backupJson)) {
      toast('Restored unsaved work from the autosave backup — Save to keep it.', 'success')
      return
    }
    if (json && loadFromJson(folder, json)) return
    if (backupJson && loadFromJson(folder, backupJson)) {
      toast('Recovered from autosave backup.', 'success')
    }
  }, [loadFromJson, toast])

  return (
    <div className="welcome">
      <div className="wordmark">
        STORYBOARD
        <span className="sub">REFERENCE</span>
      </div>
      <p>
        Turn any reference imagery — movie clips, phone footage, pulled stills — into a storyboard of
        stills and image-generator-ready prompts.
      </p>
      <div className="actions">
        <button className="btn primary" onClick={onNew}>New Project</button>
        <button className="btn" onClick={onOpen}>Open Project…</button>
        <button className="btn" onClick={() => setHelpOpen(true)}>? Quick start</button>
      </div>
      <Credits />
    </div>
  )
}

function useAutosave(): void {
  const hasDoc = useStore((s) => s.doc !== null)
  const folder = useStore((s) => s.projectFolder)
  useEffect(() => {
    if (!hasDoc || !folder) return
    const interval = setInterval(() => {
      const json = currentProjectJson()
      if (json) void window.sbr.saveBackup(folder, json)
    }, 60_000)
    return () => clearInterval(interval)
  }, [hasDoc, folder])
}

interface Transport {
  togglePlay(): void
  step(frames: number): void
  bookmark(): void
  setIn(): void
  setOut(): void
}

function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (!s.doc) return
      const inField =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement
      const transport = (window as unknown as { __sbrTransport?: Transport }).__sbrTransport
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key === 's') {
        e.preventDefault()
        const json = currentProjectJson()
        if (json && s.projectFolder) void window.sbr.saveProject(s.projectFolder, json).then(() => s.markSaved())
        return
      }
      if (e.key === '?') {
        s.setHelpOpen(!s.helpOpen)
        return
      }
      if (e.key === 'Escape' && s.helpOpen) {
        s.setHelpOpen(false)
        return
      }
      if (inField) return

      if (e.key === ' ') {
        e.preventDefault()
        transport?.togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        transport?.step(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        transport?.step(1)
      } else if (e.key === 'i' || e.key === 'I') {
        transport?.setIn()
      } else if (e.key === 'o' || e.key === 'O') {
        transport?.setOut()
      } else if (e.key === 'b' || e.key === 'B') {
        transport?.bookmark()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (s.selectedFrameId) {
          const frame = s.frame(s.selectedFrameId)
          if (frame?.prompt?.text && !window.confirm('This frame has a prompt. Remove it?')) return
          s.removeFrame(s.selectedFrameId)
          const json = currentProjectJson()
          if (json && s.projectFolder) void window.sbr.saveProject(s.projectFolder, json)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const dirty = useStore((s) => s.dirty)
  const folder = useStore((s) => s.projectFolder)
  const markSaved = useStore((s) => s.markSaved)

  useAutosave()
  useKeyboard()

  const onSave = useCallback(async () => {
    const json = currentProjectJson()
    if (json && folder) {
      await window.sbr.saveProject(folder, json)
      markSaved()
    }
  }, [folder, markSaved])

  if (!doc) {
    return (
      <div className="app">
        <div className="titlebar">
          <span className="app-name">STORYBOARD REFERENCE</span>
        </div>
        <Welcome />
        <Toasts />
        <HelpOverlay />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="app-name">STORYBOARD REFERENCE</span>
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          {doc.name}
          {dirty ? ' •' : ''}
        </span>
        <div className="spacer" />
        <button className="btn small" onClick={onSave}>Save</button>
        <button className="btn small" onClick={() => useStore.getState().setHelpOpen(true)}>? Help</button>
      </div>
      <div className="workspace">
        <MediaBin />
        <Viewer />
        <Inspector />
        <Board />
      </div>
      <Toasts />
      <HelpOverlay />
    </div>
  )
}

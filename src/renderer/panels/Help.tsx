/**
 * Help overlay: quick-start cards, a searchable "How do I…?" list, and the
 * keyboard shortcut reference.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../store'

const CARDS = [
  { emoji: '📥', title: 'Import reference', body: 'Import videos, images, or an audio scratch track into the bin, or paste a screenshot straight from the clipboard.' },
  { emoji: '🎞️', title: 'Pull frames', body: 'Scrub a clip and Bookmark frames, or Auto-board a section by scene cuts, every N seconds, or a fixed count.' },
  { emoji: '✂️', title: 'Reframe & annotate', body: 'Select a card to reframe it on the stage with rule-of-thirds + action-safe guides, and draw camera-move arrows or action text.' },
  { emoji: '🎬', title: 'Present & export', body: 'Play the board as an animatic in Present mode, then export a board package, an animatic MP4, a PDF storyboard, or a shot-list CSV.' }
]

const TASKS = [
  { q: 'How do I add a frame from a video?', a: 'Open the clip, scrub to the moment, and click 📌 Bookmark (or press B). It becomes a board card.' },
  { q: 'How do I auto-detect shot changes?', a: 'Click ▦ Auto-board, choose Scene detect, and lower the sensitivity slider to find more cuts.' },
  { q: 'How do I crop to a target aspect?', a: 'Select the board card, pick an aspect under Reframe, and drag the overlay on the still. The crop is applied full-res on export.' },
  { q: 'How do I generate a prompt?', a: 'Select a card, choose a generator profile, and click ✨ Generate prompt. Edit it in place, then Copy prompt.' },
  { q: 'What if I have no API key?', a: 'Everything works offline except Generate. Use the Offline template controls to build a prompt scaffold from the frame’s metadata.' },
  { q: 'How do I prompt the whole board?', a: 'Click Prompt all missing on the board bar. It fills every card that has no prompt yet.' },
  { q: 'What does Export produce?', a: 'A folder with per-frame NN_label/still.png + prompt.txt, plus prompts.json, contact-sheet.png, and board.md. The Export ▾ menu also makes an animatic MP4, a PDF storyboard, and a shot-list CSV.' },
  { q: 'How do I set each frame’s duration?', a: 'Select a card and set Duration (s) in the inspector. It drives the animatic hold time and shows as a badge on the card.' },
  { q: 'How do I play the board?', a: 'Click ▶ Present on the board bar (or press P). Space plays/pauses, arrows step, M toggles the shot strip, Esc exits. A set scratch track plays in sync.' },
  { q: 'How do I draw camera moves?', a: 'Select a card, open Annotate in the inspector, pick Arrow (A) or Text (T) and a color, then drag or click on the stage. Guides toggle with G. Annotations export onto every still.' },
  { q: 'How do I fill the shot list?', a: 'Use the Shot section in the inspector — scene, shot, size, angle, lens, movement, transition — then export the shot-list CSV.' },
  { q: 'How do I add a scratch track?', a: 'Import an mp3/wav/m4a/aac. It appears in the bin; click it to set or unset it as the animatic track.' },
  { q: 'Where are my files?', a: 'Projects are .sbref folders: project.json plus a media/ folder of copied imports. Exports land in exports/.' }
]

const SHORTCUTS = [
  { k: 'Space', d: 'Play / pause the clip (or the animatic in Present)' },
  { k: '← / →', d: 'Step one frame back / forward' },
  { k: 'I / O', d: 'Set the IN / OUT point of the section' },
  { k: 'B', d: 'Bookmark the current frame' },
  { k: 'P', d: 'Present / play the board' },
  { k: 'A', d: 'Arrow annotation tool' },
  { k: 'T', d: 'Text annotation tool' },
  { k: 'G', d: 'Toggle rule-of-thirds + action-safe guides' },
  { k: 'M', d: 'Toggle the shot strip in Present mode' },
  { k: '⌘S', d: 'Save the project' },
  { k: '⌫', d: 'Remove the selected annotation, or the selected card' },
  { k: '?', d: 'Toggle this help' }
]

export function HelpOverlay(): JSX.Element | null {
  const open = useStore((s) => s.helpOpen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TASKS
    return TASKS.filter((t) => (t.q + ' ' + t.a).toLowerCase().includes(q))
  }, [query])

  if (!open) return null
  return (
    <div className="help-backdrop" onClick={() => setHelpOpen(false)}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>Help & quick start</h2>
          <button className="btn small" onClick={() => setHelpOpen(false)}>Close</button>
        </div>
        <div className="help-body">
          <div className="help-section-title">Quick start</div>
          <div className="help-cards">
            {CARDS.map((c) => (
              <div className="help-card" key={c.title}>
                <div className="help-card-emoji">{c.emoji}</div>
                <div className="help-card-title">{c.title}</div>
                <div className="help-card-body">{c.body}</div>
              </div>
            ))}
          </div>

          <div className="help-section-title">How do I…?</div>
          <input
            className="help-search"
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <div className="hint">No matching tasks.</div>
          ) : (
            filtered.map((t) => (
              <div className="help-task" key={t.q}>
                <div className="help-task-q">{t.q}</div>
                <div className="help-task-a">{t.a}</div>
              </div>
            ))
          )}

          <div className="help-section-title" style={{ marginTop: 24 }}>Shortcuts</div>
          {SHORTCUTS.map((s) => (
            <div className="help-kbd-row" key={s.k}>
              <div className="help-kbd-keys"><span className="help-kbd">{s.k}</span></div>
              <div className="help-kbd-desc">{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

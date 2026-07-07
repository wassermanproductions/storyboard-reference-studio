#!/usr/bin/env node
/**
 * Storyboard Reference Studio MCP server — zero-dependency Node >=18 stdio bridge.
 *
 * Speaks the MCP stdio transport: newline-delimited JSON-RPC 2.0 on
 * stdin/stdout. Each tools/call is forwarded to the running app's HTTP control
 * server, discovered via ~/.config/storyboard-reference/control.json (random
 * localhost port + bearer token). Uses only node built-ins + global fetch.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DISCOVERY_FILE = join(homedir(), '.config', 'storyboard-reference', 'control.json')
const PROTOCOL_VERSION = '2024-11-05'

// Each tool name maps to a control action of the SAME name; the tool's input
// object is passed through verbatim as that action's params.
const TOOLS = [
  {
    name: 'get_state',
    description:
      'Call FIRST. Returns the current project: imported media (id, kind, name, dimensions, duration) and the board frames (id, index, label, source time, whether it has a prompt, crop aspect).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'add_frame',
    description:
      'Add one board frame from a media item at a given source time (0 for images). Returns the new frame id.',
    inputSchema: {
      type: 'object',
      properties: {
        mediaId: { type: 'string', description: 'A media id from get_state.' },
        timeS: { type: 'number', description: 'Source time in seconds (0 for images).' },
        label: { type: 'string', description: 'Optional label, e.g. "SHOT 1A — HERO ENTERS".' }
      },
      required: ['mediaId'],
      additionalProperties: false
    }
  },
  {
    name: 'auto_board',
    description:
      'Extract many frames from a video section and add them all to the board. mode "scene" (scene-change detection), "interval" (every N seconds), or "count" (N evenly-spaced). Returns the added frame ids.',
    inputSchema: {
      type: 'object',
      properties: {
        mediaId: { type: 'string', description: 'A video media id from get_state.' },
        startS: { type: 'number', description: 'Section start in seconds (default 0).' },
        endS: { type: 'number', description: 'Section end in seconds (default clip end).' },
        mode: { type: 'string', enum: ['scene', 'interval', 'count'], description: 'Extraction mode.' },
        threshold: { type: 'number', description: 'Scene mode: 0.1 (many cuts) to 0.6 (few). Default 0.35.' },
        everyS: { type: 'number', description: 'Interval mode: seconds between frames. Default 2.' },
        count: { type: 'number', description: 'Count mode: number of frames. Default 6.' }
      },
      required: ['mediaId'],
      additionalProperties: false
    }
  },
  {
    name: 'set_label',
    description: 'Set a board frame’s label.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string', description: 'A frame id from get_state.' },
        label: { type: 'string', description: 'The new label text.' }
      },
      required: ['frameId', 'label'],
      additionalProperties: false
    }
  },
  {
    name: 'set_crop',
    description:
      'Set a board frame’s reframe crop. Coordinates are normalized (0..1) in source space. aspect is one of 16:9, 9:16, 1:1, 4:3, 2.39:1, free.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string', description: 'A frame id from get_state.' },
        aspect: { type: 'string', description: 'Target aspect, e.g. "16:9".' },
        x: { type: 'number', description: 'Left edge (0..1).' },
        y: { type: 'number', description: 'Top edge (0..1).' },
        w: { type: 'number', description: 'Width (0..1).' },
        h: { type: 'number', description: 'Height (0..1).' }
      },
      required: ['frameId'],
      additionalProperties: false
    }
  },
  {
    name: 'describe_frame',
    description:
      'Generate a per-frame prompt with Claude vision for the target generator profile (midjourney, flux, gpt-image, nano-banana, sdxl, generic). Returns the prompt text. Requires Claude credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string', description: 'A frame id from get_state.' },
        profileId: { type: 'string', description: 'Generator profile id. Defaults to the project default.' },
        context: { type: 'string', description: 'Optional extra context for the model.' }
      },
      required: ['frameId'],
      additionalProperties: false
    }
  },
  {
    name: 'extract_frame',
    description: 'Ensure a full-resolution still PNG exists on disk for a frame and return its absolute path.',
    inputSchema: {
      type: 'object',
      properties: { frameId: { type: 'string', description: 'A frame id from get_state.' } },
      required: ['frameId'],
      additionalProperties: false
    }
  },
  {
    name: 'export_board',
    description:
      'Export the whole board to a folder: per-frame still.png + prompt.txt, plus prompts.json, contact-sheet.png, and board.md. Returns the package path.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
]

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name))
const NOT_RUNNING = "Storyboard Reference Studio isn't running — launch the app first."

async function callControl(action, params) {
  let config
  try {
    config = JSON.parse(await readFile(DISCOVERY_FILE, 'utf-8'))
  } catch {
    return { error: NOT_RUNNING }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ action, params: params ?? {} })
    })
    return { response: await res.json() }
  } catch {
    return { error: NOT_RUNNING }
  }
}

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
function reply(id, result) {
  write({ jsonrpc: '2.0', id, result })
}
function replyError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleToolCall(id, params) {
  const name = params?.name
  const args = params?.arguments ?? {}
  if (!TOOL_NAMES.has(name)) {
    reply(id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true })
    return
  }
  const { response, error } = await callControl(name, args)
  if (error) {
    reply(id, { content: [{ type: 'text', text: error }], isError: true })
    return
  }
  reply(id, {
    content: [{ type: 'text', text: JSON.stringify(response) }],
    isError: response && response.ok === false
  })
}

async function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'storyboard-reference', version: '1.0.0' }
      })
      return
    case 'notifications/initialized':
      return
    case 'tools/list':
      reply(id, { tools: TOOLS })
      return
    case 'tools/call':
      await handleToolCall(id, params)
      return
    case 'ping':
      reply(id, {})
      return
    default:
      if (id !== undefined && id !== null) replyError(id, -32601, `Method not found: ${method}`)
      return
  }
}

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    void handle(msg)
  }
})
process.stdin.on('end', () => process.exit(0))

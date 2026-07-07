import type { SbrAPI } from '../preload/index'

declare global {
  interface Window {
    sbr: SbrAPI
  }
}

export {}

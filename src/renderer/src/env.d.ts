/// <reference types="vite/client" />
import type { YazApi } from '../../shared/types'

declare global {
  interface Window {
    api: YazApi
  }
}

export {}

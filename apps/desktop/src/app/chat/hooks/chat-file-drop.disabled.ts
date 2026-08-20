import type { DragEventHandler } from 'react'

export interface DroppedFile {
  file?: File
  path: string
  isDirectory?: boolean
  line?: number
  lineEnd?: number
}

export type DragKind = 'files' | 'session' | null

export function partitionDroppedFiles(_candidates: DroppedFile[]): {
  osDrops: DroppedFile[]
  inAppRefs: DroppedFile[]
} {
  return { inAppRefs: [], osDrops: [] }
}

export function useChatFileDropZone(_options: { enabled?: boolean; onDropFiles: (files: DroppedFile[]) => void }): {
  dragKind: DragKind
  dropHandlers: {
    onDragEnter?: DragEventHandler
    onDragLeave?: DragEventHandler
    onDragOver?: DragEventHandler
    onDrop?: DragEventHandler
    onDropCapture?: DragEventHandler
  }
} {
  return { dragKind: null, dropHandlers: {} }
}

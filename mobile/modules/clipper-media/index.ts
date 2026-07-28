import { requireNativeModule, EventEmitter, type Subscription } from 'expo-modules-core'

export interface ClipInput {
  id: string
  sourcePath: string
  start: number
  end: number
  title: string
}

export interface ProgressEvent {
  index: number
  total: number
  name: string
  progress: number
}

interface ClipperMediaNative {
  exportClips(options: {
    albumName: string
    clips: ClipInput[]
    burnSubtitle: boolean
    watermark: string
  }): Promise<{ ok: boolean; count: number; ids: string[] }>
  mergeClips(options: {
    albumName: string
    name: string
    clips: ClipInput[]
    burnSubtitle: boolean
    watermark: string
  }): Promise<{ ok: boolean; name: string }>
}

const native = requireNativeModule<ClipperMediaNative>('ClipperMedia')
const emitter = new EventEmitter(native as never)

export function onProgress(cb: (e: ProgressEvent) => void): Subscription {
  return emitter.addListener<ProgressEvent>('onProgress', cb)
}

export const ClipperMedia = native

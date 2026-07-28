import { requireNativeModule, EventEmitter, type Subscription } from 'expo-modules-core'

export interface ClipInput {
  id: string
  sourcePath: string
  start: number
  end: number
  title: string
  /** 跨视频片段的分段；为空则按 sourcePath/start/end 当单段处理 */
  segments?: Array<{ sourcePath: string; start: number; end: number }>
}

export interface ProgressEvent {
  index: number
  total: number
  name: string
  progress: number
}

interface ClipperMediaNative {
  /** 底边系统手势延后生效（横屏拖底部进度条时不误切 app） */
  setDeferBottomGesture(on: boolean): void
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

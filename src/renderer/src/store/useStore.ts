import { create } from 'zustand'
import type { AppState } from './types'
import type { SourceVideo } from '../types'
import { createTransportSlice } from './slices/transport'
import { createVideoSlice } from './slices/video'
import { createClipsSlice } from './slices/clips'
import { createTagsSlice } from './slices/tags'
import { createProjectSlice } from './slices/project'
import { createUiSlice } from './slices/ui'

export type { Direction, AppState } from './types'

/** 多视频时间线，按职责拆切片：transport/video/clips/tags/project/ui */
export const useStore = create<AppState>()((...a) => ({
  ...createTransportSlice(...a),
  ...createVideoSlice(...a),
  ...createClipsSlice(...a),
  ...createTagsSlice(...a),
  ...createProjectSlice(...a),
  ...createUiSlice(...a)
}))

/** 当前活动视频（<video> 加载的那个） */
export const selectActiveVideo = (s: AppState): SourceVideo | null =>
  s.videos.find((v) => v.id === s.activeVideoId) ?? null

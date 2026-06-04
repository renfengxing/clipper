import { create } from 'zustand'
import type { AppState } from './types'
import { createTransportSlice } from './slices/transport'
import { createVideoSlice } from './slices/video'
import { createClipsSlice } from './slices/clips'
import { createTagsSlice } from './slices/tags'
import { createProjectSlice } from './slices/project'
import { createUiSlice } from './slices/ui'

export type { Direction, AppState } from './types'

/**
 * 全局状态，按职责拆成切片（#85）：
 * transport 播放传输 · video 视频加载 · clips 片段标记/列表 ·
 * tags 标签/多选 · project 项目持久化 · ui 弹窗/快捷键/字幕
 * 每个切片创建器都拿到完整 AppState 的 set/get，跨切片调用走 get()。
 */
export const useStore = create<AppState>()((...a) => ({
  ...createTransportSlice(...a),
  ...createVideoSlice(...a),
  ...createClipsSlice(...a),
  ...createTagsSlice(...a),
  ...createProjectSlice(...a),
  ...createUiSlice(...a)
}))

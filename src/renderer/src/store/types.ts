import type { Clip, VideoState, ProjectData, Keybindings } from '../types'

export type Direction = 'forward' | 'reverse' | 'paused'

/** 视频加载 */
export interface VideoSlice {
  video: VideoState | null
  loadVideo: (path: string) => void
  closeVideo: () => void // 关闭当前视频（#72）
  openVideoPath: (path: string) => Promise<void> // 打开路径（含载入项目 + 记最近，#41）
  setDuration: (duration: number) => void
}

/** 播放传输：被快捷键、控制条、时间线共用 */
export interface TransportSlice {
  videoEl: HTMLVideoElement | null
  currentTime: number
  playing: boolean
  rate: number
  direction: Direction
  previewEnd: number | null // 预览片段时的停止点；null 表示未在预览
  setVideoEl: (el: HTMLVideoElement | null) => void
  setCurrentTime: (t: number) => void
  seek: (t: number) => void
  play: () => void // 正常 1x 正放（重置）
  pause: () => void // 暂停，保留当前速率/方向（#31）
  resume: () => void // 按当前速率/方向继续
  togglePlay: () => void
  speedUp: () => void // 快进（#30/#32）
  speedDown: () => void // 快退/倒放
  resetSpeed: () => void // 控速/慢放（#20）
  stepFrame: (dir: 1 | -1) => void // ← →：单帧
  jump: (sec: number) => void // Shift+← →：跳 N 秒
}

/** 片段标记与列表交互 */
export interface ClipsSlice {
  clips: Clip[]
  markIn: number | null
  markOut: number | null
  titleModalOpen: boolean
  resumeAfterModal: boolean // 打开标题框前是否在播放
  selectedClipId: string | null
  setMarkIn: () => void
  setMarkOut: () => void
  clearMarks: () => void
  openTitleModal: () => void
  closeTitleModal: () => void
  addClip: (title: string, tags?: string[]) => void
  selectClip: (id: string) => void
  deselectClip: () => void
  updateClipTitle: (id: string, title: string) => void
  updateClipTimes: (id: string, inSec: number, outSec: number) => void
  deleteClip: (id: string) => void
  reorderClips: (from: number, to: number) => void
  sortClipsByTime: () => void
}

/** 标签 / 多选 / AI 打标签 */
export interface TagsSlice {
  checkedIds: string[]
  activeTags: string[]
  showCheckedOnly: boolean
  videoTags: string[] // 本视频标签（#57）
  defaultTags: string[] // 系统标签（来自设置）
  aiTagging: boolean
  toggleChecked: (id: string) => void
  setChecked: (ids: string[]) => void
  clearChecked: () => void
  toggleActiveTag: (tag: string) => void
  clearActiveTags: () => void
  setShowCheckedOnly: (v: boolean) => void
  setDefaultTags: (tags: string[]) => void
  addVideoTag: (tag: string) => void
  removeVideoTag: (tag: string) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  aiAutoTag: () => Promise<{ ok: boolean; error?: string; code?: string }>
}

/** 项目持久化 */
export interface ProjectSlice {
  titleTemplate: string
  projectCreatedAt: string | null
  savedAt: string | null
  projectLoaded: boolean // 加载完成前不自动保存，避免覆盖
  exportHistory: Record<string, string>
  lastExportDir: string | null
  setExportHistory: (h: Record<string, string>) => void
  setLastExportDir: (dir: string) => void
  setTitleTemplate: (t: string) => void
  setSavedAt: (iso: string) => void
  hydrateProject: (data: ProjectData | null) => void
}

/** UI 状态：快捷键、全屏、字幕、各弹窗 */
export interface UiSlice {
  keybindings: Keybindings
  isFullscreen: boolean
  subtitleOn: boolean // 字幕开关（#75/#84）
  settingsOpen: boolean
  exportOpen: boolean
  mergeOpen: boolean
  reportOpen: boolean
  setKeybindings: (kb: Keybindings) => void
  setIsFullscreen: (v: boolean) => void
  toggleSubtitle: () => void
  openSettings: () => void
  closeSettings: () => void
  openExport: () => void
  closeExport: () => void
  openMerge: () => void
  closeMerge: () => void
  openReport: () => void
  closeReport: () => void
}

export type AppState = VideoSlice &
  TransportSlice &
  ClipsSlice &
  TagsSlice &
  ProjectSlice &
  UiSlice

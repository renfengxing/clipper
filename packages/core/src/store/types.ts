import type { Clip, SourceVideo, ProjectData, Keybindings } from '../types'
import type { Player } from '../ports'

export type Direction = 'forward' | 'reverse' | 'paused'

/** 视频集合 / 时间线（多视频，P0-P7） */
export interface VideoSlice {
  videos: SourceVideo[]
  activeVideoId: string | null // <video> 当前加载的视频
  timelineName: string
  timelinePath: string | null // .kkclip 文件路径（首次保存前为预定路径）
  addVideosFromPaths: (paths: string[]) => Promise<void> // 探测并追加
  chooseAndAddVideos: () => Promise<void> // 弹框多选添加
  removeVideo: (id: string) => void
  reorderVideos: (from: number, to: number) => void
  setActiveVideo: (id: string, local: number) => void // 切换活动视频并待 seek 到 local
  openVideoPath: (path: string) => Promise<void> // 打开 .kkclip 或裸视频
  closeVideo: () => void // 关闭整条时间线
}

/** 播放传输（全局时间线，跨文件） */
export interface TransportSlice {
  player: Player | null
  currentTime: number // 全局时间（跨所有视频）
  playing: boolean
  rate: number
  direction: Direction
  previewStart: number | null // 预览/循环起点（全局）
  previewEnd: number | null // 预览/循环终点（全局）
  pendingSeekLocal: number | null // 切 src 后待应用的局部 seek
  setPlayer: (p: Player | null) => void
  syncLocalTime: (local: number) => void // <video> timeupdate → 全局
  onVideoEnded: () => void // 当前视频播完 → 跨到下一个
  applyPendingSeek: () => void // 新 src 元数据就绪后应用待定 seek
  seek: (globalT: number) => void
  clearPreview: () => void // 停止"选中片段循环"（手动 scrub 时用，#108）
  play: () => void
  pause: () => void
  resume: () => void
  togglePlay: () => void
  speedUp: () => void
  speedDown: () => void
  resetSpeed: () => void
  stepFrame: (dir: 1 | -1) => void
  jump: (sec: number) => void
}

/** 片段标记与列表交互 */
export interface ClipsSlice {
  clips: Clip[]
  markIn: number | null // 全局时间
  markOut: number | null
  titleModalOpen: boolean
  resumeAfterModal: boolean
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
  updateClipTimes: (id: string, inSec: number, outSec: number) => void // 局部 in/out
  deleteClip: (id: string) => void
}

/** 标签 / 多选 / AI 打标签 */
export interface TagsSlice {
  checkedIds: string[]
  activeTags: string[]
  tagFilterMode: 'and' | 'or' // 多标签过滤：并且/或（#101，默认并且）
  showCheckedOnly: boolean
  videoTags: string[]
  defaultTags: string[]
  aiTagging: boolean
  toggleChecked: (id: string) => void
  setChecked: (ids: string[]) => void
  clearChecked: () => void
  toggleActiveTag: (tag: string) => void
  clearActiveTags: () => void
  setTagFilterMode: (m: 'and' | 'or') => void
  setShowCheckedOnly: (v: boolean) => void
  setDefaultTags: (tags: string[]) => void
  addVideoTag: (tag: string) => void
  removeVideoTag: (tag: string) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  aiAutoTag: () => Promise<{ ok: boolean; error?: string; code?: string }>
}

/** 项目持久化（时间线工程） */
export interface ProjectSlice {
  titleTemplate: string
  projectCreatedAt: string | null
  savedAt: string | null
  projectLoaded: boolean
  exportHistory: Record<string, string>
  lastExportDir: string | null
  report: string // 已生成的 AI 分析报告（随时间线保存，#107）
  reportAt: string | null
  setExportHistory: (h: Record<string, string>) => void
  setLastExportDir: (dir: string) => void
  setTitleTemplate: (t: string) => void
  setSavedAt: (iso: string) => void
  setReport: (text: string) => void
  hydrateProject: (raw: unknown, fallbackName: string) => void // 兼容 v2 与旧 .kkfb.json
}

/** UI 状态 */
export interface UiSlice {
  keybindings: Keybindings
  isFullscreen: boolean
  subtitleOn: boolean
  draggingSegment: boolean
  settingsOpen: boolean
  exportOpen: boolean
  mergeOpen: boolean
  reportOpen: boolean
  setKeybindings: (kb: Keybindings) => void
  setIsFullscreen: (v: boolean) => void
  toggleSubtitle: () => void
  setDraggingSegment: (v: boolean) => void
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

export type { ProjectData }

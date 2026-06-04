import type { StateCreator } from 'zustand'
import type { AppState, VideoSlice } from '../types'

function toMediaUrl(path: string): string {
  return 'media://local' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/** 打开/关闭视频时重置的全量状态（跨切片，由 set 统一覆盖） */
function resetState(): Partial<AppState> {
  return {
    clips: [],
    currentTime: 0,
    playing: false,
    rate: 1,
    direction: 'paused',
    markIn: null,
    markOut: null,
    titleModalOpen: false,
    resumeAfterModal: false,
    selectedClipId: null,
    previewEnd: null,
    projectCreatedAt: null,
    savedAt: null,
    projectLoaded: false,
    exportHistory: {},
    lastExportDir: null,
    checkedIds: [],
    activeTags: [],
    showCheckedOnly: false,
    videoTags: []
  }
}

export const createVideoSlice: StateCreator<AppState, [], [], VideoSlice> = (set, get) => ({
  video: null,

  loadVideo: (path) => {
    get().pause() // 取消倒放 rAF + 暂停
    set({
      ...resetState(),
      video: { path, fileName: basename(path), url: toMediaUrl(path), duration: 0, fps: 30 }
    })
  },

  closeVideo: () => {
    get().pause()
    set({ ...resetState(), video: null })
  },

  openVideoPath: async (path) => {
    if (get().video?.path === path) return // 已打开则不重开（#47）
    get().loadVideo(path)
    void window.api.addRecentFile(path)
    const data = await window.api.loadProject(path)
    get().hydrateProject(data)
    // 探测真实帧率，供单帧步进使用（修复 60fps 视频按 30 次才进 1 秒的问题）
    const fps = await window.api.probeFps(path)
    set((s) => (s.video && s.video.path === path ? { video: { ...s.video, fps } } : {}))
  },

  setDuration: (duration) => set((s) => (s.video ? { video: { ...s.video, duration } } : {}))
})

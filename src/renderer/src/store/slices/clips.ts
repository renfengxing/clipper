import type { StateCreator } from 'zustand'
import type { Clip } from '../../types'
import type { AppState, ClipsSlice } from '../types'

/** 标题去重：已存在则自动加 _02 _03（空标题允许重复，代表未命名） */
function uniqueTitle(title: string, existing: string[]): string {
  if (!title) return ''
  const set = new Set(existing)
  if (!set.has(title)) return title
  let n = 2
  let cand = `${title}_${String(n).padStart(2, '0')}`
  while (set.has(cand)) {
    n++
    cand = `${title}_${String(n).padStart(2, '0')}`
  }
  return cand
}

export const createClipsSlice: StateCreator<AppState, [], [], ClipsSlice> = (set, get) => ({
  clips: [],
  markIn: null,
  markOut: null,
  titleModalOpen: false,
  resumeAfterModal: false,
  selectedClipId: null,

  setMarkIn: () => {
    set({ markIn: get().currentTime })
    if (!get().playing) get().play() // 暂停时标记起点 → 自动开始播放
  },

  setMarkOut: () => {
    set({ markOut: get().currentTime })
    if (get().markIn != null) get().openTitleModal() // 标完出点自动弹命名框
  },

  clearMarks: () => set({ markIn: null, markOut: null, titleModalOpen: false }),

  openTitleModal: () => {
    const { markIn, markOut, playing } = get()
    if (markIn == null || markOut == null) return
    get().pause() // 命名时暂停，记住之前是否在播放
    set({ titleModalOpen: true, resumeAfterModal: playing })
  },

  // 取消命名 = 未设定终点：清出点、保留入点，继续等待按 N（#24）
  closeTitleModal: () => {
    const resume = get().resumeAfterModal
    set({ markOut: null, titleModalOpen: false, resumeAfterModal: false })
    if (resume) get().resume()
  },

  addClip: (title, tags) => {
    const t = title.trim()
    if (!t) {
      get().closeTitleModal() // 空标题视为取消（#24）
      return
    }
    const { markIn, markOut, clips, resumeAfterModal, videoTags } = get()
    if (markIn == null || markOut == null) return
    const lo = Math.min(markIn, markOut)
    const hi = Math.max(markIn, markOut)
    const cleanTags = Array.from(
      new Set((tags || []).map((x) => x.trim().slice(0, 15)).filter(Boolean))
    )
    const clip: Clip = {
      id: crypto.randomUUID(),
      in: lo,
      out: hi,
      title: uniqueTitle(t, clips.map((c) => c.title)),
      order: clips.length,
      created_at: new Date().toISOString(),
      tags: cleanTags
    }
    set({
      clips: [...clips, clip],
      videoTags: Array.from(new Set([...videoTags, ...cleanTags])), // 新标签并入视频标签
      markIn: null,
      markOut: null,
      titleModalOpen: false,
      resumeAfterModal: false
    })
    if (resumeAfterModal) get().resume()
  },

  // 选中即从入点播放，且只播放片段内容（到出点自动暂停，#27）
  selectClip: (id) => {
    const { clips, videoEl } = get()
    const clip = clips.find((c) => c.id === id)
    if (!clip || !videoEl) return
    get().pause() // 取消倒放 rAF
    videoEl.currentTime = clip.in
    videoEl.playbackRate = 1
    void videoEl.play()
    set({
      selectedClipId: id,
      currentTime: clip.in,
      playing: true,
      direction: 'forward',
      rate: 1,
      previewEnd: clip.out
    })
  },

  deselectClip: () => set({ selectedClipId: null }),

  updateClipTitle: (id, title) =>
    set((s) => {
      const others = s.clips.filter((c) => c.id !== id).map((c) => c.title)
      const unique = uniqueTitle(title.trim(), others)
      return { clips: s.clips.map((c) => (c.id === id ? { ...c, title: unique } : c)) }
    }),

  updateClipTimes: (id, inSec, outSec) =>
    set((s) => {
      const dur = s.video?.duration || 0
      const lo = Math.max(0, Math.min(inSec, outSec))
      const hi = Math.min(dur > 0 ? dur : Math.max(inSec, outSec), Math.max(inSec, outSec))
      return { clips: s.clips.map((c) => (c.id === id ? { ...c, in: lo, out: hi } : c)) }
    }),

  deleteClip: (id) =>
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })),
      selectedClipId: s.selectedClipId === id ? null : s.selectedClipId
    })),

  reorderClips: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.clips.length || to >= s.clips.length) {
        return {}
      }
      const arr = [...s.clips]
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      return { clips: arr.map((c, i) => ({ ...c, order: i })) }
    }),

  sortClipsByTime: () =>
    set((s) => ({
      clips: [...s.clips].sort((a, b) => a.in - b.in).map((c, i) => ({ ...c, order: i }))
    }))
})

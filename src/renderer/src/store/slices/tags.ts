import type { StateCreator } from 'zustand'
import type { AppState, TagsSlice } from '../types'

export const createTagsSlice: StateCreator<AppState, [], [], TagsSlice> = (set, get) => ({
  checkedIds: [],
  activeTags: [],
  tagFilterMode: 'and',
  showCheckedOnly: false,
  videoTags: [],
  defaultTags: [],
  aiTagging: false,

  toggleChecked: (id) =>
    set((s) => ({
      checkedIds: s.checkedIds.includes(id)
        ? s.checkedIds.filter((x) => x !== id)
        : [...s.checkedIds, id]
    })),
  setChecked: (ids) => set({ checkedIds: ids }),
  clearChecked: () => set({ checkedIds: [] }),
  toggleActiveTag: (tag) =>
    set((s) => ({
      activeTags: s.activeTags.includes(tag)
        ? s.activeTags.filter((x) => x !== tag)
        : [...s.activeTags, tag]
    })),
  clearActiveTags: () => set({ activeTags: [] }),
  setTagFilterMode: (m) => set({ tagFilterMode: m }),
  setShowCheckedOnly: (v) => set({ showCheckedOnly: v }),
  setDefaultTags: (tags) => set({ defaultTags: tags }),

  addVideoTag: (tag) =>
    set((s) => {
      const t = tag.trim().slice(0, 15)
      if (!t || s.videoTags.includes(t)) return {}
      return { videoTags: [...s.videoTags, t] }
    }),
  removeVideoTag: (tag) =>
    set((s) => ({
      videoTags: s.videoTags.filter((x) => x !== tag),
      activeTags: s.activeTags.filter((x) => x !== tag),
      clips: s.clips.map((c) => ({ ...c, tags: (c.tags || []).filter((x) => x !== tag) }))
    })),

  addTag: (id, tag) =>
    set((s) => {
      const t = tag.trim().slice(0, 15)
      if (!t) return {}
      return {
        videoTags: s.videoTags.includes(t) ? s.videoTags : [...s.videoTags, t],
        clips: s.clips.map((c) =>
          c.id === id && !(c.tags || []).includes(t) ? { ...c, tags: [...(c.tags || []), t] } : c
        )
      }
    }),
  removeTag: (id, tag) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, tags: (c.tags || []).filter((x) => x !== tag) } : c
      )
    })),

  // #50：AI 自动打标签
  aiAutoTag: async () => {
    const { clips, videoTags } = get()
    if (clips.length === 0) return { ok: false, error: '没有片段' }
    set({ aiTagging: true })
    const res = await window.api.autoTag(
      clips.map((c) => ({ title: c.title })),
      videoTags
    )
    if (res.ok && res.tags) {
      const tagsByClip = res.tags
      const newVideoTags = new Set(get().videoTags)
      const clipsNow = get().clips.map((c, i) => {
        const incoming = (tagsByClip[i] || []).map((t) => t.trim().slice(0, 15)).filter(Boolean)
        incoming.forEach((t) => newVideoTags.add(t))
        return { ...c, tags: Array.from(new Set([...(c.tags || []), ...incoming])) }
      })
      set({ clips: clipsNow, videoTags: Array.from(newVideoTags), aiTagging: false })
      return { ok: true }
    }
    set({ aiTagging: false })
    return { ok: false, error: res.error, code: res.code }
  }
})

import type { StateCreator } from 'zustand'
import type { AppState, TransportSlice } from '../types'

// 三段式速率（#30）：快进/快退/控速各管一段，连按在段内循环
const FAST = [2, 4, 8] // L 快进（正放快放）
const REV = [2, 4] // J 快退（倒放，#68）
const SLOW = [1, 0.25, 0.1] // K 控速（正放正常→慢放，#88 去掉 0.5）

export const createTransportSlice: StateCreator<AppState, [], [], TransportSlice> = (set, get) => {
  // 倒放用 rAF 手动回退 currentTime（Chromium 不支持负 playbackRate）
  let raf = 0
  let lastTs = 0

  const stopReverse = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    lastTs = 0
  }

  const reverseTick = (ts: number): void => {
    const { videoEl, rate } = get()
    if (!videoEl) return stopReverse()
    if (lastTs) {
      const dt = (ts - lastTs) / 1000
      const t = videoEl.currentTime - dt * rate
      if (t <= 0) {
        videoEl.currentTime = 0
        set({ currentTime: 0, playing: false, direction: 'paused', rate: 1 })
        return stopReverse()
      }
      videoEl.currentTime = t
      set({ currentTime: t })
    }
    lastTs = ts
    raf = requestAnimationFrame(reverseTick)
  }

  // 按带符号速率播放（v>0 正放，v<0 倒放，v=0 暂停）
  const applySigned = (v: number): void => {
    const { videoEl } = get()
    if (!videoEl) return
    if (v > 0) {
      stopReverse()
      videoEl.playbackRate = v
      void videoEl.play()
      set({ playing: true, direction: 'forward', rate: v })
    } else if (v < 0) {
      videoEl.pause()
      stopReverse()
      set({ playing: true, direction: 'reverse', rate: -v })
      raf = requestAnimationFrame(reverseTick)
    } else {
      get().pause()
    }
  }

  return {
    videoEl: null,
    currentTime: 0,
    playing: false,
    rate: 1,
    direction: 'paused',
    previewEnd: null,

    setVideoEl: (el) => set({ videoEl: el }),

    setCurrentTime: (t) => {
      // 预览片段：到达出点自动暂停
      const { previewEnd } = get()
      if (previewEnd != null && t >= previewEnd) {
        set({ currentTime: previewEnd })
        get().pause()
        return
      }
      set({ currentTime: t })
    },

    seek: (t) => {
      const { videoEl, video } = get()
      if (!videoEl) return
      const dur = video?.duration || 0
      const clamped = Math.max(0, dur > 0 ? Math.min(dur, t) : t)
      videoEl.currentTime = clamped
      set({ currentTime: clamped })
    },

    play: () => {
      const { videoEl } = get()
      if (!videoEl) return
      stopReverse()
      videoEl.playbackRate = 1
      void videoEl.play()
      set({ playing: true, direction: 'forward', rate: 1 })
    },

    pause: () => {
      const { videoEl } = get()
      stopReverse()
      videoEl?.pause()
      // 保留 direction/rate，下次 resume 用同速继续（#31）
      set({ playing: false, previewEnd: null })
    },

    resume: () => {
      const { direction, rate } = get()
      applySigned(direction === 'reverse' ? -rate : rate || 1)
    },

    togglePlay: () => (get().playing ? get().pause() : get().resume()),

    // 快进（L）：正放快放 2→4→8→2x（循环，#32）
    speedUp: () => {
      const { playing, direction, rate } = get()
      const inFast = playing && direction === 'forward' && FAST.includes(rate)
      applySigned(inFast ? FAST[(FAST.indexOf(rate) + 1) % FAST.length] : FAST[0])
    },

    // 快退（J）：倒放 2→4→2x（循环，#32/#68）
    speedDown: () => {
      const { playing, direction, rate } = get()
      const inRev = playing && direction === 'reverse' && REV.includes(rate)
      applySigned(inRev ? -REV[(REV.indexOf(rate) + 1) % REV.length] : -REV[0])
    },

    // 控速（K）：正放正常→慢放循环 1→0.5→0.25→0.1→1（#20+#30）
    resetSpeed: () => {
      const { playing, direction, rate } = get()
      const inSlow = playing && direction === 'forward' && SLOW.includes(rate)
      applySigned(inSlow ? SLOW[(SLOW.indexOf(rate) + 1) % SLOW.length] : SLOW[0])
    },

    stepFrame: (dir) => {
      const { videoEl, video } = get()
      if (!videoEl) return
      const fps = video?.fps && video.fps > 0 ? video.fps : 30 // 用真实帧率（#帧率bug）
      get().pause()
      get().seek(videoEl.currentTime + dir / fps)
    },

    jump: (sec) => {
      const { videoEl } = get()
      if (!videoEl) return
      get().seek(videoEl.currentTime + sec)
    }
  }
}

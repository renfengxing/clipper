import type { StateCreator } from 'zustand'
import type { AppState, TransportSlice } from '../types'
import { ordered, totalDuration, globalToLocal, videoOffset } from '../../utils/timeline'

const FAST = [2, 4, 8]
const REV = [2, 4]
const SLOW = [1, 0.25, 0.1]

export const createTransportSlice: StateCreator<AppState, [], [], TransportSlice> = (set, get) => {
  let raf = 0
  let lastTs = 0

  const stopReverse = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    lastTs = 0
  }

  // 倒放：手动回退全局 currentTime，并把当前所在视频的 <video> 定位到局部时间（跨文件切 src）
  const reverseTick = (ts: number): void => {
    const { player, rate, videos, activeVideoId } = get()
    if (videos.length === 0) return stopReverse()
    if (lastTs) {
      const dt = (ts - lastTs) / 1000
      const T = get().currentTime - dt * rate
      if (T <= 0) {
        const first = ordered(videos)[0]
        set({ currentTime: 0, playing: false, direction: 'paused', rate: 1 })
        if (first && activeVideoId !== first.id) set({ activeVideoId: first.id, pendingSeekLocal: 0 })
        else player?.seekLocal(0)
        return stopReverse()
      }
      const loc = globalToLocal(videos, T)
      set({ currentTime: T })
      if (loc) {
        if (loc.video.id === activeVideoId) {
          player?.seekLocal(loc.local)
        } else {
          set({ activeVideoId: loc.video.id, pendingSeekLocal: loc.local })
        }
      }
    }
    lastTs = ts
    raf = requestAnimationFrame(reverseTick)
  }

  const applySigned = (v: number): void => {
    const el = get().player
    if (v > 0) {
      stopReverse()
      set({ playing: true, direction: 'forward', rate: v })
      if (el) {
        el.setRate(v)
        el.play()
      }
    } else if (v < 0) {
      stopReverse()
      el?.pause()
      set({ playing: true, direction: 'reverse', rate: -v })
      raf = requestAnimationFrame(reverseTick)
    } else {
      get().pause()
    }
  }

  return {
    player: null,
    currentTime: 0,
    playing: false,
    rate: 1,
    direction: 'paused',
    previewStart: null,
    previewEnd: null,
    pendingSeekLocal: null,

    setPlayer: (p) => set({ player: p }),

    applyPendingSeek: () => {
      const { player, pendingSeekLocal, playing, direction, rate } = get()
      if (!player) return
      if (pendingSeekLocal != null) {
        player.seekLocal(pendingSeekLocal)
        set({ pendingSeekLocal: null })
      }
      if (playing && direction === 'forward') {
        player.setRate(rate)
        player.play()
      }
    },

    syncLocalTime: (local) => {
      const { videos, activeVideoId, previewEnd, previewStart } = get()
      if (!activeVideoId) return
      const T = videoOffset(videos, activeVideoId) + local
      if (previewEnd != null && T >= previewEnd) {
        // 选中片段循环播放：回到起点继续（#102）
        if (previewStart != null) {
          get().seek(previewStart)
          return
        }
        set({ currentTime: previewEnd })
        get().pause()
        return
      }
      set({ currentTime: T })
    },

    onVideoEnded: () => {
      const { videos, activeVideoId, playing, direction } = get()
      const list = ordered(videos)
      const idx = list.findIndex((v) => v.id === activeVideoId)
      if (playing && direction === 'forward' && idx >= 0 && idx < list.length - 1) {
        const next = list[idx + 1]
        set({ activeVideoId: next.id, pendingSeekLocal: 0, currentTime: videoOffset(videos, next.id) })
      } else {
        get().pause()
      }
    },

    seek: (globalT) => {
      const { videos } = get()
      if (videos.length === 0) return
      const total = totalDuration(videos)
      const T = Math.max(0, total > 0 ? Math.min(total, globalT) : globalT)
      const loc = globalToLocal(videos, T)
      if (!loc) return
      set({ currentTime: T })
      if (loc.video.id === get().activeVideoId) {
        get().player?.seekLocal(loc.local)
      } else {
        set({ activeVideoId: loc.video.id, pendingSeekLocal: loc.local })
      }
    },

    clearPreview: () => set({ previewStart: null, previewEnd: null }),

    play: () => {
      const { videos } = get()
      if (videos.length === 0) return
      if (!get().activeVideoId) {
        const first = ordered(videos)[0]
        set({ activeVideoId: first.id, pendingSeekLocal: 0, currentTime: 0 })
      }
      stopReverse()
      set({ playing: true, direction: 'forward', rate: 1 })
      const el = get().player
      if (el) {
        el.setRate(1)
        el.play()
      }
    },

    pause: () => {
      stopReverse()
      get().player?.pause()
      set({ playing: false, previewStart: null, previewEnd: null })
    },

    resume: () => {
      const { direction, rate } = get()
      applySigned(direction === 'reverse' ? -rate : rate || 1)
    },

    togglePlay: () => (get().playing ? get().pause() : get().resume()),

    // 快进（L）：正放 2→4→8→2x
    speedUp: () => {
      const { playing, direction, rate } = get()
      const inFast = playing && direction === 'forward' && FAST.includes(rate)
      applySigned(inFast ? FAST[(FAST.indexOf(rate) + 1) % FAST.length] : FAST[0])
    },

    // 快退（J）：倒放 2→4→2x
    speedDown: () => {
      const { playing, direction, rate } = get()
      const inRev = playing && direction === 'reverse' && REV.includes(rate)
      applySigned(inRev ? -REV[(REV.indexOf(rate) + 1) % REV.length] : -REV[0])
    },

    // 控速（K）：正常→慢放 1→0.25→0.1→1
    resetSpeed: () => {
      const { playing, direction, rate } = get()
      const inSlow = playing && direction === 'forward' && SLOW.includes(rate)
      applySigned(inSlow ? SLOW[(SLOW.indexOf(rate) + 1) % SLOW.length] : SLOW[0])
    },

    stepFrame: (dir) => {
      const { videos, activeVideoId } = get()
      const v = videos.find((x) => x.id === activeVideoId)
      const fps = v?.fps && v.fps > 0 ? v.fps : 30
      get().pause()
      get().seek(get().currentTime + dir / fps)
    },

    jump: (sec) => get().seek(get().currentTime + sec)
  }
}

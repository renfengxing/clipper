import type { SourceVideo, Clip } from '../types'

/** 按 order 排序的视频 */
export function ordered(videos: SourceVideo[]): SourceVideo[] {
  return [...videos].sort((a, b) => a.order - b.order)
}

/** 时间线总时长（所有视频时长之和） */
export function totalDuration(videos: SourceVideo[]): number {
  return videos.reduce((s, v) => s + (v.duration || 0), 0)
}

/** 某视频在全局时间线上的起始偏移（其前面所有视频时长之和） */
export function videoOffset(videos: SourceVideo[], videoId: string): number {
  let off = 0
  for (const v of ordered(videos)) {
    if (v.id === videoId) return off
    off += v.duration || 0
  }
  return off
}

/** 全局时间 → { 视频, 局部时间 }；越界则钳到首/尾视频 */
export function globalToLocal(
  videos: SourceVideo[],
  globalT: number
): { video: SourceVideo; local: number } | null {
  const list = ordered(videos)
  if (list.length === 0) return null
  let t = Math.max(0, globalT)
  for (const v of list) {
    const d = v.duration || 0
    if (t < d || v === list[list.length - 1]) {
      return { video: v, local: Math.max(0, Math.min(d, t)) }
    }
    t -= d
  }
  const last = list[list.length - 1]
  return { video: last, local: last.duration || 0 }
}

/** (视频, 局部时间) → 全局时间 */
export function localToGlobal(videos: SourceVideo[], videoId: string, local: number): number {
  return videoOffset(videos, videoId) + local
}

/** 片段在全局时间线上的起点（用于排序/定位） */
export function clipGlobalIn(videos: SourceVideo[], clip: Clip): number {
  return localToGlobal(videos, clip.videoId, clip.in)
}

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

/** 片段在全局时间线上的终点 */
export function clipGlobalOut(videos: SourceVideo[], clip: Clip): number {
  return localToGlobal(videos, clip.endVideoId || clip.videoId, clip.out)
}

/**
 * 把片段按视频切成若干段。不跨视频时就是一段。
 * 落盘、导出、时间线绘制都用它，避免各处各写一遍边界逻辑。
 */
export function clipSegments(
  videos: SourceVideo[],
  clip: Clip
): Array<{ video: SourceVideo; in: number; out: number }> {
  const list = ordered(videos)
  const startIdx = list.findIndex((v) => v.id === clip.videoId)
  if (startIdx < 0) return []
  const endId = clip.endVideoId || clip.videoId
  const endIdx = list.findIndex((v) => v.id === endId)
  if (endIdx < 0 || endIdx < startIdx) {
    return [{ video: list[startIdx], in: clip.in, out: clip.out }]
  }
  const out: Array<{ video: SourceVideo; in: number; out: number }> = []
  for (let i = startIdx; i <= endIdx; i++) {
    const v = list[i]
    const segIn = i === startIdx ? clip.in : 0
    const segOut = i === endIdx ? clip.out : v.duration || 0
    if (segOut - segIn > 0.02) out.push({ video: v, in: segIn, out: segOut })
  }
  return out
}

/** 是否跨了视频 */
export function isSpanning(clip: Clip): boolean {
  return !!clip.endVideoId && clip.endVideoId !== clip.videoId
}

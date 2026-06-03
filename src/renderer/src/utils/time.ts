/** 秒 → mm:ss（用于时间线刻度、列表显示） */
export function fmtClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/** 秒 → mm:ss.ss（带两位小数，用于 I/O 浮窗精确显示） */
export function fmtPrecise(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

/** 秒 → mm:ss.fff（毫秒级，用于播放进度显示） */
export function fmtMs(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

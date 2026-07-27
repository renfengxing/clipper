import type { Clip, ExportProgress } from './types'

/**
 * 平台端口（ports & adapters）。
 * 业务逻辑（store 切片）只依赖这些接口，不直接碰 window.api / DOM，
 * 这样同一套逻辑能在桌面（Electron）和 iOS（React Native）上各配一个实现。
 *
 * 注意 videoRef 的含义按平台不同：
 *   桌面 = 文件绝对路径；iOS = 相册 PHAsset 的 localIdentifier。
 * 逻辑层只当它是不透明字符串，不做路径假设。
 */

export interface Settings {
  deepseek_api_key: string
  default_tags: string[]
  keybindings: Record<string, string>
  recent_files?: string[]
  last_timeline?: string
  [k: string]: unknown
}

export interface ExportClipInput {
  videoRef: string
  in: number
  out: number
  title: string
  tags?: string[]
}

export interface ExportResult {
  exported: number
  skipped: number
  failed: number
  exports: Record<string, string>
}

export interface Platform {
  // —— 视频 ——
  /** 探测时长与帧率 */
  probeVideo(videoRef: string): Promise<{ duration: number; fps: number }>
  /** 选择视频（桌面=文件对话框；iOS=相册选择器），可多选 */
  pickVideos(): Promise<string[]>
  /** videoRef → 播放器能用的 URL */
  resolveUrl(videoRef: string): string
  /** 该视频是否还在 */
  exists(videoRef: string): Promise<boolean>
  /** 展示用名称 */
  displayName(videoRef: string): string

  // —— 工程数据（key 由逻辑层给，存哪由平台决定）——
  /** 某视频的片段数据 key（桌面=sidecar 路径；iOS=沙盒内以 assetId 命名） */
  clipsKeyFor(videoRef: string): string
  /** 时间线数据 key */
  timelineKeyFor(videoRef: string): string
  loadData(key: string): Promise<unknown | null>
  saveData(key: string, data: unknown): Promise<void>
  dataExists(key: string): Promise<boolean>

  // —— 设置 / 最近 ——
  getSettings(): Promise<Settings>
  setSettings(partial: Partial<Settings>): Promise<void>
  getRecent(): Promise<string[]>
  addRecent(key: string): Promise<void>

  // —— AI ——
  autoTag(
    clips: Array<{ title: string }>,
    videoTags: string[]
  ): Promise<{ ok: boolean; tags?: string[][]; code?: string; error?: string }>
  report(
    clips: Array<{ title: string; in: number; out: number; tags?: string[] }>
  ): Promise<{ ok: boolean; report?: string; code?: string; error?: string }>

  // —— 导出 / 合并 ——
  exportClips(opts: {
    outDir: string
    clips: ExportClipInput[]
    skipExisting: boolean
    priorExports?: Record<string, string>
    watermark?: string
  }): Promise<ExportResult>
  mergeClips(opts: {
    outDir: string
    name: string
    clips: ExportClipInput[]
    burnSubtitle?: boolean
    watermark?: string
  }): Promise<{ ok: boolean; outPath?: string; error?: string }>
  onExportProgress(cb: (p: ExportProgress) => void): () => void

  // —— 平台特有（可选，没有就不实现）——
  openFolder?(path: string): void
  toggleFullscreen?(): void
  saveReport?(content: string, defaultName: string): Promise<unknown>
}

/** 播放器端口：桌面包 <video>，iOS 包 react-native-video 的 ref */
export interface Player {
  /** 定位到「当前已加载视频」内的局部时间（秒） */
  seekLocal(sec: number): void
  play(): void
  pause(): void
  setRate(rate: number): void
}

/** 供导出/合并复用：把 clip 映射成带 videoRef 的输入 */
export function toExportInput(clip: Clip, videoRef: string): ExportClipInput {
  return { videoRef, in: clip.in, out: clip.out, title: clip.title, tags: clip.tags }
}

// —— 单例注入（app 启动时由各平台入口调用 setPlatform）——
let platformImpl: Platform | null = null

export function setPlatform(p: Platform): void {
  platformImpl = p
}

export function platform(): Platform {
  if (!platformImpl) throw new Error('Platform 尚未注入：应用启动时需调用 setPlatform()')
  return platformImpl
}

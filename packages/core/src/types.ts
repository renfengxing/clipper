/** 时间线里的一个源视频（多视频，P0-P7） */
export interface SourceVideo {
  id: string // 稳定 uuid，clip.videoId 引用它（文件移动只改 path 不动 id）
  path: string // 源文件绝对路径（加载/导出/合并的依据，必须存盘）
  fileName: string
  url: string // media:// 地址
  duration: number // 时长（秒），由主进程 ffmpeg 探测
  fps: number // 帧率
  order: number // 在时间线中的顺序
  missing?: boolean // 文件缺失（路径不存在）
}

/** 一个标记片段 —— in/out 是相对所属视频的局部时间 */
export interface Clip {
  id: string
  videoId: string // 起点所在的源视频
  /**
   * 终点所在的源视频。缺省 = 与 videoId 相同（不跨视频）。
   * 跨视频的片段在时间线上是连续的一段，落盘时按视频拆成几截、
   * 各存进自己的 sidecar，靠 clip id 重新拼回来。
   */
  endVideoId?: string
  in: number // 入点（秒，videoId 内的局部时间）
  out: number // 出点（秒，endVideoId 内的局部时间）
  title: string
  order: number
  created_at: string
  tags?: string[]
}

/** 时间线工程文件 .kkclip（v2，多视频） */
export interface ProjectData {
  version: string
  app_name?: string
  name: string // 时间线显示名
  created_at: string
  updated_at: string
  title_template?: string
  videos: SourceVideo[]
  clips: Clip[]
  video_tags?: string[]
  last_export_dir?: string | null
  exports?: Record<string, string>
}

/** 可配置快捷键（存 e.code，规格外 #23） */
export interface Keybindings {
  speedUp: string
  speedDown: string
  reset: string
  mark: string
  playPause: string
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  speedUp: 'KeyL',
  speedDown: 'KeyJ',
  reset: 'KeyK',
  mark: 'KeyN',
  playPause: 'Space'
}

/** 导出进度（与主进程 ffmpeg 模块对应） */
export interface ExportProgress {
  index: number
  total: number
  name: string
  status: 'running' | 'done' | 'skipped' | 'failed'
  error?: string
}

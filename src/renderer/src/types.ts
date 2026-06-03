/** 一个标记片段 —— 对应规格文档 7.1 的 clips[] 元素 */
export interface Clip {
  id: string
  in: number // 入点（秒）
  out: number // 出点（秒）
  title: string
  order: number
  created_at: string
  tags?: string[] // 标签（#46）
}

/** 项目文件结构（规格 7.1） */
export interface ProjectData {
  version: string
  app_name?: string
  source_video: string
  video_duration: number
  created_at: string
  updated_at: string
  title_template: string
  clips: Clip[]
  last_export_dir?: string | null
  exports?: Record<string, string>
  video_tags?: string[]
}

/** 可配置快捷键（存 e.code，规格外 #23） */
export interface Keybindings {
  speedUp: string // 快进
  speedDown: string // 快退
  reset: string // 重置正常速度
  mark: string // 标起点/终点（切换）
  playPause: string // 暂停/继续
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

/** 当前加载的视频信息 */
export interface VideoState {
  /** 源文件绝对路径 */
  path: string
  /** 文件名（用于标题栏与项目文件命名） */
  fileName: string
  /** media:// 协议地址，可直接喂给 <video src> */
  url: string
  /** 时长（秒），加载元数据后填入 */
  duration: number
}

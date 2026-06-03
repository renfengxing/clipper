import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'

/** 项目文件结构（规格 7.1） */
export interface ProjectFile {
  version: string
  app_name?: string
  source_video: string
  video_duration: number
  created_at: string
  updated_at: string
  title_template: string
  clips: Array<{
    id: string
    in: number
    out: number
    title: string
    order: number
    created_at: string
    tags?: string[]
  }>
  /** 上次导出目录（规格外·记住目录） */
  last_export_dir?: string | null
  /** 导出记录：key=`${标题}|${入点}` → 文件名（增量导出去重） */
  exports?: Record<string, string>
  /** 本视频的标签列表（#57） */
  video_tags?: string[]
}

/** 与源视频同目录：<视频名>.kkfb.json */
export function projectPathFor(videoPath: string): string {
  return videoPath + '.kkfb.json'
}

export function loadProject(videoPath: string): ProjectFile | null {
  const p = projectPathFor(videoPath)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ProjectFile
  } catch {
    return null // 损坏文件忽略，不覆盖（交由后续保存重建）
  }
}

/** 临时文件 + 原子 rename，避免崩溃损坏 JSON（规格 八·容灾） */
export function saveProject(videoPath: string, data: ProjectFile): string {
  const p = projectPathFor(videoPath)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, p)
  return p
}

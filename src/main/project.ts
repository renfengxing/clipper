import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'

/**
 * 时间线工程文件 .kkclip（只存视频"摆放顺序"，不存片段；片段随视频存到各自 sidecar）。
 * 片段数据在每个视频旁边的 `<视频>.kkfb.json` 里（#96）。
 */
export interface ProjectFile {
  version: string
  app_name?: string
  name: string
  created_at: string
  updated_at: string
  videos: Array<{
    path: string
    fileName: string
    duration: number
    fps: number
    order: number
  }>
  video_tags?: string[]
  last_export_dir?: string | null
  exports?: Record<string, string>
}

/** 通用读取（.kkclip 或旧 .kkfb.json），返回解析后的对象，损坏/不存在则 null。迁移由渲染层判断 shape。 */
export function loadProject(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/** 临时文件 + 原子 rename 写任意 JSON（容灾）。用于 .kkclip 和每个视频的 .kkfb.json sidecar。 */
export function saveJson(path: string, data: unknown): string {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, path)
  return path
}

export function fileExists(path: string): boolean {
  return existsSync(path)
}

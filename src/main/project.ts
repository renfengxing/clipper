import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'

/** 时间线工程文件 .kkclip（v2，多视频）。注意 videos 存 path，不存 url（url 由渲染层重建）。 */
export interface ProjectFile {
  version: string
  app_name?: string
  name: string
  created_at: string
  updated_at: string
  title_template?: string
  videos: Array<{
    id: string
    path: string
    fileName: string
    duration: number
    fps: number
    order: number
  }>
  clips: Array<{
    id: string
    videoId: string
    in: number
    out: number
    title: string
    order: number
    created_at: string
    tags?: string[]
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

/** 临时文件 + 原子 rename 写盘（容灾） */
export function saveProject(path: string, data: ProjectFile): string {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, path)
  return path
}

export function fileExists(path: string): boolean {
  return existsSync(path)
}

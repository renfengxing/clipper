import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { APP_NAME } from '../constants'

/**
 * 自动保存：时间线（videos + clips + 标签…）变化后防抖 500ms 写 .kkclip。
 * projectLoaded 前不写，避免空数据覆盖。
 */
export function useAutoSave(): void {
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const timelineName = useStore((s) => s.timelineName)
  const titleTemplate = useStore((s) => s.titleTemplate)
  const videoTags = useStore((s) => s.videoTags)
  const exportHistory = useStore((s) => s.exportHistory)
  const lastExportDir = useStore((s) => s.lastExportDir)
  const projectLoaded = useStore((s) => s.projectLoaded)
  const timelinePath = useStore((s) => s.timelinePath)

  useEffect(() => {
    if (!timelinePath || !projectLoaded || videos.length === 0) return
    const timer = window.setTimeout(async () => {
      const s = useStore.getState()
      if (!s.timelinePath || s.videos.length === 0) return
      const created = s.projectCreatedAt || new Date().toISOString()
      if (!s.projectCreatedAt) useStore.setState({ projectCreatedAt: created })
      const data = {
        version: '2.0',
        app_name: APP_NAME,
        name: s.timelineName,
        created_at: created,
        updated_at: new Date().toISOString(),
        title_template: s.titleTemplate,
        videos: s.videos.map((v) => ({
          id: v.id,
          path: v.path,
          fileName: v.fileName,
          duration: v.duration,
          fps: v.fps,
          order: v.order
        })),
        clips: s.clips.map((c) => ({
          id: c.id,
          videoId: c.videoId,
          in: c.in,
          out: c.out,
          title: c.title,
          order: c.order,
          created_at: c.created_at,
          tags: c.tags || []
        })),
        video_tags: s.videoTags,
        exports: s.exportHistory,
        last_export_dir: s.lastExportDir
      }
      try {
        await window.api.saveProject(s.timelinePath, data)
        useStore.getState().setSavedAt(new Date().toISOString())
      } catch (err) {
        console.error('自动保存失败:', err)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [clips, videos, timelineName, titleTemplate, videoTags, exportHistory, lastExportDir, projectLoaded, timelinePath])
}

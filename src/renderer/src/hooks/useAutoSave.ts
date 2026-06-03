import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { APP_NAME } from '../constants'

/**
 * 自动保存（规格 八）：clips / 时长 / 模板变化后防抖 500ms 写 .kkfb.json。
 * 项目加载完成前（projectLoaded=false）不写，避免空数据覆盖已有文件。
 */
export function useAutoSave(): void {
  const clips = useStore((s) => s.clips)
  const duration = useStore((s) => s.video?.duration)
  const titleTemplate = useStore((s) => s.titleTemplate)
  const projectLoaded = useStore((s) => s.projectLoaded)
  const videoPath = useStore((s) => s.video?.path)
  const exportHistory = useStore((s) => s.exportHistory)
  const lastExportDir = useStore((s) => s.lastExportDir)
  const videoTags = useStore((s) => s.videoTags)

  useEffect(() => {
    if (!videoPath || !projectLoaded) return
    const timer = window.setTimeout(async () => {
      const s = useStore.getState()
      if (!s.video) return
      const created = s.projectCreatedAt || new Date().toISOString()
      if (!s.projectCreatedAt) useStore.setState({ projectCreatedAt: created })
      const data = {
        version: '1.0',
        app_name: APP_NAME,
        source_video: s.video.fileName,
        video_duration: s.video.duration,
        created_at: created,
        updated_at: new Date().toISOString(),
        title_template: s.titleTemplate,
        clips: s.clips.map((c) => ({
          id: c.id,
          in: c.in,
          out: c.out,
          title: c.title,
          order: c.order,
          created_at: c.created_at,
          tags: c.tags || []
        })),
        last_export_dir: s.lastExportDir,
        exports: s.exportHistory,
        video_tags: s.videoTags
      }
      try {
        await window.api.saveProject(s.video.path, data)
        useStore.getState().setSavedAt(new Date().toISOString())
      } catch (err) {
        console.error('自动保存失败:', err)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [clips, duration, titleTemplate, projectLoaded, videoPath, exportHistory, lastExportDir, videoTags])
}

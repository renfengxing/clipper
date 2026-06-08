import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { APP_NAME } from '../constants'

/**
 * 自动保存（#96）：
 * - 每个视频的片段写到它旁边的 `<视频>.kkfb.json`（片段随视频走）
 * - 时间线 `.kkclip` 只写视频的摆放顺序（不含片段）
 */
export function useAutoSave(): void {
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const timelineName = useStore((s) => s.timelineName)
  const videoTags = useStore((s) => s.videoTags)
  const exportHistory = useStore((s) => s.exportHistory)
  const lastExportDir = useStore((s) => s.lastExportDir)
  const report = useStore((s) => s.report)
  const projectLoaded = useStore((s) => s.projectLoaded)
  const timelinePath = useStore((s) => s.timelinePath)

  useEffect(() => {
    if (!timelinePath || !projectLoaded || videos.length === 0) return
    const timer = window.setTimeout(async () => {
      const s = useStore.getState()
      if (!s.timelinePath || s.videos.length === 0) return
      const created = s.projectCreatedAt || new Date().toISOString()
      if (!s.projectCreatedAt) useStore.setState({ projectCreatedAt: created })
      const now = new Date().toISOString()
      try {
        // 1) 每个视频的片段 → sidecar
        for (const v of s.videos) {
          const vclips = s.clips
            .filter((c) => c.videoId === v.id)
            .sort((a, b) => a.in - b.in)
            .map((c, i) => ({
              id: c.id,
              in: c.in,
              out: c.out,
              title: c.title,
              order: i,
              created_at: c.created_at,
              tags: c.tags || []
            }))
          await window.api.saveProject(v.path + '.kkfb.json', {
            version: '1.1',
            app_name: APP_NAME,
            clips: vclips,
            video_tags: s.videoTags,
            updated_at: now
          })
        }
        // 2) 时间线（只存视频顺序）
        await window.api.saveProject(s.timelinePath, {
          version: '2.0',
          app_name: APP_NAME,
          name: s.timelineName,
          created_at: created,
          updated_at: now,
          videos: s.videos.map((v) => ({
            path: v.path,
            fileName: v.fileName,
            duration: v.duration,
            fps: v.fps,
            order: v.order
          })),
          video_tags: s.videoTags,
          exports: s.exportHistory,
          last_export_dir: s.lastExportDir,
          report: s.report,
          report_at: s.reportAt
        })
        useStore.getState().setSavedAt(new Date().toISOString())
      } catch (err) {
        console.error('自动保存失败:', err)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [clips, videos, timelineName, videoTags, exportHistory, lastExportDir, report, projectLoaded, timelinePath])
}

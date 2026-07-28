import { useStore } from '../store/useStore'
import { platform } from '../ports'
import { APP_NAME } from '../constants'

/**
 * 自动保存（#96）：
 * - 每个视频的片段写到自己的 sidecar（片段随视频走，桌面是视频旁边的文件，iOS 是沙盒里的）
 * - 时间线只写视频的摆放顺序，不含片段
 *
 * 做成 store 订阅而不是 React hook：core 不引入 react，桌面和手机端共用同一份逻辑。
 * 之前这段只存在于 Electron 的 renderer 里，手机端从头到尾没保存过任何东西。
 */

/** 只有这些字段变化才值得重新落盘（savedAt 是保存的结果，不能算触发条件，否则会自激循环） */
const WATCHED = [
  'clips',
  'videos',
  'timelineName',
  'videoTags',
  'exportHistory',
  'lastExportDir',
  'report',
  'projectLoaded',
  'timelinePath'
] as const

const DEBOUNCE_MS = 500

async function flush(): Promise<void> {
  const s = useStore.getState()
  if (!s.timelinePath || !s.projectLoaded || s.videos.length === 0) return
  const created = s.projectCreatedAt || new Date().toISOString()
  if (!s.projectCreatedAt) useStore.setState({ projectCreatedAt: created })
  const now = new Date().toISOString()

  // 1) 每个视频的片段 → 各自的 sidecar
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
    await platform().saveData(platform().clipsKeyFor(v.path), {
      version: '1.1',
      app_name: APP_NAME,
      clips: vclips,
      video_tags: s.videoTags,
      updated_at: now
    })
  }

  // 2) 时间线（只存视频顺序）
  await platform().saveData(s.timelinePath, {
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
}

/** 开始监听并自动保存，返回取消函数 */
export function startAutoSave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const unsub = useStore.subscribe((state, prev) => {
    if (WATCHED.every((k) => state[k] === prev[k])) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      flush().catch((err) => console.error('自动保存失败:', err))
    }, DEBOUNCE_MS)
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsub()
  }
}

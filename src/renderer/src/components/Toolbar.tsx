import { useStore, selectActiveVideo } from '../store/useStore'

export function Toolbar(): JSX.Element {
  const videos = useStore((s) => s.videos)
  const timelineName = useStore((s) => s.timelineName)
  const active = useStore(selectActiveVideo)
  const openSettings = useStore((s) => s.openSettings)
  const chooseAndAddVideos = useStore((s) => s.chooseAndAddVideos)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const clips = useStore((s) => s.clips)

  const selected = clips.find((c) => c.id === selectedClipId)
  const hasVideo = videos.length > 0

  return (
    <header className="flex items-center gap-2 px-3 h-11 bg-slate-900 border-b border-slate-700 shrink-0 app-drag">
      {/* 为 macOS 红绿灯留出空间 */}
      <div className="w-16" />

      <span className="text-sm font-medium text-cyan-300 shrink-0">宽宽爸视频切片</span>
      <span className="text-slate-700">·</span>

      <div className="text-sm text-slate-400 truncate flex-1">
        {hasVideo ? (
          <>
            <span className="text-slate-200">{timelineName || '未命名时间线'}</span>
            <span className="text-slate-600"> （{videos.length} 个视频</span>
            {active && <span className="text-slate-500">·正在播 {active.fileName}</span>}
            <span className="text-slate-600">）</span>
            {selected && <span className="text-cyan-300"> + {selected.title || '未命名片段'}</span>}
          </>
        ) : (
          <span className="text-slate-500">未打开视频（拖入可多选 / 菜单「文件 → 打开视频」）</span>
        )}
      </div>

      {hasVideo && (
        <button
          className="app-no-drag px-2.5 h-8 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200"
          title="向当前时间线添加视频"
          onClick={() => chooseAndAddVideos()}
        >
          ＋ 添加视频
        </button>
      )}

      <button
        className="app-no-drag w-8 h-8 rounded hover:bg-slate-700 text-slate-300 flex items-center justify-center text-lg"
        title="设置 (Cmd+,)"
        onClick={() => openSettings()}
      >
        ⚙️
      </button>
    </header>
  )
}

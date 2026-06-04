import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ExportProgress } from '../types'
import { APP_NAME } from '../constants'

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(0, i) : path
}

function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

/** #65：源视频目录下、与视频同名的子文件夹 */
function clipsFolder(videoPath: string, fileName: string): string {
  return dirOf(videoPath) + '/' + stripExt(fileName)
}

export function ExportModal(): JSX.Element | null {
  const open = useStore((s) => s.exportOpen)
  const close = useStore((s) => s.closeExport)
  const clips = useStore((s) => s.clips)
  const checkedIds = useStore((s) => s.checkedIds)
  const video = useStore((s) => s.video)
  const exportHistory = useStore((s) => s.exportHistory)
  const lastExportDir = useStore((s) => s.lastExportDir)
  const setExportHistory = useStore((s) => s.setExportHistory)
  const setLastExportDir = useStore((s) => s.setLastExportDir)

  const [dirMode, setDirMode] = useState<'same' | 'custom'>('same')
  const [customDir, setCustomDir] = useState('')
  const [skipExisting, setSkipExisting] = useState(true)
  const [watermark, setWatermark] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [summary, setSummary] = useState<{ exported: number; skipped: number; failed: number } | null>(null)

  useEffect(() => {
    if (open) {
      setRunning(false)
      setProgress(null)
      setSummary(null)
      // 记住上次目录：导出过就默认用它，不再要求重选（#5）
      if (lastExportDir) {
        setDirMode('custom')
        setCustomDir(lastExportDir)
      } else {
        setDirMode('same')
      }
    }
  }, [open, lastExportDir])

  useEffect(() => {
    return window.api.onExportProgress((p) => setProgress(p))
  }, [])

  if (!open || !video) return null

  // 只导出勾选的片段；未勾选则导出全部（#69）
  const toExport = (checkedIds.length > 0 ? clips.filter((c) => checkedIds.includes(c.id)) : clips)
    .slice()
    .sort((a, b) => a.in - b.in)
  const outDir = dirMode === 'same' ? clipsFolder(video.path, video.fileName) : customDir

  const pickDir = async (): Promise<void> => {
    const d = await window.api.chooseExportDir()
    if (d) {
      setCustomDir(d)
      setDirMode('custom')
    }
  }

  const start = async (): Promise<void> => {
    if (!outDir) {
      await pickDir()
      return
    }
    setRunning(true)
    setSummary(null)
    const res = await window.api.exportClips({
      sourcePath: video.path,
      outDir,
      skipExisting,
      priorExports: exportHistory,
      watermark: watermark ? APP_NAME : undefined,
      clips: toExport.map((c) => ({ in: c.in, out: c.out, title: c.title, tags: c.tags }))
    })
    setSummary({ exported: res.exported, skipped: res.skipped, failed: res.failed })
    setExportHistory(res.exports) // 记录已导出（增量导出去重，#4）
    setLastExportDir(outDir) // 记住目录（#5）
    setRunning(false)
  }

  const pct = progress ? Math.round((progress.index / progress.total) * 100) : 0

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-[460px] rounded-lg bg-slate-800 border border-slate-600 shadow-2xl p-5">
        <h3 className="text-base font-medium text-slate-100 mb-3">
          导出 {toExport.length} 个片段
          {checkedIds.length > 0 && <span className="text-xs text-slate-400 ml-1">（已选）</span>}
        </h3>
        <div className="border-t border-slate-700 mb-3" />

        {/* 输出目录 */}
        <div className="text-sm text-slate-300 mb-2">输出目录：</div>
        <label className="flex items-center gap-2 mb-1.5 text-sm text-slate-200 cursor-pointer">
          <input
            type="radio"
            checked={dirMode === 'same'}
            onChange={() => setDirMode('same')}
            disabled={running}
          />
          源视频目录下新建「{stripExt(video.fileName)}」同名文件夹
        </label>
        <label className="flex items-center gap-2 mb-1 text-sm text-slate-200 cursor-pointer">
          <input
            type="radio"
            checked={dirMode === 'custom'}
            onChange={() => (customDir ? setDirMode('custom') : pickDir())}
            disabled={running}
          />
          自定义…
          <button
            className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-xs"
            onClick={pickDir}
            disabled={running}
          >
            选择
          </button>
        </label>
        <div className="text-xs text-slate-500 truncate mb-3 pl-6">{outDir || '（未选择）'}</div>

        <div className="text-xs text-slate-500 mb-2">命名冲突：自动加 _02 _03</div>
        <label className="flex items-center gap-2 mb-4 text-sm text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
            disabled={running}
          />
          跳过已存在的同名文件
        </label>
        <label className="flex items-center gap-2 mb-1 text-sm text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={watermark}
            onChange={(e) => setWatermark(e.target.checked)}
            disabled={running}
          />
          加水印「{APP_NAME}」（右下角）
        </label>
        {watermark && (
          <div className="text-[11px] text-slate-500 mb-4 pl-6">勾选水印会重新编码，导出变慢。</div>
        )}

        {/* 进度 */}
        {(running || progress) && !summary && (
          <div className="mb-4">
            <div className="h-2 rounded bg-slate-700 overflow-hidden">
              <div className="h-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-slate-400 truncate tabular-nums">
              {progress ? `${progress.index}/${progress.total} ${progress.name}` : '准备中…'}
            </div>
          </div>
        )}

        {/* 结果 */}
        {summary && (
          <div className="mb-4 text-sm text-slate-200">
            完成：导出 <span className="text-green-400">{summary.exported}</span>
            {summary.skipped > 0 && (
              <>
                ，跳过 <span className="text-yellow-400">{summary.skipped}</span>
              </>
            )}
            {summary.failed > 0 && (
              <>
                ，失败 <span className="text-red-400">{summary.failed}</span>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {summary && (summary.exported > 0 || summary.skipped > 0) && (
            <button
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200 mr-auto"
              onClick={() => window.api.openFolder(outDir)}
            >
              📂 打开文件夹
            </button>
          )}
          <button
            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200"
            onClick={close}
            disabled={running}
          >
            {summary ? '关闭' : '取消'}
          </button>
          {!summary && (
            <button
              className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-sm text-white disabled:opacity-50"
              onClick={start}
              disabled={running || toExport.length === 0}
            >
              {running ? '导出中…' : '开始导出'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

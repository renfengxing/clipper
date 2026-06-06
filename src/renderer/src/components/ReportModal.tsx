import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'

export function ReportModal(): JSX.Element | null {
  const open = useStore((s) => s.reportOpen)
  const close = useStore((s) => s.closeReport)
  const clips = useStore((s) => s.clips)
  const timelineName = useStore((s) => s.timelineName)
  const aiAutoTag = useStore((s) => s.aiAutoTag)

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [report, setReport] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setReport('')
    setError('')
    setLoading(true)
    ;(async () => {
      // #105：有未打标签的片段 → 先 AI 自动打标签，让报告拿到更多有效信息
      const untagged = useStore.getState().clips.filter((c) => !(c.tags && c.tags.length))
      if (useStore.getState().clips.length > 0 && untagged.length > 0) {
        setStatus(`正在为 ${untagged.length} 个未打标签的片段自动打标签…`)
        await aiAutoTag() // 失败也继续（如无 Key），不阻断报告
      }
      setStatus('正在生成分析报告…')
      const cur = useStore.getState().clips
      const r = await window.api.report(cur.map((c) => ({ title: c.title, in: c.in, out: c.out, tags: c.tags })))
      setLoading(false)
      setStatus('')
      if (r.ok && r.report) setReport(r.report)
      else setError(r.code === 'NO_KEY' ? '请先在设置里填写 DeepSeek API Key' : r.error || '分析失败')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-[600px] max-h-[85vh] flex flex-col rounded-lg bg-slate-800 border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h3 className="text-base font-medium text-slate-100">AI 分析报告</h3>
          <span className="text-xs text-slate-500">{clips.length} 个片段</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-400">{status || '正在分析…'}</div>}
          {error && <div className="text-sm text-red-400">{error}</div>}
          {report && (
            <pre className="whitespace-pre-wrap break-words text-sm text-slate-200 font-sans leading-relaxed">
              {report}
            </pre>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-700">
          {report && (
            <>
              <button
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200"
                onClick={() => navigator.clipboard.writeText(report)}
              >
                复制
              </button>
              <button
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200"
                onClick={() => {
                  const base = timelineName || '视频'
                  void window.api.saveReport(report, `${base}_分析报告.md`)
                }}
              >
                存为 Markdown
              </button>
            </>
          )}
          <button
            className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-sm text-white"
            onClick={close}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

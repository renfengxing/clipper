import { useEffect, useRef, useState } from 'react'
import { useStore } from '@core/store/useStore'
import { fmtPrecise } from '@core/utils/time'

/**
 * 标题输入框（规格 6.1）。打字命名；可顺手打标签（#60/#61）。
 * 空标题确认 = 取消（终点不算设定，#24）。
 */
export function TitleModal(): JSX.Element | null {
  const open = useStore((s) => s.titleModalOpen)
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)
  const addClip = useStore((s) => s.addClip)
  const close = useStore((s) => s.closeTitleModal)
  const videoTags = useStore((s) => s.videoTags)
  const defaultTags = useStore((s) => s.defaultTags)

  const [value, setValue] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setTags([])
      setNewTag('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  if (!open || markIn == null || markOut == null) return null

  const lo = Math.min(markIn, markOut)
  const hi = Math.max(markIn, markOut)
  const submit = (): void => addClip(value, tags)

  const toggleTag = (t: string): void =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
  const addNewTag = (): void => {
    const t = newTag.trim().slice(0, 15)
    if (t && !tags.includes(t)) setTags([...tags, t])
    setNewTag('')
  }

  // 候选标签：视频标签 + 系统标签（去重）
  const candidates = Array.from(new Set([...videoTags, ...defaultTags]))

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-[440px] rounded-lg bg-slate-800 border border-slate-600 shadow-2xl p-5">
        <div className="text-xs text-slate-400 tabular-nums mb-3">
          {fmtPrecise(lo)} → {fmtPrecise(hi)}
          <span className="text-cyan-300 ml-2">（{(hi - lo).toFixed(2)}s）</span>
        </div>

        <textarea
          ref={inputRef}
          value={value}
          rows={3}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit() // Enter 保存
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
            // Shift+Enter 换行（默认行为）
          }}
          placeholder="片段解说 / 评价，如「宽宽过人后没体力，回防慢了半拍」（满了自动换行；Enter 保存，Shift+Enter 换行，留空＝取消）"
          className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 resize-y leading-relaxed break-words"
        />

        {/* 标签（可选可输入，#60/#61） */}
        <div className="mt-3">
          <div className="text-[11px] text-slate-500 mb-1">标签（可选）</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {candidates.map((t) => (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={
                  'px-1.5 py-0.5 rounded text-[11px] ' +
                  (tags.includes(t) ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')
                }
              >
                #{t}
              </button>
            ))}
            {/* 新建但不在候选里的已选标签 */}
            {tags
              .filter((t) => !candidates.includes(t))
              .map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className="px-1.5 py-0.5 rounded text-[11px] bg-cyan-600 text-white"
                >
                  #{t}
                </button>
              ))}
          </div>
          <input
            value={newTag}
            maxLength={15}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                addNewTag()
              }
            }}
            placeholder="输入新标签后回车（≤15字）"
            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-600 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400"
          />
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-[11px] text-slate-500">Enter 保存 · Esc 取消</span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200"
              onClick={() => close()}
            >
              取消
            </button>
            <button
              className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-sm text-white"
              onClick={submit}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

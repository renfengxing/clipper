import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { DEFAULT_KEYBINDINGS, type Keybindings } from '../types'
import { keyLabel } from '../utils/keys'

const KB_ROWS: Array<{ key: keyof Keybindings; label: string }> = [
  { key: 'speedUp', label: '快进（2/4/8x）' },
  { key: 'speedDown', label: '快退/倒放（2/4x）' },
  { key: 'reset', label: '控速/慢放（1/0.5/0.25/0.1x）' },
  { key: 'mark', label: '标起点 / 终点' },
  { key: 'playPause', label: '暂停 / 继续' }
]

export function SettingsModal(): JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const close = useStore((s) => s.closeSettings)
  const setKeybindings = useStore((s) => s.setKeybindings)
  const setDefaultTags = useStore((s) => s.setDefaultTags)

  const [apiKey, setApiKey] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [kb, setKb] = useState<Keybindings>(DEFAULT_KEYBINDINGS)
  const [capturing, setCapturing] = useState<keyof Keybindings | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoaded(false)
    setCapturing(null)
    setNewTag('')
    window.api.getSettings().then((s) => {
      setApiKey(s.deepseek_api_key || '')
      setTags(s.default_tags || [])
      setKb(s.keybindings || DEFAULT_KEYBINDINGS)
      setLoaded(true)
    })
  }, [open])

  if (!open) return null

  const addTag = (): void => {
    const t = newTag.trim().slice(0, 15)
    if (t && !tags.includes(t)) setTags([...tags, t])
    setNewTag('')
  }

  const save = async (): Promise<void> => {
    await window.api.setSettings({
      deepseek_api_key: apiKey.trim(),
      default_tags: tags,
      keybindings: kb
    })
    setDefaultTags(tags)
    setKeybindings(kb)
    close()
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-[540px] max-h-[88vh] overflow-y-auto rounded-lg bg-slate-800 border border-slate-600 shadow-2xl p-5">
        <h3 className="text-base font-medium text-slate-100 mb-4">宽宽爸视频切片 · 设置</h3>

        <label className="block text-sm text-slate-300 mb-1">DeepSeek API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-3 py-2 mb-1 rounded bg-slate-900 border border-slate-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 font-mono text-sm"
        />
        <div className="text-[11px] text-slate-500 mb-4">用于 AI 自动打标签与语音标题整理。Key 仅本地保存，不上传。</div>

        <label className="block text-sm text-slate-300 mb-2">默认标签（系统标签库，每个 ≤15 字）</label>
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-slate-700 text-xs text-slate-200">
              #{t}
              <button className="text-slate-500 hover:text-red-400" onClick={() => setTags(tags.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
          {tags.length === 0 && <span className="text-xs text-slate-600">暂无</span>}
        </div>
        <div className="flex gap-2 mb-5">
          <input
            value={newTag}
            maxLength={15}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag()
              }
            }}
            placeholder="新增标签（回车）"
            className="flex-1 px-3 py-1.5 rounded bg-slate-900 border border-slate-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 text-sm"
          />
          <button className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200" onClick={addTag}>
            添加
          </button>
        </div>

        <label className="block text-sm text-slate-300 mb-2">快捷键（点按钮后按一下要绑定的键）</label>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {KB_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-slate-400">{row.label}</span>
              <button
                onClick={() => setCapturing(row.key)}
                onKeyDown={(e) => {
                  if (capturing !== row.key) return
                  e.preventDefault()
                  if (e.key === 'Escape') {
                    setCapturing(null)
                    return
                  }
                  setKb({ ...kb, [row.key]: e.code })
                  setCapturing(null)
                }}
                className={
                  'min-w-[72px] px-3 py-1 rounded border text-center font-mono ' +
                  (capturing === row.key
                    ? 'bg-cyan-600 border-cyan-400 text-white animate-pulse'
                    : 'bg-slate-900 border-slate-600 text-slate-200 hover:border-cyan-400')
                }
              >
                {capturing === row.key ? '按键…' : keyLabel(kb[row.key])}
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button className="text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setKb(DEFAULT_KEYBINDINGS)}>
            重置为默认快捷键
          </button>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200" onClick={close}>
              取消
            </button>
            <button className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-sm text-white disabled:opacity-50" onClick={save} disabled={!loaded}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

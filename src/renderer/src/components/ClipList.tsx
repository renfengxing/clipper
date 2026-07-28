import { useState } from 'react'
import { useStore } from '@core/store/useStore'
import { fmtClock } from '@core/utils/time'
import { clipDuration, clipGlobalIn, clipGlobalOut, ordered } from '@core/utils/timeline'

interface Props {
  width: number
  onCollapse: () => void
}

export function ClipList({ width, onCollapse }: Props): JSX.Element {
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const updateClipTitle = useStore((s) => s.updateClipTitle)
  const deleteClip = useStore((s) => s.deleteClip)
  const openExport = useStore((s) => s.openExport)
  const openMerge = useStore((s) => s.openMerge)
  const openReport = useStore((s) => s.openReport)
  const checkedIds = useStore((s) => s.checkedIds)
  const toggleChecked = useStore((s) => s.toggleChecked)
  const setChecked = useStore((s) => s.setChecked)
  const activeTags = useStore((s) => s.activeTags)
  const toggleActiveTag = useStore((s) => s.toggleActiveTag)
  const clearActiveTags = useStore((s) => s.clearActiveTags)
  const tagFilterMode = useStore((s) => s.tagFilterMode)
  const setTagFilterMode = useStore((s) => s.setTagFilterMode)
  const showCheckedOnly = useStore((s) => s.showCheckedOnly)
  const setShowCheckedOnly = useStore((s) => s.setShowCheckedOnly)
  const videoTags = useStore((s) => s.videoTags)
  const defaultTags = useStore((s) => s.defaultTags)
  const addTag = useStore((s) => s.addTag)
  const removeTag = useStore((s) => s.removeTag)
  const aiTagging = useStore((s) => s.aiTagging)
  const aiAutoTag = useStore((s) => s.aiAutoTag)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [taggingId, setTaggingId] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')

  const startEdit = (id: string, title: string): void => {
    setEditingId(id)
    setEditValue(title)
  }
  const commitEdit = (): void => {
    if (editingId) updateClipTitle(editingId, editValue)
    setEditingId(null)
  }

  const runAi = async (): Promise<void> => {
    const res = await aiAutoTag()
    if (!res.ok) {
      alert(res.code === 'NO_KEY' ? '请先在设置里填写 DeepSeek API Key' : `AI 打标签失败：${res.error}`)
    }
  }

  // 默认按全局入点时间排序（跨多视频，#42）
  const videoIndex: Record<string, number> = {}
  ordered(videos).forEach((v, i) => (videoIndex[v.id] = i + 1))
  let visible = [...clips].sort((a, b) => clipGlobalIn(videos, a) - clipGlobalIn(videos, b))
  if (activeTags.length > 0) {
    visible = visible.filter((c) => {
      const ct = c.tags || []
      return tagFilterMode === 'and'
        ? activeTags.every((t) => ct.includes(t)) // 并且：含全部选中标签
        : activeTags.some((t) => ct.includes(t)) // 或：含任一
    })
  }
  if (showCheckedOnly) visible = visible.filter((c) => checkedIds.includes(c.id))
  const visibleIds = visible.map((c) => c.id)
  // 筛选条只显示片段实际用过的标签（#74）
  const usedTags = Array.from(new Set(clips.flatMap((c) => c.tags || []))).sort()
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.includes(id))

  return (
    <aside className="flex flex-col border-l border-slate-700 bg-slate-900 shrink-0" style={{ width }}>
      <div className="flex items-center justify-between px-3 h-11 border-b border-slate-700 shrink-0">
        <button className="w-7 h-7 rounded hover:bg-slate-700 text-slate-400" title="收起列表" onClick={onCollapse}>
          ▶
        </button>
        <h2 className="text-sm font-medium text-slate-200 flex-1 ml-1">
          片段 <span className="text-slate-500">({visible.length})</span>
        </h2>
        <button
          className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-sm text-white disabled:opacity-50 mr-1"
          disabled={aiTagging || clips.length === 0}
          onClick={runAi}
          title="AI 自动给片段打标签"
        >
          {aiTagging ? '…' : '✨ 标签'}
        </button>
        <button
          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200 disabled:opacity-40 mr-1"
          disabled={clips.length === 0}
          onClick={() => openReport()}
          title="AI 分析报告"
        >
          📊 报告
        </button>
        <button
          className="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={clips.length === 0}
          onClick={() => openExport()}
          title="批量导出 (Cmd+E)"
        >
          📦 导出
        </button>
      </div>

      {/* 工具条：只看已选 / 全选 / 合并 */}
      {clips.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800 text-xs flex-wrap">
          <button
            className={'px-2 py-1 rounded ' + (showCheckedOnly ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300')}
            onClick={() => setShowCheckedOnly(!showCheckedOnly)}
            title="只看已勾选的片段（#51）"
          >
            只看已选
          </button>
          {visible.length > 0 && (
            <label className="flex items-center gap-1 text-slate-400 cursor-pointer ml-1">
              <input
                type="checkbox"
                checked={allVisibleChecked}
                onChange={() => setChecked(allVisibleChecked ? [] : visibleIds)}
              />
              全选
            </label>
          )}
          <span className="text-slate-600">已选 {checkedIds.length}</span>
          <div className="flex-1" />
          <button
            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={checkedIds.length < 2}
            onClick={() => openMerge()}
            title="把勾选的片段按时间顺序合并成一个新视频"
          >
            🎬 合并({checkedIds.length})
          </button>
        </div>
      )}

      {/* 标签筛选条（只显示用过的标签，多选，#49/#74） */}
      {usedTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-800">
          <button
            className={'px-2 py-0.5 rounded text-xs ' + (activeTags.length === 0 ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300')}
            onClick={clearActiveTags}
          >
            全部
          </button>
          {usedTags.map((t) => (
            <button
              key={t}
              className={'px-2 py-0.5 rounded text-xs ' + (activeTags.includes(t) ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300')}
              onClick={() => toggleActiveTag(t)}
            >
              #{t}
            </button>
          ))}
          {activeTags.length > 1 && (
            <button
              className="px-2 py-0.5 rounded text-xs bg-slate-700 text-amber-300 ml-auto"
              title="多标签过滤方式：并且=同时含所有选中标签；或=含任一"
              onClick={() => setTagFilterMode(tagFilterMode === 'and' ? 'or' : 'and')}
            >
              {tagFilterMode === 'and' ? '并且' : '或'}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-slate-600 text-sm px-6">
            {clips.length === 0 ? '还没有片段。播放到位置按标记键标起止点，命名保存。' : '没有符合条件的片段。'}
          </div>
        ) : (
          <ul>
            {visible.map((c, i) => {
              const selected = c.id === selectedClipId
              const editing = c.id === editingId
              const checked = checkedIds.includes(c.id)
              const clipTags = c.tags || []
              return (
                <li
                  key={c.id}
                  onClick={() => !editing && selectClip(c.id)}
                  className={[
                    'group px-3 py-2.5 border-b border-slate-800 cursor-pointer',
                    selected ? 'bg-slate-800 border-l-2 border-l-cyan-400' : 'hover:bg-slate-800/50'
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={checked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleChecked(c.id)}
                    />
                    <span className="text-xs text-slate-600 tabular-nums w-5 shrink-0 select-none pt-0.5">{i + 1}</span>

                    {editing ? (
                      <textarea
                        autoFocus
                        rows={2}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            commitEdit()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setEditingId(null)
                          }
                        }}
                        placeholder="片段标题（Enter 保存）"
                        className="flex-1 px-2 py-1 rounded bg-slate-900 border border-cyan-500 text-sm text-slate-100 outline-none resize-y break-words"
                      />
                    ) : (
                      <span
                        className={'flex-1 text-sm whitespace-pre-wrap break-words ' + (c.title ? 'text-slate-100' : 'text-slate-500 italic')}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          startEdit(c.id, c.title)
                        }}
                      >
                        {c.title || '未命名片段'}
                      </span>
                    )}

                    {!editing && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                        <button className="w-6 h-6 rounded hover:bg-slate-700 text-xs" title="播放" onClick={(e) => { e.stopPropagation(); selectClip(c.id) }}>▶️</button>
                        <button className="w-6 h-6 rounded hover:bg-slate-700 text-xs" title="标签" onClick={(e) => { e.stopPropagation(); setTaggingId(taggingId === c.id ? null : c.id); setNewTag('') }}>🏷</button>
                        <button className="w-6 h-6 rounded hover:bg-slate-700 text-xs" title="改名" onClick={(e) => { e.stopPropagation(); startEdit(c.id, c.title) }}>✏️</button>
                        <button className="w-6 h-6 rounded hover:bg-slate-700 text-xs" title="删除" onClick={(e) => { e.stopPropagation(); deleteClip(c.id) }}>🗑</button>
                      </div>
                    )}
                  </div>

                  <div className="pl-11 mt-0.5 text-xs text-slate-500 tabular-nums flex items-center gap-2">
                    {videos.length > 1 && videoIndex[c.videoId] && (
                      <span className="px-1 rounded bg-slate-700 text-slate-300 text-[10px]" title="来源视频">
                        🎞{videoIndex[c.videoId]}
                      </span>
                    )}
                    <span>
                      {fmtClock(clipGlobalIn(videos, c))} - {fmtClock(clipGlobalOut(videos, c))}
                      <span className="ml-2 text-slate-600">({clipDuration(videos, c).toFixed(1)}s)</span>
                    </span>
                  </div>

                  {/* 已有标签 chips */}
                  {clipTags.length > 0 && (
                    <div className="pl-11 mt-1 flex flex-wrap gap-1">
                      {clipTags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-700 text-[11px] text-slate-300">
                          #{t}
                          <button className="text-slate-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); removeTag(c.id, t) }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 标签选择面板（从视频标签/系统标签里选，#57/#48） */}
                  {taggingId === c.id && (
                    <div className="pl-11 mt-1.5 p-2 rounded bg-slate-950/60 border border-slate-700" onClick={(e) => e.stopPropagation()}>
                      <div className="text-[11px] text-slate-500 mb-1">点标签添加/移除：</div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {videoTags.map((t) => {
                          const on = clipTags.includes(t)
                          return (
                            <button
                              key={t}
                              className={'px-1.5 py-0.5 rounded text-[11px] ' + (on ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')}
                              onClick={() => (on ? removeTag(c.id, t) : addTag(c.id, t))}
                            >
                              #{t}
                            </button>
                          )
                        })}
                        {videoTags.length === 0 && <span className="text-[11px] text-slate-600">暂无视频标签</span>}
                      </div>
                      {/* 系统标签里还没加入视频的 */}
                      {defaultTags.filter((t) => !videoTags.includes(t)).length > 0 && (
                        <>
                          <div className="text-[11px] text-slate-500 mb-1">从系统标签添加：</div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {defaultTags.filter((t) => !videoTags.includes(t)).map((t) => (
                              <button key={t} className="px-1.5 py-0.5 rounded text-[11px] bg-slate-800 text-slate-400 hover:bg-slate-700" onClick={() => addTag(c.id, t)}>
                                +{t}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <input
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return
                          if (e.key === 'Enter' && newTag.trim()) {
                            addTag(c.id, newTag)
                            setNewTag('')
                          }
                        }}
                        maxLength={15}
                        placeholder="新建标签（≤15字）回车"
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-600 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

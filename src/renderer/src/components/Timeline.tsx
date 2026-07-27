import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@core/store/useStore'
import { fmtClock, fmtPrecise, fmtMs } from '@core/utils/time'
import { keyLabel } from '@core/utils/keys'
import { ordered, totalDuration, videoOffset, localToGlobal } from '@core/utils/timeline'

const MIN_ZOOM = 1
const MAX_ZOOM = 32
const MIN_LEN = 1 / 30

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

type DragMode = 'in' | 'out' | 'move'

export function Timeline(): JSX.Element {
  const videos = useStore((s) => s.videos)
  const clips = useStore((s) => s.clips)
  const currentTime = useStore((s) => s.currentTime)
  const seek = useStore((s) => s.seek)
  const clearPreview = useStore((s) => s.clearPreview)
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const updateClipTimes = useStore((s) => s.updateClipTimes)
  const selectClip = useStore((s) => s.selectClip)
  const reorderVideos = useStore((s) => s.reorderVideos)
  const removeVideo = useStore((s) => s.removeVideo)
  const setDraggingSegment = useStore((s) => s.setDraggingSegment)
  const activeVideoId = useStore((s) => s.activeVideoId)

  const playing = useStore((s) => s.playing)
  const direction = useStore((s) => s.direction)
  const rate = useStore((s) => s.rate)
  const togglePlay = useStore((s) => s.togglePlay)
  const speedUp = useStore((s) => s.speedUp)
  const speedDown = useStore((s) => s.speedDown)
  const resetSpeed = useStore((s) => s.resetSpeed)
  const setMarkIn = useStore((s) => s.setMarkIn)
  const setMarkOut = useStore((s) => s.setMarkOut)
  const kb = useStore((s) => s.keybindings)
  const subtitleOn = useStore((s) => s.subtitleOn)
  const toggleSubtitle = useStore((s) => s.toggleSubtitle)

  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const anchorRef = useRef<{ ratio: number; viewportX: number } | null>(null)
  const editRef = useRef<{
    mode: DragMode
    id: string
    startG: number
    origIn: number
    origOut: number
    offset: number
    vdur: number
  } | null>(null)
  const [bubble, setBubble] = useState<{ leftPct: number; text: string } | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  const hasVideo = videos.length > 0
  const segs = ordered(videos)
  const total = totalDuration(videos)
  const pct = total > 0 ? clamp((currentTime / total) * 100, 0, 100) : 0

  const timeFromClientX = (clientX: number): number => {
    const inner = trackRef.current
    if (!inner || total <= 0) return 0
    const rect = inner.getBoundingClientRect()
    return clamp((clientX - rect.left) / rect.width, 0, 1) * total
  }

  // —— 时间线拖动 scrub ——
  const onPointerDown = (e: React.PointerEvent): void => {
    if (total <= 0) return
    draggingRef.current = true
    clearPreview() // 手动拖动游标 → 停止片段循环，可自由跨视频（#108）
    e.currentTarget.setPointerCapture(e.pointerId)
    seek(timeFromClientX(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!draggingRef.current) return
    seek(timeFromClientX(e.clientX))
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // —— 选中片段端点/整体拖拽（局部时间） ——
  const onEditDown = (e: React.PointerEvent, mode: DragMode): void => {
    const clip = clips.find((c) => c.id === selectedClipId)
    if (!clip || total <= 0) return
    const v = videos.find((x) => x.id === clip.videoId)
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    editRef.current = {
      mode,
      id: clip.id,
      startG: timeFromClientX(e.clientX),
      origIn: clip.in,
      origOut: clip.out,
      offset: videoOffset(videos, clip.videoId),
      vdur: v?.duration || clip.out
    }
  }
  const onEditMove = (e: React.PointerEvent): void => {
    const d = editRef.current
    if (!d) return
    const localT = clamp(timeFromClientX(e.clientX) - d.offset, 0, d.vdur)
    let nin = d.origIn
    let nout = d.origOut
    if (d.mode === 'in') nin = clamp(localT, 0, d.origOut - MIN_LEN)
    else if (d.mode === 'out') nout = clamp(localT, d.origIn + MIN_LEN, d.vdur)
    else {
      const len = d.origOut - d.origIn
      const delta = timeFromClientX(e.clientX) - d.startG
      nin = clamp(d.origIn + delta, 0, d.vdur - len)
      nout = nin + len
    }
    updateClipTimes(d.id, nin, nout)
    const edgeLocal = d.mode === 'out' ? nout : nin
    seek(d.offset + edgeLocal)
    setBubble({ leftPct: ((d.offset + edgeLocal) / total) * 100, text: fmtPrecise(edgeLocal) })
  }
  const onEditUp = (e: React.PointerEvent): void => {
    if (editRef.current) (e.currentTarget as Element).releasePointerCapture(e.pointerId)
    editRef.current = null
    setBubble(null)
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (total <= 0) return
    const sc = scrollRef.current
    const inner = trackRef.current
    if (!sc || !inner) return
    if (!e.ctrlKey && !e.metaKey) {
      sc.scrollLeft += e.deltaY || e.deltaX
      return
    }
    const rect = inner.getBoundingClientRect()
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
    const next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
    if (next === zoom) return
    anchorRef.current = { ratio, viewportX: e.clientX - sc.getBoundingClientRect().left }
    setZoom(next)
  }

  useLayoutEffect(() => {
    const sc = scrollRef.current
    const a = anchorRef.current
    if (!sc || !a) return
    anchorRef.current = null
    sc.scrollLeft = a.ratio * sc.scrollWidth - a.viewportX
  }, [zoom])

  useLayoutEffect(() => {
    if (draggingRef.current) return
    const sc = scrollRef.current
    if (!sc || total <= 0) return
    const cursorX = (currentTime / total) * sc.scrollWidth
    if (cursorX < sc.scrollLeft || cursorX > sc.scrollLeft + sc.clientWidth) {
      sc.scrollLeft = cursorX - sc.clientWidth / 2
    }
  }, [currentTime, total])

  const rateLabel = playing ? (direction === 'reverse' ? `◀ ${rate}x` : `${rate}x`) : null

  let markInfo = ''
  if (markIn != null && markOut != null) {
    const lo = Math.min(markIn, markOut)
    const hi = Math.max(markIn, markOut)
    markInfo = `准备保存 ${fmtPrecise(lo)} → ${fmtPrecise(hi)}（${(hi - lo).toFixed(2)}s）`
  } else if (markIn != null) {
    markInfo = `[ 起点 ${fmtPrecise(markIn)} · 已 ${(currentTime - markIn).toFixed(2)}s`
  } else if (markOut != null) {
    markInfo = `] 终点 ${fmtPrecise(markOut)}`
  }

  return (
    <div className="bg-slate-900 border-t border-slate-800 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <button
          className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 flex items-center justify-center disabled:opacity-40"
          title={`快退 / 倒放 2→4x (${keyLabel(kb.speedDown)})`}
          disabled={!hasVideo}
          onClick={() => speedDown()}
        >
          ◀◀
        </button>
        <button
          className="w-9 h-8 rounded bg-slate-600 hover:bg-slate-500 text-slate-100 flex items-center justify-center disabled:opacity-40"
          title={`播放 / 暂停 (${keyLabel(kb.playPause)})`}
          disabled={!hasVideo}
          onClick={() => togglePlay()}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          className="w-7 h-8 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 flex items-center justify-center text-sm disabled:opacity-40"
          title={`控速：正常 / 慢放 1→0.25→0.1x (${keyLabel(kb.reset)})`}
          disabled={!hasVideo}
          onClick={() => resetSpeed()}
        >
          ▶
        </button>
        <button
          className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 flex items-center justify-center disabled:opacity-40"
          title={`快进 2→4→8x (${keyLabel(kb.speedUp)})`}
          disabled={!hasVideo}
          onClick={() => speedUp()}
        >
          ▶▶
        </button>

        <div className="w-px h-6 bg-slate-700 mx-1" />

        <button
          className="px-2.5 h-8 rounded bg-clip-in/20 hover:bg-clip-in/30 text-green-300 text-base font-bold border border-green-500/30 disabled:opacity-40"
          title={`从这里开始 · 标起点 (${keyLabel(kb.mark)})`}
          disabled={!hasVideo}
          onClick={() => setMarkIn()}
        >
          [
        </button>
        <button
          className="px-2.5 h-8 rounded bg-clip-out/20 hover:bg-clip-out/30 text-red-300 text-base font-bold border border-red-500/30 disabled:opacity-40"
          title={`到这里结束 · 标终点 (${keyLabel(kb.mark)})`}
          disabled={!hasVideo}
          onClick={() => setMarkOut()}
        >
          ]
        </button>

        <span className="ml-2 text-xs tabular-nums text-slate-300">
          {fmtMs(currentTime)} / {fmtClock(total)}
        </span>
        {rateLabel && <span className="text-xs tabular-nums text-cyan-300 font-medium">{rateLabel}</span>}
        {markInfo && <span className="ml-2 text-xs tabular-nums text-yellow-300 truncate">{markInfo}</span>}

        <div className="flex-1" />

        <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer mr-1 select-none" title="字幕：片段标题在画面中央半透明显示">
          <input type="checkbox" checked={subtitleOn} onChange={() => toggleSubtitle()} disabled={!hasVideo} />
          字幕
        </label>

        <button className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40" onClick={() => setZoom((z) => clamp(z / 1.5, MIN_ZOOM, MAX_ZOOM))} disabled={zoom <= MIN_ZOOM} title="缩小">−</button>
        <span className="w-10 text-center text-xs text-slate-500 tabular-nums">{zoom.toFixed(1)}x</span>
        <button className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40" onClick={() => setZoom((z) => clamp(z * 1.5, MIN_ZOOM, MAX_ZOOM))} disabled={zoom >= MAX_ZOOM} title="放大（Ctrl/⌘+滚轮缩放，普通滚轮横向滚动）">+</button>
      </div>

      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden" onWheel={onWheel}>
        <div style={{ width: `${zoom * 100}%` }}>
          {/* 视频段标签条（可拖拽排序，#多视频） */}
          {hasVideo && (
            <div className="relative h-5 mb-1">
              {segs.map((v, i) => {
                const left = (videoOffset(videos, v.id) / total) * 100
                const w = ((v.duration || 0) / total) * 100
                const isActive = v.id === activeVideoId
                const isDrop = overIdx === i && dragIdx !== null && dragIdx !== i
                return (
                  <div
                    key={v.id}
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation()
                      setDragIdx(i)
                      setDraggingSegment(true)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (overIdx !== i) setOverIdx(i)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (dragIdx !== null) reorderVideos(dragIdx, i)
                      setDragIdx(null)
                      setOverIdx(null)
                      setDraggingSegment(false)
                    }}
                    onDragEnd={() => {
                      setDragIdx(null)
                      setOverIdx(null)
                      setDraggingSegment(false)
                    }}
                    onClick={() => {
                      clearPreview()
                      seek(videoOffset(videos, v.id))
                    }}
                    title={`${v.fileName}（拖动可调整顺序）`}
                    className={[
                      'group absolute top-0 bottom-0 pl-1 pr-4 text-[10px] leading-5 truncate cursor-grab rounded-sm border',
                      isActive ? 'bg-slate-700 text-slate-100 border-slate-500' : 'bg-slate-800 text-slate-400 border-slate-700',
                      isDrop ? 'ring-1 ring-cyan-400' : ''
                    ].join(' ')}
                    style={{ left: `${left}%`, width: `${Math.max(2, w)}%` }}
                  >
                    {i + 1}. {v.fileName}
                    <button
                      className="absolute right-0.5 top-0 bottom-0 px-0.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100"
                      title="从时间线移除该视频（其片段仍随视频保留，重新添加即恢复）"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeVideo(v.id)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div
            ref={trackRef}
            className="relative h-12 rounded bg-slate-800 cursor-pointer select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {!hasVideo && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-600">打开视频后显示时间线</div>
            )}

            {/* 视频段边界线 */}
            {total > 0 &&
              segs.slice(1).map((v) => (
                <div key={v.id} className="absolute top-0 bottom-0 w-px bg-slate-600/70 pointer-events-none" style={{ left: `${(videoOffset(videos, v.id) / total) * 100}%` }} />
              ))}

            {/* 片段色条（全局定位） */}
            {total > 0 &&
              clips.map((c) => {
                const isActive = c.id === selectedClipId
                const dim = selectedClipId != null && !isActive
                const left = (localToGlobal(videos, c.videoId, c.in) / total) * 100
                const width = Math.max(0.3, ((c.out - c.in) / total) * 100)
                return (
                  <div
                    key={c.id}
                    className={[
                      'absolute top-1 bottom-1 rounded-sm border cursor-pointer',
                      isActive ? 'bg-clip-active border-cyan-200 ring-1 ring-cyan-300 z-10' : 'bg-clip-saved/80 border-blue-300/40 hover:brightness-125',
                      dim ? 'opacity-30' : ''
                    ].join(' ')}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${c.title || '未命名片段'}\n${fmtClock(c.in)} - ${fmtClock(c.out)}（${(c.out - c.in).toFixed(1)}s）`}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      selectClip(c.id)
                    }}
                  />
                )
              })}

            {/* 待保存 I/O 高亮（全局） */}
            {total > 0 && markIn != null && markOut == null && currentTime > markIn && (
              <div className="absolute top-0 bottom-0 bg-clip-pending/30 border-l border-clip-pending pointer-events-none" style={{ left: `${(markIn / total) * 100}%`, width: `${((currentTime - markIn) / total) * 100}%` }} />
            )}
            {total > 0 && markIn != null && markOut != null && (
              <div className="absolute top-0 bottom-0 bg-clip-pending/30 border-x border-clip-pending pointer-events-none" style={{ left: `${(Math.min(markIn, markOut) / total) * 100}%`, width: `${(Math.abs(markOut - markIn) / total) * 100}%` }} />
            )}
            {total > 0 && markIn != null && (
              <div className="absolute -top-1 w-0 h-0 -ml-1 border-l-4 border-r-4 border-t-[7px] border-l-transparent border-r-transparent border-t-clip-in pointer-events-none" style={{ left: `${(markIn / total) * 100}%` }} />
            )}
            {total > 0 && markOut != null && (
              <div className="absolute -top-1 w-0 h-0 -ml-1 border-l-4 border-r-4 border-t-[7px] border-l-transparent border-r-transparent border-t-clip-out pointer-events-none" style={{ left: `${(markOut / total) * 100}%` }} />
            )}

            {/* 选中片段拖拽编辑层 */}
            {total > 0 &&
              (() => {
                const clip = clips.find((c) => c.id === selectedClipId)
                if (!clip) return null
                const left = (localToGlobal(videos, clip.videoId, clip.in) / total) * 100
                const width = Math.max(0.5, ((clip.out - clip.in) / total) * 100)
                return (
                  <div className="absolute top-0 bottom-0 z-20" style={{ left: `${left}%`, width: `${width}%` }}>
                    <div className="absolute inset-y-1 inset-x-1 cursor-grab active:cursor-grabbing" title="拖动平移整段" onPointerDown={(e) => onEditDown(e, 'move')} onPointerMove={onEditMove} onPointerUp={onEditUp} />
                    <div className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize bg-clip-in rounded-l" title="拖动改入点" onPointerDown={(e) => onEditDown(e, 'in')} onPointerMove={onEditMove} onPointerUp={onEditUp} />
                    <div className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize bg-clip-out rounded-r" title="拖动改出点" onPointerDown={(e) => onEditDown(e, 'out')} onPointerMove={onEditMove} onPointerUp={onEditUp} />
                  </div>
                )
              })()}

            {bubble && (
              <div className="absolute -top-6 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-700 text-cyan-200 text-[11px] tabular-nums whitespace-nowrap pointer-events-none z-30" style={{ left: `${bubble.leftPct}%` }}>
                {bubble.text}
              </div>
            )}

            {hasVideo && (
              <div className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none z-10" style={{ left: `${pct}%` }}>
                <div className="absolute -top-0.5 -left-[3px] w-2 h-2 rounded-full bg-cyan-400" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

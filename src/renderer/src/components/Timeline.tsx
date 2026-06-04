import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { fmtClock, fmtPrecise, fmtMs } from '../utils/time'
import { keyLabel } from '../utils/keys'

const MIN_ZOOM = 1
const MAX_ZOOM = 32
const MIN_LEN = 1 / 30 // 入点不能越过出点：至少留 1 帧

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

type DragMode = 'in' | 'out' | 'move'

/**
 * 阶段3 时间线：游标、拖动 scrub、缩放、片段色条。
 * I/O 标记 + 拖拽端点在阶段4/6 接入。
 */
export function Timeline(): JSX.Element {
  const video = useStore((s) => s.video)
  const clips = useStore((s) => s.clips)
  const currentTime = useStore((s) => s.currentTime)
  const seek = useStore((s) => s.seek)
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const updateClipTimes = useStore((s) => s.updateClipTimes)
  const deselectClip = useStore((s) => s.deselectClip)
  const selectClip = useStore((s) => s.selectClip)
  const pauseAction = useStore((s) => s.pause)
  // 控制条
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

  const rateLabel = playing
    ? direction === 'reverse'
      ? `◀ ${rate}x`
      : `${rate}x`
    : null

  // N 标记信息（显示在控制区，#19）
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

  const editRef = useRef<{ mode: DragMode; id: string; startT: number; origIn: number; origOut: number } | null>(null)
  const [bubble, setBubble] = useState<{ leftPct: number; text: string } | null>(null)

  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  // 缩放时锚定鼠标下的时间点，渲染后修正 scrollLeft
  const anchorRef = useRef<{ ratio: number; viewportX: number } | null>(null)

  const dur = video?.duration ?? 0
  const pct = dur > 0 ? clamp((currentTime / dur) * 100, 0, 100) : 0

  const timeFromClientX = (clientX: number): number => {
    const inner = trackRef.current
    if (!inner || dur <= 0) return 0
    const rect = inner.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    return ratio * dur
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (dur <= 0) return
    deselectClip() // 点时间线 = 取消片段选中，让 Space 从点击处播放
    draggingRef.current = true
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

  // —— 选中片段的 I/O 端点 / 整体拖拽（规格 6.2）——
  const onEditDown = (e: React.PointerEvent, mode: DragMode): void => {
    const clip = clips.find((c) => c.id === selectedClipId)
    if (!clip || dur <= 0) return
    e.stopPropagation()
    e.preventDefault()
    pauseAction() // 拖端点时暂停，避免边播边拖打架
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    editRef.current = {
      mode,
      id: clip.id,
      startT: timeFromClientX(e.clientX),
      origIn: clip.in,
      origOut: clip.out
    }
  }
  const onEditMove = (e: React.PointerEvent): void => {
    const d = editRef.current
    if (!d) return
    const t = timeFromClientX(e.clientX)
    let nin = d.origIn
    let nout = d.origOut
    if (d.mode === 'in') {
      nin = clamp(t, 0, d.origOut - MIN_LEN)
    } else if (d.mode === 'out') {
      nout = clamp(t, d.origIn + MIN_LEN, dur)
    } else {
      const len = d.origOut - d.origIn
      nin = clamp(d.origIn + (t - d.startT), 0, dur - len)
      nout = nin + len
    }
    updateClipTimes(d.id, nin, nout)
    const edge = d.mode === 'out' ? nout : nin
    seek(edge) // 拖动时实时 scrub
    setBubble({ leftPct: (edge / dur) * 100, text: fmtPrecise(edge) })
  }
  const onEditUp = (e: React.PointerEvent): void => {
    if (editRef.current) (e.currentTarget as Element).releasePointerCapture(e.pointerId)
    editRef.current = null
    setBubble(null)
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (dur <= 0) return
    const sc = scrollRef.current
    const inner = trackRef.current
    if (!sc || !inner) return

    // 普通滚轮：横向滚动（放大后能看到右侧，#37）；Ctrl/Cmd+滚轮：缩放
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

  // 缩放后修正横向滚动，使鼠标处时间点保持不动
  useLayoutEffect(() => {
    const sc = scrollRef.current
    const a = anchorRef.current
    if (!sc || !a) return
    anchorRef.current = null
    sc.scrollLeft = a.ratio * sc.scrollWidth - a.viewportX
  }, [zoom])

  // 播放时让游标保持在可视范围内
  useLayoutEffect(() => {
    if (draggingRef.current) return
    const sc = scrollRef.current
    if (!sc || dur <= 0) return
    const cursorX = (currentTime / dur) * sc.scrollWidth
    if (cursorX < sc.scrollLeft || cursorX > sc.scrollLeft + sc.clientWidth) {
      sc.scrollLeft = cursorX - sc.clientWidth / 2
    }
  }, [currentTime, dur])

  return (
    <div className="bg-slate-900 border-t border-slate-800 px-3 py-2 shrink-0">
      {/* 控制行：后退/播放/前进 + 起止标记 + 时间 + 标记信息 + 缩放（合并为一栏） */}
      <div className="flex items-center gap-2 mb-2">
        <button
          className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 flex items-center justify-center disabled:opacity-40"
          title={`快退 / 倒放 2→4x (${keyLabel(kb.speedDown)})`}
          disabled={!video}
          onClick={() => speedDown()}
        >
          ◀◀
        </button>
        <button
          className="w-9 h-8 rounded bg-slate-600 hover:bg-slate-500 text-slate-100 flex items-center justify-center disabled:opacity-40"
          title={`播放 / 暂停 (${keyLabel(kb.playPause)})`}
          disabled={!video}
          onClick={() => togglePlay()}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          className="w-7 h-8 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 flex items-center justify-center text-sm disabled:opacity-40"
          title={`控速：正常 / 慢放 1→0.25→0.1x (${keyLabel(kb.reset)})`}
          disabled={!video}
          onClick={() => resetSpeed()}
        >
          ▶
        </button>
        <button
          className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 flex items-center justify-center disabled:opacity-40"
          title={`快进 2→4→8x (${keyLabel(kb.speedUp)})`}
          disabled={!video}
          onClick={() => speedUp()}
        >
          ▶▶
        </button>

        <div className="w-px h-6 bg-slate-700 mx-1" />

        <button
          className="px-2.5 h-8 rounded bg-clip-in/20 hover:bg-clip-in/30 text-green-300 text-base font-bold border border-green-500/30 disabled:opacity-40"
          title={`从这里开始 · 标起点 (${keyLabel(kb.mark)})`}
          disabled={!video}
          onClick={() => setMarkIn()}
        >
          [
        </button>
        <button
          className="px-2.5 h-8 rounded bg-clip-out/20 hover:bg-clip-out/30 text-red-300 text-base font-bold border border-red-500/30 disabled:opacity-40"
          title={`到这里结束 · 标终点 (${keyLabel(kb.mark)})`}
          disabled={!video}
          onClick={() => setMarkOut()}
        >
          ]
        </button>

        <span className="ml-2 text-xs tabular-nums text-slate-300">
          {fmtMs(currentTime)} / {fmtClock(dur)}
        </span>
        {rateLabel && (
          <span className="text-xs tabular-nums text-cyan-300 font-medium">{rateLabel}</span>
        )}
        {markInfo && (
          <span className="ml-2 text-xs tabular-nums text-yellow-300 truncate">{markInfo}</span>
        )}

        <div className="flex-1" />

        {/* 弹幕开关（#78，放在缩放 −/+ 左边） */}
        <label
          className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer mr-1 select-none"
          title="字幕：把片段标题按时间在画面中央以半透明字幕显示"
        >
          <input type="checkbox" checked={subtitleOn} onChange={() => toggleSubtitle()} disabled={!video} />
          字幕
        </label>

        <button
          className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40"
          onClick={() => setZoom((z) => clamp(z / 1.5, MIN_ZOOM, MAX_ZOOM))}
          disabled={zoom <= MIN_ZOOM}
          title="缩小"
        >
          −
        </button>
        <span className="w-10 text-center text-xs text-slate-500 tabular-nums">
          {zoom.toFixed(1)}x
        </span>
        <button
          className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40"
          onClick={() => setZoom((z) => clamp(z * 1.5, MIN_ZOOM, MAX_ZOOM))}
          disabled={zoom >= MAX_ZOOM}
          title="放大（Ctrl/⌘+滚轮缩放，普通滚轮横向滚动）"
        >
          +
        </button>
      </div>

      {/* 滚动视口 */}
      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden" onWheel={onWheel}>
        <div
          ref={trackRef}
          className="relative h-12 rounded bg-slate-800 cursor-pointer select-none"
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {!video && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-600">
              打开视频后显示时间线
            </div>
          )}

          {/* 片段色条：选中＝青色激活，其余在有选中时变灰 */}
          {dur > 0 &&
            clips.map((c) => {
              const active = c.id === selectedClipId
              const dim = selectedClipId != null && !active
              return (
                <div
                  key={c.id}
                  className={[
                    'absolute top-1 bottom-1 rounded-sm border cursor-pointer',
                    active
                      ? 'bg-clip-active border-cyan-200 ring-1 ring-cyan-300 z-10'
                      : 'bg-clip-saved/80 border-blue-300/40 hover:brightness-125',
                    dim ? 'opacity-30' : ''
                  ].join(' ')}
                  style={{
                    left: `${(c.in / dur) * 100}%`,
                    width: `${Math.max(0.3, ((c.out - c.in) / dur) * 100)}%`
                  }}
                  title={`${c.title || '未命名片段'}\n${fmtClock(c.in)} - ${fmtClock(c.out)}（${(c.out - c.in).toFixed(1)}s）`}
                  onPointerDown={(e) => {
                    e.stopPropagation() // 不触发时间线 scrub
                    selectClip(c.id)
                  }}
                />
              )
            })}

          {/* 仅标了入点：从入点到播放头实时高亮（边播边涨，黄） */}
          {dur > 0 && markIn != null && markOut == null && currentTime > markIn && (
            <div
              className="absolute top-0 bottom-0 bg-clip-pending/30 border-l border-clip-pending pointer-events-none"
              style={{
                left: `${(markIn / dur) * 100}%`,
                width: `${((currentTime - markIn) / dur) * 100}%`
              }}
            />
          )}
          {/* 待保存的 I/O 区间高亮（黄） */}
          {dur > 0 && markIn != null && markOut != null && (
            <div
              className="absolute top-0 bottom-0 bg-clip-pending/30 border-x border-clip-pending pointer-events-none"
              style={{
                left: `${(Math.min(markIn, markOut) / dur) * 100}%`,
                width: `${(Math.abs(markOut - markIn) / dur) * 100}%`
              }}
            />
          )}
          {/* 入点标记（绿 ▼） */}
          {dur > 0 && markIn != null && (
            <div
              className="absolute -top-1 w-0 h-0 -ml-1 border-l-4 border-r-4 border-t-[7px] border-l-transparent border-r-transparent border-t-clip-in pointer-events-none"
              style={{ left: `${(markIn / dur) * 100}%` }}
            />
          )}
          {/* 出点标记（红 ▼） */}
          {dur > 0 && markOut != null && (
            <div
              className="absolute -top-1 w-0 h-0 -ml-1 border-l-4 border-r-4 border-t-[7px] border-l-transparent border-r-transparent border-t-clip-out pointer-events-none"
              style={{ left: `${(markOut / dur) * 100}%` }}
            />
          )}

          {/* 选中片段的拖拽编辑层（端点改入/出点、整体平移） */}
          {dur > 0 &&
            (() => {
              const clip = clips.find((c) => c.id === selectedClipId)
              if (!clip) return null
              const left = (clip.in / dur) * 100
              const width = Math.max(0.5, ((clip.out - clip.in) / dur) * 100)
              return (
                <div
                  className="absolute top-0 bottom-0 z-20"
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {/* 整体平移（时长不变） */}
                  <div
                    className="absolute inset-y-1 inset-x-1 cursor-grab active:cursor-grabbing"
                    title="拖动平移整段"
                    onPointerDown={(e) => onEditDown(e, 'move')}
                    onPointerMove={onEditMove}
                    onPointerUp={onEditUp}
                  />
                  {/* 左端：改入点 */}
                  <div
                    className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize bg-clip-in rounded-l"
                    title="拖动改入点"
                    onPointerDown={(e) => onEditDown(e, 'in')}
                    onPointerMove={onEditMove}
                    onPointerUp={onEditUp}
                  />
                  {/* 右端：改出点 */}
                  <div
                    className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize bg-clip-out rounded-r"
                    title="拖动改出点"
                    onPointerDown={(e) => onEditDown(e, 'out')}
                    onPointerMove={onEditMove}
                    onPointerUp={onEditUp}
                  />
                </div>
              )
            })()}

          {/* 拖拽气泡 */}
          {bubble && (
            <div
              className="absolute -top-6 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-700 text-cyan-200 text-[11px] tabular-nums whitespace-nowrap pointer-events-none z-30"
              style={{ left: `${bubble.leftPct}%` }}
            >
              {bubble.text}
            </div>
          )}

          {/* 游标 */}
          {video && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none z-10"
              style={{ left: `${pct}%` }}
            >
              <div className="absolute -top-0.5 -left-[3px] w-2 h-2 rounded-full bg-cyan-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

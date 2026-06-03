import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { fmtPrecise, fmtMs } from '../utils/time'
import { keyLabel } from '../utils/keys'

function baseName(p: string): string {
  const parts = p.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

interface Props {
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

/** 标记起点后、未标终点时，视频中央显示半透明提示（#44） */
function MarkingOverlay(): JSX.Element | null {
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)
  const currentTime = useStore((s) => s.currentTime)
  const markKey = useStore((s) => s.keybindings.mark)
  if (markIn == null || markOut != null) return null
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center text-white/60 select-none">
        <div className="text-2xl font-medium tracking-wide">● 正在标记片段</div>
        <div className="mt-2 text-base tabular-nums">起点 {fmtPrecise(markIn)}</div>
        <div className="text-base tabular-nums">
          当前 {fmtMs(currentTime)}（已 {(currentTime - markIn).toFixed(2)}s）
        </div>
        <div className="mt-2 text-xs text-white/40">
          再按 {keyLabel(markKey)} 键，或点 ] 按钮，标终点
        </div>
        <div className="text-xs text-white/40">按 Esc 退出标记片段</div>
      </div>
    </div>
  )
}

/** 左下角半透明快捷键提示（#67） */
function HotkeyHint(): JSX.Element {
  const kb = useStore((s) => s.keybindings)
  const item = (k: string, label: string): JSX.Element => (
    <span className="whitespace-nowrap">
      <span className="text-white/70">{keyLabel(k)}</span> {label}
    </span>
  )
  return (
    <div className="absolute bottom-3 left-3 text-[11px] text-white/35 leading-relaxed pointer-events-none select-none space-y-0.5">
      <div className="flex gap-2">
        {item(kb.speedDown, '快退')}
        {item(kb.reset, '控速')}
        {item(kb.speedUp, '快进')}
      </div>
      <div className="flex gap-2">
        {item(kb.mark, '标记')}
        {item(kb.playPause, '播放/暂停')}
        {item('KeyM', '全屏')}
      </div>
    </div>
  )
}

/** 弹幕层（#75）：开关打开时，把当前时间命中的片段标题当弹幕从右往左飘 */
function Danmaku(): JSX.Element | null {
  const on = useStore((s) => s.danmakuOn)
  const clips = useStore((s) => s.clips)
  const currentTime = useStore((s) => s.currentTime)
  if (!on) return null
  const active = clips
    .filter((c) => currentTime >= c.in && currentTime <= c.out && c.title)
    .sort((a, b) => a.in - b.in)
  return (
    <div className="absolute inset-x-0 top-0 h-[22%] overflow-hidden pointer-events-none">
      {active.map((c, i) => {
        const p = (currentTime - c.in) / Math.max(0.1, c.out - c.in) // 0→1
        const left = 100 - p * 116 // 从右(100%)飘到左(-16%)
        return (
          <div
            key={c.id}
            className="absolute whitespace-nowrap text-white text-base font-medium"
            style={{
              left: `${left}%`,
              top: `${4 + (i % 3) * 30}%`, // 只在顶部约 22% 区域内分 3 行（#79）
              textShadow: '0 1px 3px rgba(0,0,0,0.9)'
            }}
          >
            {c.title}
          </div>
        )
      })}
    </div>
  )
}

export function VideoPlayer({ isFullscreen, onToggleFullscreen }: Props): JSX.Element {
  const video = useStore((s) => s.video)
  const setDuration = useStore((s) => s.setDuration)
  const setCurrentTime = useStore((s) => s.setCurrentTime)
  const setVideoEl = useStore((s) => s.setVideoEl)
  const togglePlay = useStore((s) => s.togglePlay)
  const pause = useStore((s) => s.pause)
  const deselectClip = useStore((s) => s.deselectClip)
  const openVideoPath = useStore((s) => s.openVideoPath)

  const refCb = useCallback((el: HTMLVideoElement | null) => setVideoEl(el), [setVideoEl])

  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    if (!video) window.api.getRecentFiles().then(setRecent)
  }, [video])

  if (!video) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-black text-slate-500 gap-5">
        <div className="text-center">
          <div className="text-5xl mb-3">🎬</div>
          <div className="text-sm">拖入视频，或通过菜单「文件 → 打开视频」加载比赛视频</div>
          <div className="text-xs mt-1 text-slate-600">支持 mp4 / mov</div>
        </div>
        {recent.length > 0 && (
          <div className="w-[420px] max-w-[80%]">
            <div className="text-xs text-slate-600 mb-1.5 px-1">最近打开</div>
            <ul className="rounded border border-slate-800 divide-y divide-slate-800 overflow-hidden">
              {recent.map((p) => (
                <li key={p}>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-slate-800/60 text-sm text-slate-300 truncate"
                    title={p}
                    onClick={() => openVideoPath(p)}
                  >
                    🎞 {baseName(p)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black group">
      <MarkingOverlay />
      <Danmaku />
      <HotkeyHint />

      <video
        ref={refCb}
        src={video.url}
        className="max-h-full max-w-full"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => pause()}
        onClick={() => {
          deselectClip() // 点画面取消片段选中（焦点回到视频）
          togglePlay()
        }}
      />

      <button
        className="absolute bottom-3 right-3 w-9 h-9 rounded bg-slate-900/70 hover:bg-slate-800 text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
        title="全屏（含进度条，快捷键 M）"
        onClick={(e) => {
          e.stopPropagation()
          onToggleFullscreen()
        }}
      >
        {isFullscreen ? '🡼' : '⛶'}
      </button>
    </div>
  )
}

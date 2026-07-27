import { useCallback, useEffect, useState } from 'react'
import { useStore, selectActiveVideo } from '@core/store/useStore'
import { fmtPrecise, fmtMs } from '@core/utils/time'
import { keyLabel } from '@core/utils/keys'
import { localToGlobal } from '@core/utils/timeline'
import { basename } from '../utils/media'

interface Props {
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

/** 字幕层（#75/#84）：画面中央半透明显示当前命中片段的标题 */
function Subtitle(): JSX.Element | null {
  const on = useStore((s) => s.subtitleOn)
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const currentTime = useStore((s) => s.currentTime)
  if (!on) return null
  const active = clips.filter((c) => {
    const gin = localToGlobal(videos, c.videoId, c.in)
    const gout = localToGlobal(videos, c.videoId, c.out)
    return currentTime >= gin && currentTime <= gout && c.title
  })
  if (active.length === 0) return null
  return (
    <div className="absolute inset-x-0 bottom-8 flex flex-col items-center gap-0.5 pointer-events-none">
      {active.map((c) => (
        <div
          key={c.id}
          className="text-white/30 text-lg font-medium text-center px-4"
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
        >
          {c.title}
        </div>
      ))}
    </div>
  )
}

/** 标记起点后、未标终点时，中央半透明提示（#44） */
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
        <div className="mt-2 text-xs text-white/40">再按 {keyLabel(markKey)} 键，或点 ] 按钮，标终点</div>
        <div className="text-xs text-white/40">按 Esc 退出标记片段</div>
      </div>
    </div>
  )
}

/** 左下角半透明快捷键提示（#67/#73） */
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

export function VideoPlayer({ isFullscreen, onToggleFullscreen }: Props): JSX.Element {
  const active = useStore(selectActiveVideo)
  const videos = useStore((s) => s.videos)
  const setPlayer = useStore((s) => s.setPlayer)
  const applyPendingSeek = useStore((s) => s.applyPendingSeek)
  const syncLocalTime = useStore((s) => s.syncLocalTime)
  const onVideoEnded = useStore((s) => s.onVideoEnded)
  const togglePlay = useStore((s) => s.togglePlay)
  const deselectClip = useStore((s) => s.deselectClip)
  const openVideoPath = useStore((s) => s.openVideoPath)
  const closeVideo = useStore((s) => s.closeVideo)

  // 把 <video> 包成 Player 端口交给 store（iOS 端会包 react-native-video 的 ref）
  const refCb = useCallback(
    (el: HTMLVideoElement | null) => {
      setPlayer(
        el
          ? {
              seekLocal: (sec) => {
                el.currentTime = sec
              },
              play: () => void el.play(),
              pause: () => el.pause(),
              setRate: (r) => {
                el.playbackRate = r
              }
            }
          : null
      )
    },
    [setPlayer]
  )

  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    if (videos.length === 0) window.api.getRecentFiles().then(setRecent)
  }, [videos.length])

  if (videos.length === 0 || !active) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-black text-slate-500 gap-5">
        <div className="text-center">
          <div className="text-5xl mb-3">🎬</div>
          <div className="text-sm">拖入视频（可多选），或菜单「文件 → 打开视频」</div>
          <div className="text-xs mt-1 text-slate-600">多个视频会按顺序拼成一条时间线</div>
        </div>
        {recent.length > 0 && (
          <div className="w-[440px] max-w-[80%]">
            <div className="text-xs text-slate-600 mb-1.5 px-1">最近的时间线</div>
            <ul className="rounded border border-slate-800 divide-y divide-slate-800 overflow-hidden">
              {recent.map((p) => (
                <li key={p}>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-slate-800/60 text-sm text-slate-300 truncate"
                    title={p}
                    onClick={() => openVideoPath(p)}
                  >
                    🎞 {basename(p)}
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
      <Subtitle />
      <HotkeyHint />

      <button
        className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-900/70 hover:bg-red-600/80 text-slate-200 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        title="关闭当前时间线"
        onClick={(e) => {
          e.stopPropagation()
          closeVideo()
        }}
      >
        ✕
      </button>

      <video
        ref={refCb}
        src={active.url}
        className="max-h-full max-w-full"
        onLoadedMetadata={() => applyPendingSeek()}
        onTimeUpdate={(e) => syncLocalTime(e.currentTarget.currentTime)}
        onEnded={() => onVideoEnded()}
        onClick={() => {
          deselectClip()
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

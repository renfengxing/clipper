import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, PanResponder } from 'react-native'
import { useStore } from '@core/store/useStore'
import { videoOffset } from '@core/utils/timeline'

const HANDLE = 26

interface Props {
  clipId: string
  /** 条的高度，时间线上用矮一点的 */
  height?: number
}

/**
 * 拖拽调整片段起止点。
 *
 * 时间窗口在挂载时定死（片段前后各留一段余量）：若跟着片段实时变化，
 * 拖动过程中标尺自己也在动，手感会很晃。
 */
export function TrimBar({ clipId, height = 44 }: Props): JSX.Element | null {
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const updateClipTimes = useStore((s) => s.updateClipTimes)
  const seek = useStore((s) => s.seek)
  const pause = useStore((s) => s.pause)
  const clearPreview = useStore((s) => s.clearPreview)

  const clip = clips.find((c) => c.id === clipId) || null

  const [win, setWin] = useState({ start: 0, end: 1 })
  const [barW, setBarW] = useState(0)
  const barRef = useRef<View>(null)
  const barX = useRef(0)
  const liveRef = useRef({ in: 0, out: 0 })
  const ctxRef = useRef({ win, barW, offset: 0, id: '' })

  useEffect(() => {
    const c = clips.find((x) => x.id === clipId)
    if (!c) return
    const pad = Math.max(2, (c.out - c.in) * 0.6)
    setWin({ start: Math.max(0, c.in - pad), end: c.out + pad })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId])

  const offset = clip ? videoOffset(videos, clip.videoId) : 0
  if (clip) liveRef.current = { in: clip.in, out: clip.out }
  ctxRef.current = { win, barW, offset, id: clipId }

  const span = Math.max(0.001, win.end - win.start)
  const xOf = (t: number): number => ((t - win.start) / span) * barW

  // PanResponder 只建一次，靠 ctxRef 读最新值
  const make = (which: 'in' | 'out'): ReturnType<typeof PanResponder.create> =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        // 停住播放并退出片段循环，否则播放头会跟你抢
        pause()
        clearPreview()
      },
      onPanResponderMove: (e) => {
        const ctx = ctxRef.current
        const sp = Math.max(0.001, ctx.win.end - ctx.win.start)
        // 必须用 pageX：locationX 是相对触摸目标的，而目标正是手柄本身
        const x = e.nativeEvent.pageX - barX.current
        const t = ctx.win.start + (x / Math.max(1, ctx.barW)) * sp
        const cur = liveRef.current
        const next =
          which === 'in'
            ? Math.max(ctx.win.start, Math.min(t, cur.out - 0.1))
            : Math.min(ctx.win.end, Math.max(t, cur.in + 0.1))
        const nin = which === 'in' ? next : cur.in
        const nout = which === 'out' ? next : cur.out
        liveRef.current = { in: nin, out: nout }
        updateClipTimes(ctx.id, nin, nout)
        seek(ctx.offset + next) // 画面跟着手柄走，才对得准
      }
    })

  const inPan = useRef(make('in')).current
  const outPan = useRef(make('out')).current

  if (!clip) return null

  return (
    <View
      ref={barRef}
      style={[s.bar, { height }]}
      onLayout={(e) => {
        setBarW(e.nativeEvent.layout.width)
        barRef.current?.measureInWindow((x) => {
          barX.current = x
        })
      }}
    >
      <View
        style={[s.sel, { left: xOf(clip.in), width: Math.max(2, xOf(clip.out) - xOf(clip.in)) }]}
      />
      <View
        style={[s.handle, s.handleIn, { left: xOf(clip.in) - HANDLE / 2 }]}
        {...inPan.panHandlers}
      >
        <Text style={s.handleText}>‖</Text>
      </View>
      <View
        style={[s.handle, s.handleOut, { left: xOf(clip.out) - HANDLE / 2 }]}
        {...outPan.panHandlers}
      >
        <Text style={s.handleText}>‖</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(30,41,59,0.85)',
    borderRadius: 8,
    marginHorizontal: HANDLE / 2,
    justifyContent: 'center'
  },
  sel: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(8,145,178,0.45)' },
  handle: {
    position: 'absolute',
    top: -4,
    bottom: -4,
    width: HANDLE,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center'
  },
  handleIn: { backgroundColor: '#22d3ee' },
  handleOut: { backgroundColor: '#f59e0b' },
  handleText: { color: '#0f172a', fontSize: 13, fontWeight: '700' }
})

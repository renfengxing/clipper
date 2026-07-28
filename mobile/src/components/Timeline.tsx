import { useRef, useState } from 'react'
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native'
import { useStore } from '@core/store/useStore'
import { ordered, totalDuration, videoOffset, localToGlobal } from '@core/utils/timeline'

/**
 * 手机时间线：多视频分段 + 片段色条 + 待标记高亮 + 游标。
 * 触摸拖动 = scrub（手指按下即停止片段循环，便于跨视频）。
 */
interface TimelineProps {
  floating?: boolean
}

export function Timeline({ floating }: TimelineProps = {}): JSX.Element | null {
  const videos = useStore((s) => s.videos)
  const clips = useStore((s) => s.clips)
  const currentTime = useStore((s) => s.currentTime)
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const seek = useStore((s) => s.seek)
  const clearPreview = useStore((s) => s.clearPreview)
  const selectClip = useStore((s) => s.selectClip)
  const activeVideoId = useStore((s) => s.activeVideoId)

  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  const total = totalDuration(videos)

  // PanResponder 只创建一次，用 ref 读取每次渲染的最新值
  const ref = useRef({ total, clips, videos, seek, clearPreview, selectClip })
  ref.current = { total, clips, videos, seek, clearPreview, selectClip }

  const onLayout = (e: LayoutChangeEvent): void => {
    const w = e.nativeEvent.layout.width
    widthRef.current = w
    setWidth(w)
  }

  const timeAtX = (x: number): number | null => {
    const w = widthRef.current
    const t = ref.current.total
    if (w <= 0 || t <= 0) return null
    return Math.max(0, Math.min(t, (x / w) * t))
  }

  /** 该全局时间落在哪个片段上（用于区分「点片段」和「拖轨道」） */
  const clipAt = (t: number): string | null => {
    const { clips: cs, videos: vs } = ref.current
    const hit = cs.find((c) => {
      const gin = localToGlobal(vs, c.videoId, c.in)
      const gout = localToGlobal(vs, c.videoId, c.out)
      return t >= gin && t <= gout
    })
    return hit?.id ?? null
  }

  const movedRef = useRef(false)
  const hitClipRef = useRef<string | null>(null)

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const t = timeAtX(e.nativeEvent.locationX)
        movedRef.current = false
        hitClipRef.current = t == null ? null : clipAt(t)
        // 按在片段上：先不动，等松手判定为「点击片段」；按在空白处：立刻 scrub
        if (hitClipRef.current == null && t != null) {
          ref.current.clearPreview()
          ref.current.seek(t)
        }
      },
      onPanResponderMove: (e) => {
        movedRef.current = true
        hitClipRef.current = null // 变成拖拽，不再算点击片段
        const t = timeAtX(e.nativeEvent.locationX)
        if (t != null) {
          ref.current.clearPreview()
          ref.current.seek(t)
        }
      },
      onPanResponderRelease: () => {
        // 点在片段上且没拖动 → 从片段起点循环播放（与列表点击一致）
        if (!movedRef.current && hitClipRef.current) {
          ref.current.selectClip(hitClipRef.current)
        }
        hitClipRef.current = null
      }
    })
  ).current

  if (videos.length === 0 || total <= 0) return null

  const pct = (v: number): number => (v / total) * width
  const segs = ordered(videos)

  return (
    <View style={[s.wrap, floating && s.wrapFloat]}>
      {/* 视频分段标签 */}
      {segs.length > 1 && (
        <View style={[s.segRow, { width }]}>
          {segs.map((v, i) => (
            <View
              key={v.id}
              style={[
                s.seg,
                { left: pct(videoOffset(videos, v.id)), width: Math.max(18, pct(v.duration)) },
                v.id === activeVideoId && s.segActive
              ]}
            >
              <Text numberOfLines={1} style={s.segText}>
                {i + 1}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={[s.track, floating && s.trackFloat]} onLayout={onLayout} {...pan.panHandlers}>
        {/* 分段分界线 */}
        {segs.slice(1).map((v) => (
          <View key={v.id} style={[s.divider, { left: pct(videoOffset(videos, v.id)) }]} />
        ))}

        {/* 已存片段色条 */}
        {clips.map((c) => {
          const left = pct(localToGlobal(videos, c.videoId, c.in))
          const w = Math.max(3, pct(c.out - c.in))
          const on = c.id === selectedClipId
          return <View key={c.id} style={[s.clip, { left, width: w }, on && s.clipActive]} />
        })}

        {/* 标记中：起点 → 当前 的黄色高亮 */}
        {markIn != null && markOut == null && currentTime > markIn && (
          <View
            style={[s.pending, { left: pct(markIn), width: Math.max(2, pct(currentTime - markIn)) }]}
          />
        )}

        {/* 游标 */}
        <View style={[s.cursor, { left: Math.max(0, pct(currentTime) - 1) }]} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 },
  wrapFloat: { paddingHorizontal: 12, paddingBottom: 0 },
  segRow: { height: 14, marginBottom: 3 },
  seg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#1e293b',
    borderRadius: 3,
    justifyContent: 'center',
    paddingHorizontal: 3
  },
  segActive: { backgroundColor: '#334155' },
  segText: { color: '#94a3b8', fontSize: 9 },
  track: { height: 40, backgroundColor: '#1e293b', borderRadius: 6, overflow: 'hidden' },
  trackFloat: { height: 34, backgroundColor: 'rgba(30,41,59,0.6)' },
  divider: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#475569' },
  clip: { position: 'absolute', top: 4, bottom: 4, backgroundColor: 'rgba(59,130,246,0.8)', borderRadius: 2 },
  clipActive: { backgroundColor: '#22d3ee' },
  pending: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(250,204,21,0.3)' },
  cursor: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#22d3ee' }
})

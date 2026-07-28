import { useRef, useState } from 'react'
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent, Pressable, Alert } from 'react-native'
import { useStore } from '@core/store/useStore'
import { ordered, totalDuration, videoOffset, localToGlobal } from '@core/utils/timeline'

/**
 * 手机时间线：多视频分段 + 片段色条 + 待标记高亮 + 游标。
 * 触摸拖动 = scrub（手指按下即停止片段循环，便于跨视频）。
 */
interface TimelineProps {
  floating?: boolean
}

/** 超过这个位移才算拖拽，否则按「点击」处理 */
const DRAG_PX = 6

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
  const removeVideo = useStore((s) => s.removeVideo)
  const pause = useStore((s) => s.pause)
  const resume = useStore((s) => s.resume)

  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  const total = totalDuration(videos)

  // PanResponder 只创建一次，用 ref 读取每次渲染的最新值
  const ref = useRef({ total, clips, videos, seek, clearPreview, selectClip, pause, resume })
  ref.current = { total, clips, videos, seek, clearPreview, selectClip, pause, resume }
  /** 按下时是否在播 —— 拖完用它决定要不要续播 */
  const wasPlayingRef = useRef(false)

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
        wasPlayingRef.current = useStore.getState().playing
        hitClipRef.current = t == null ? null : clipAt(t)
        // 按在片段上：先不动，等松手判定为「点击片段」；按在空白处：立刻 scrub
        if (hitClipRef.current == null && t != null) {
          ref.current.clearPreview()
          ref.current.seek(t)
        }
      },
      onPanResponderMove: (e, g) => {
        // 手指落下时必然带几像素抖动，没有阈值的话「点片段」永远会被判成拖拽
        if (!movedRef.current && Math.abs(g.dx) <= DRAG_PX) return
        if (!movedRef.current) {
          // 确认是拖拽 → 先把播放停住。否则正放时播放器继续推进、
          // 倒放时 reverseTick 的 rAF 还在跑，都会和 scrub 抢着写 currentTime
          if (wasPlayingRef.current) ref.current.pause()
        }
        movedRef.current = true
        hitClipRef.current = null // 确认是拖拽，不再算点击片段
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
        } else if (movedRef.current && wasPlayingRef.current) {
          // 拖完续播，按拖之前的方向和倍率
          ref.current.resume()
        }
        hitClipRef.current = null
      },
      // 横屏时时间线浮在 VideoStage 上，拖到一半别被父级的调速手势抢走
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true
    })
  ).current

  if (videos.length === 0 || total <= 0) return null

  const pct = (v: number): number => (v / total) * width
  const segs = ordered(videos)

  return (
    <View style={[s.wrap, floating && s.wrapFloat]}>
      {/* 视频分段标签：横屏浮层里不显示 —— 太占高度，且视频的增删排序已经
          有「视频 N」面板可用，轨道上的分界线也仍然标出了各段边界 */}
      {!floating && segs.length > 1 && (
        <View style={[s.segRow, { width }]}>
          {segs.map((v, i) => (
            // 点=跳到该视频开头；长按=从时间线移除（片段仍随视频保留）
            <Pressable
              key={v.id}
              style={[
                s.seg,
                { left: pct(videoOffset(videos, v.id)), width: Math.max(22, pct(v.duration)) },
                v.id === activeVideoId && s.segActive
              ]}
              onPress={() => {
                ref.current.clearPreview()
                ref.current.seek(videoOffset(ref.current.videos, v.id))
              }}
              onLongPress={() =>
                Alert.alert(
                  `移除视频 ${i + 1}`,
                  `${v.fileName}\n\n只从这条时间线移除，片段数据仍保留，重新添加即可恢复。`,
                  [
                    { text: '取消', style: 'cancel' },
                    { text: '移除', style: 'destructive', onPress: () => removeVideo(v.id) }
                  ]
                )
              }
            >
              <Text numberOfLines={1} style={s.segText}>
                {i + 1} ⋯
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 轨道内的装饰层一律 pointerEvents=none：
          RN 的 locationX 是相对「触摸目标」算的，若点中的是片段色条这类子 View，
          拿到的就是相对色条自身的坐标，换算出的时间完全不对 —— 表现为点片段跳到开头 */}
      {/* 轨道视觉上很细，但用 hitSlop 把可触区域上下各撑开 —— 否则手指稍偏就落到
          外层 padding 上，touch 冒泡给 VideoStage 变成「按住调速」 */}
      <View
        style={[s.track, floating && s.trackFloat]}
        hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
        onLayout={onLayout}
        {...pan.panHandlers}
      >
        {/* 分段分界线 */}
        {segs.slice(1).map((v) => (
          <View
            key={v.id}
            pointerEvents="none"
            style={[s.divider, { left: pct(videoOffset(videos, v.id)) }]}
          />
        ))}

        {/* 已存片段色条 */}
        {clips.map((c) => {
          const left = pct(localToGlobal(videos, c.videoId, c.in))
          const w = Math.max(3, pct(c.out - c.in))
          const on = c.id === selectedClipId
          return (
            <View
              key={c.id}
              pointerEvents="none"
              style={[s.clip, { left, width: w }, on && s.clipActive]}
            />
          )
        })}

        {/* 标记中：起点 → 当前 的黄色高亮 */}
        {markIn != null && markOut == null && currentTime > markIn && (
          <View
            pointerEvents="none"
            style={[s.pending, { left: pct(markIn), width: Math.max(2, pct(currentTime - markIn)) }]}
          />
        )}

        {/* 游标 */}
        <View pointerEvents="none" style={[s.cursor, { left: Math.max(0, pct(currentTime) - 1) }]} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 },
  wrapFloat: { paddingHorizontal: 12, paddingBottom: 0 },
  segRow: { height: 20, marginBottom: 4 },
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
  segText: { color: '#cbd5e1', fontSize: 10 },
  track: { height: 40, backgroundColor: '#1e293b', borderRadius: 6, overflow: 'hidden' },
  trackFloat: { height: 20, backgroundColor: 'rgba(30,41,59,0.6)' },
  divider: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#475569' },
  clip: { position: 'absolute', top: 4, bottom: 4, backgroundColor: 'rgba(59,130,246,0.8)', borderRadius: 2 },
  clipActive: { backgroundColor: '#22d3ee' },
  pending: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(250,204,21,0.3)' },
  cursor: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#22d3ee' }
})

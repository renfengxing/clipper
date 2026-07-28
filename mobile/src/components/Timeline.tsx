import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent, Pressable, Alert } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useStore } from '@core/store/useStore'
import { fmtMs } from '@core/utils/time'
import {
  ordered,
  totalDuration,
  videoOffset,
  localToGlobal,
  clipGlobalIn,
  clipGlobalOut,
  isSpanning
} from '@core/utils/timeline'

/**
 * 手机时间线：多视频分段 + 片段色条 + 待标记高亮 + 游标 + 选中片段的起止手柄。
 *
 * 选中片段后会自动放大到该片段附近。原因：一场比赛动辄几十分钟，
 * 十几秒的片段在整条轨道上不到一个像素，手柄既叠在一起也拖不准 ——
 * 放大的是时间线本身，不是另起一个控件，「全部」一点即可退回全长。
 */
interface TimelineProps {
  floating?: boolean
}

/** 超过这个位移才算拖拽，否则按「点击」处理 */
const DRAG_PX = 6
/** 起止手柄的宽度 */
const HANDLE = 30

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
  const updateClipRange = useStore((s) => s.updateClipRange)
  const deselectClip = useStore((s) => s.deselectClip)

  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  const total = totalDuration(videos)

  const sel = clips.find((c) => c.id === selectedClipId) || null
  const selGin = sel ? clipGlobalIn(videos, sel) : 0
  const selGout = sel ? clipGlobalOut(videos, sel) : 0

  // 可视时间窗口。null = 看全长
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null)

  // 只在「选中的片段变了」时重设窗口 —— 拖动过程中不能跟着变，否则标尺自己在动
  useEffect(() => {
    if (!selectedClipId) {
      setZoom(null)
      return
    }
    const c = clips.find((x) => x.id === selectedClipId)
    if (!c) return
    const gin = clipGlobalIn(videos, c)
    const gout = clipGlobalOut(videos, c)
    const pad = Math.max(3, (gout - gin) * 1.2)
    setZoom({ start: Math.max(0, gin - pad), end: Math.min(total || gout + pad, gout + pad) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId])

  const viewStart = zoom ? zoom.start : 0
  const viewEnd = zoom ? zoom.end : total
  const viewSpan = Math.max(0.001, viewEnd - viewStart)

  const ref = useRef({
    total,
    clips,
    videos,
    seek,
    clearPreview,
    selectClip,
    pause,
    resume,
    updateClipRange,
    deselectClip,
    viewStart,
    viewSpan
  })
  ref.current = {
    total,
    clips,
    videos,
    seek,
    clearPreview,
    selectClip,
    pause,
    resume,
    updateClipRange,
    deselectClip,
    viewStart,
    viewSpan
  }

  const onLayout = (e: LayoutChangeEvent): void => {
    const w = e.nativeEvent.layout.width
    widthRef.current = w
    setWidth(w)
  }

  /** 轨道内 x → 全局时间（按当前可视窗口换算） */
  const timeAtX = (x: number): number | null => {
    const w = widthRef.current
    if (w <= 0 || ref.current.total <= 0) return null
    const t = ref.current.viewStart + (x / w) * ref.current.viewSpan
    return Math.max(0, Math.min(ref.current.total, t))
  }

  /** 该全局时间落在哪个片段上（用于区分「点片段」和「拖轨道」） */
  const clipAt = (t: number): string | null => {
    const { clips: cs, videos: vs } = ref.current
    const hit = cs.find((c) => t >= clipGlobalIn(vs, c) && t <= clipGlobalOut(vs, c))
    return hit?.id ?? null
  }

  const movedRef = useRef(false)
  const hitClipRef = useRef<string | null>(null)
  const wasPlayingRef = useRef(false)
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedClipId
  /** 按下手柄那一刻的起止时间，拖动期间以它为基准 */
  const dragBaseRef = useRef<{ in: number; out: number } | null>(null)
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null)
  /** 拖到所属视频的头/尾了。片段不能跨视频（见 core 的 addClip），到此为止 */
  const [atEdge, setAtEdge] = useState<'start' | 'end' | null>(null)
  const edgeBuzzRef = useRef(false)

  /**
   * 起止手柄。位置用「按下时的时间 + 位移换算的时间差」算，
   * 不依赖任何绝对坐标 —— measureInWindow 的原点不保证可靠，
   * 一旦为 0，绝对算法会把时间直接算到轨道末端。
   */
  const makeHandle = (which: 'in' | 'out'): ReturnType<typeof PanResponder.create> =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        ref.current.pause() // 播放头会跟拖动抢位置
        ref.current.clearPreview()
        setAtEdge(null)
        edgeBuzzRef.current = false
        const c = ref.current.clips.find((x) => x.id === selectedIdRef.current)
        // 基准记全局时间：跨视频时局部时间会换参照系，只有全局是连续的
        dragBaseRef.current = c
          ? { in: clipGlobalIn(ref.current.videos, c), out: clipGlobalOut(ref.current.videos, c) }
          : null
        setDragging(which)
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      },
      onPanResponderMove: (_e, g) => {
        const { clips: cs, total: tot } = ref.current
        const base = dragBaseRef.current
        const c = cs.find((x) => x.id === selectedIdRef.current)
        const w = widthRef.current
        if (!c || !base || w <= 0) return
        const delta = (g.dx / w) * ref.current.viewSpan
        // 全局时间上算，跨不跨视频都一样；落到哪个视频由 updateClipRange 决定
        const wantIn = base.in + delta
        const wantOut = base.out + delta
        const nin = which === 'in' ? Math.max(0, Math.min(wantIn, base.out - 0.1)) : base.in
        const nout = which === 'out' ? Math.min(tot, Math.max(wantOut, base.in + 0.1)) : base.out

        // 只在顶到整条时间线的头/尾时提示，视频之间的边界现在可以自由跨过
        const edge = which === 'in' && wantIn < 0 ? 'start' : which === 'out' && wantOut > tot ? 'end' : null
        setAtEdge(edge)
        if (edge && !edgeBuzzRef.current) {
          edgeBuzzRef.current = true
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        } else if (!edge) {
          edgeBuzzRef.current = false
        }

        ref.current.updateClipRange(c.id, nin, nout)
        const g0 = which === 'in' ? nin : nout
        ref.current.seek(g0)

        // 拖到窗口边缘就让窗口跟着平移，否则手柄会跑到屏幕外，
        // 既看不见、也没法再往外扩 —— 只平移不缩放，px↔时间的比例保持不变，
        // 拖动手感才是线性的
        const vs0 = ref.current.viewStart
        const span = ref.current.viewSpan
        const margin = span * 0.12
        let shift = 0
        if (g0 < vs0 + margin) shift = g0 - margin - vs0
        else if (g0 > vs0 + span - margin) shift = g0 + margin - (vs0 + span)
        if (shift !== 0 && tot > span) {
          const ns = Math.max(0, Math.min(vs0 + shift, tot - span))
          setZoom({ start: ns, end: ns + span })
        } else if (shift !== 0) {
          setZoom({ start: 0, end: tot })
        }
      },
      onPanResponderRelease: () => {
        setDragging(null)
        setAtEdge(null)
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      },
      onPanResponderTerminate: () => {
        setDragging(null)
        setAtEdge(null)
      }
    })

  const inPan = useRef(makeHandle('in')).current
  const outPan = useRef(makeHandle('out')).current

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
          ref.current.deselectClip() // 点到片段外 → 退出编辑态，手柄收起
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

  /** 全局时间 → 轨道内 x（按当前可视窗口） */
  const pct = (v: number): number => ((v - viewStart) / viewSpan) * width
  const segs = ordered(videos)

  // 手柄位置。片段窄到两手柄会叠时才撑开，放大之后基本用不上这条兜底
  let selL = pct(selGin)
  let selR = pct(selGout)
  if (sel && selR - selL < HANDLE * 0.7) {
    const mid = (selL + selR) / 2
    selL = mid - HANDLE * 0.35
    selR = mid + HANDLE * 0.35
  }
  // 端点落在窗口之外时把手柄贴在边上，绝不让它跑出屏幕（跑出去就再也抓不回来了）
  const clampX = (x: number): number => Math.max(HANDLE / 2, Math.min(x, Math.max(HANDLE / 2, width - HANDLE / 2)))
  const selLc = clampX(selL)
  const selRc = clampX(selR)

  return (
    <View style={[s.wrap, floating && s.wrapFloat]}>
      {/* 编辑条：选中片段后出现，实时显示起止时间，兼作「拖动有没有生效」的反馈 */}
      {sel && (
        <View style={s.editBar}>
          <Text style={s.editIn}>{fmtMs(sel.in)}</Text>
          <Text style={s.editArrow}>→</Text>
          <Text style={s.editOut}>{fmtMs(sel.out)}</Text>
          <Text style={s.editDur}>{(sel.out - sel.in).toFixed(1)}s</Text>
          {atEdge ? (
            <Text style={s.editWarn}>
              已到时间线{atEdge === 'start' ? '开头' : '结尾'}
            </Text>
          ) : (
            <>
              {selL < 0 && <Text style={s.editEdge}>◀</Text>}
              {selR > width && <Text style={s.editEdge}>▶</Text>}
            </>
          )}
          {zoom && (
            <Pressable onPress={() => setZoom(null)} hitSlop={8}>
              <Text style={s.editAction}>全部</Text>
            </Pressable>
          )}
          <Pressable onPress={() => deselectClip()} hitSlop={8}>
            <Text style={s.editAction}>完成</Text>
          </Pressable>
        </View>
      )}

      {/* 视频分段标签：横屏浮层里不显示 —— 太占高度，且视频的增删排序已经
          有「视频 N」面板可用，轨道上的分界线也仍然标出了各段边界 */}
      {!floating && !sel && segs.length > 1 && (
        <View style={[s.segRow, { width }]}>
          {segs.map((v, i) => (
            <Pressable
              key={v.id}
              style={[
                s.seg,
                { left: pct(videoOffset(videos, v.id)), width: Math.max(22, pct(v.duration) - pct(0)) },
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

      {/* 轨道视觉上很细，用 hitSlop 把可触区域上下撑开。
          左右不撑：那两侧换算出的时间是负数或超尾，会被夹到 0 —— 表现为「点一下跳回开头」 */}
      {/* 手柄必须和轨道平级，不能做它的子元素：
          轨道自己也有 onMoveShouldSetPanResponder，做父级会在拖动中途把响应权抢走，
          接着按「点在片段外」处理 → deselectClip → 手柄凭空消失、区间也没改成 */}
      <View style={[s.trackArea, floating && s.trackAreaFloat]}>
      <View
        style={[s.track, floating && s.trackFloat]}
        hitSlop={{ top: 14, bottom: 14, left: 0, right: 0 }}
        onLayout={onLayout}
        {...pan.panHandlers}
      >
        {/* 色条层单独裁剪：轨道本身不能 overflow:hidden，
            否则伸出轨道上下的手柄会被裁掉，连触摸都收不到 */}
        <View style={s.clipLayer} pointerEvents="none">
          {segs.slice(1).map((v) => (
            <View key={v.id} style={[s.divider, { left: pct(videoOffset(videos, v.id)) }]} />
          ))}

          {clips.map((c) => {
            const left = pct(clipGlobalIn(videos, c))
            const w = Math.max(2, pct(clipGlobalOut(videos, c)) - left)
            const on = c.id === selectedClipId
            return (
              <View
                key={c.id}
                style={[s.clip, { left, width: w }, on && s.clipActive, isSpanning(c) && s.clipSpan]}
              />
            )
          })}

          {markIn != null && markOut == null && currentTime > markIn && (
            <View
              style={[s.pending, { left: pct(markIn), width: Math.max(2, pct(currentTime) - pct(markIn)) }]}
            />
          )}

          <View style={[s.cursor, { left: Math.max(0, pct(currentTime) - 1) }]} />
        </View>

      </View>

        {/* box-none：手柄之外的地方照常穿透给轨道 */}
        {sel && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View
              style={[s.handle, s.handleIn, dragging === 'in' && s.handleOn, { left: selLc - HANDLE / 2 }]}
              hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
              {...inPan.panHandlers}
            >
              <Text style={s.handleText}>‖</Text>
            </View>
            <View
              style={[s.handle, s.handleOut, dragging === 'out' && s.handleOn, { left: selRc - HANDLE / 2 }]}
              hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
              {...outPan.panHandlers}
            >
              <Text style={s.handleText}>‖</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 },
  wrapFloat: { paddingHorizontal: 12, paddingBottom: 0 },

  editBar: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 6, paddingHorizontal: 2 },
  editIn: { color: '#22d3ee', fontSize: 12, fontVariant: ['tabular-nums'] },
  editArrow: { color: '#475569', fontSize: 11 },
  editOut: { color: '#f59e0b', fontSize: 12, fontVariant: ['tabular-nums'] },
  editDur: { color: '#94a3b8', fontSize: 11, marginLeft: 2 },
  editEdge: { color: '#f59e0b', fontSize: 11 },
  editWarn: { color: '#fbbf24', fontSize: 10, flexShrink: 1 },
  editAction: { color: '#e2e8f0', fontSize: 12, marginLeft: 10 },

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

  trackArea: { height: 40 },
  trackAreaFloat: { height: 20 },
  track: { height: 40, backgroundColor: '#1e293b', borderRadius: 6 },
  trackFloat: { height: 20, backgroundColor: 'rgba(30,41,59,0.6)' },
  clipLayer: { ...StyleSheet.absoluteFillObject, borderRadius: 6, overflow: 'hidden' },

  divider: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#475569' },
  clip: { position: 'absolute', top: 4, bottom: 4, backgroundColor: 'rgba(59,130,246,0.8)', borderRadius: 2 },
  clipActive: { backgroundColor: '#22d3ee' },
  // 跨视频的片段描个边，一眼能看出它接了两段素材
  clipSpan: { borderWidth: 1, borderColor: '#a78bfa' },
  pending: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(250,204,21,0.3)' },
  cursor: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#22d3ee' },

  handle: {
    position: 'absolute',
    top: -11,
    bottom: -11,
    width: HANDLE,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center'
  },
  handleOn: { transform: [{ scale: 1.15 }] },
  handleIn: { backgroundColor: '#22d3ee' },
  handleOut: { backgroundColor: '#f59e0b' },
  handleText: { color: '#0f172a', fontSize: 12, fontWeight: '700' }
})

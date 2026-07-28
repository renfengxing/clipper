import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  type GestureResponderEvent
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { useStore } from '@core/store/useStore'

/**
 * 两条倍率梯都按「离落点由近及远」排列，于是手指往哪边滑、高亮就往哪边走：
 * 右滑用 FWD（渲染顺序即数组顺序），左滑用 REV（渲染时反转，最快的排在最左）。
 */
const FWD = [0.1, 0.25, 0.5, 1, 2, 4, 8]
/** 倒放是手动回退帧，倍率太高会很卡，封顶 4x */
const REV = [-1, -2, -4]

const STEP_PX = 38 // 每档所需位移
const DEAD_PX = 14 // 死区：按住但几乎没动 → 不选任何档
const HOLD_MS = 220 // 按住多久进入调速模式
const FLICK_PX = 60 // 快速滑动的最小位移
const FLICK_V = 0.5 // 快速滑动的最小速度
const VERTICAL_CANCEL_PX = 12 // 竖向位移超过这个值就不再当作调速手势
const BTN_HOLD_MS = 1400 // 播放/暂停按钮停留多久后淡出

type Dir = 'fwd' | 'rev'
interface Pick {
  dir: Dir
  idx: number // -1 = 还没选中任何档
  x: number // 按下时的落点（相对 stage）：倍率条锚定在这里，不跟手漂
  y: number
}

interface Size {
  w: number
  h: number
}

interface Props {
  children: ReactNode // <Video> 及其上的静态浮层
  onFlick: (dir: 'left' | 'right') => void
  enabled: boolean
  /**
   * 底部保留高度：这块归时间线，本组件一律不接管。
   * 只靠时间线自己的 hitSlop 不够 —— 没打中轨道的触摸会冒泡上来，
   * 被误判成「按住调速」或「快速横滑收展列表」。
   */
  bottomInset?: number
}

/**
 * 视频区手势分层：
 *  轻点        → 播放/暂停
 *  按住再横滑  → 弹出倍率条（右=慢放/快进，左=快退），松手应用
 *  快速横滑    → 收起/展开片段列表（onFlick）
 */
export function VideoStage({ children, onFlick, enabled, bottomInset = 0 }: Props): JSX.Element {
  const playing = useStore((s) => s.playing)
  const rate = useStore((s) => s.rate)
  const direction = useStore((s) => s.direction)
  const togglePlay = useStore((s) => s.togglePlay)
  const setSignedRate = useStore((s) => s.setSignedRate)
  const pause = useStore((s) => s.pause)
  const resume = useStore((s) => s.resume)

  const [pick, setPick] = useState<Pick | null>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const stageRef = useRef<Size>({ w: 0, h: 0 })
  const viewRef = useRef<View>(null)
  /** stage 在窗口里的原点，用来把 pageX/pageY 换算成 stage 内坐标 */
  const originRef = useRef({ x: 0, y: 0 })
  const insetRef = useRef(bottomInset)
  insetRef.current = bottomInset
  /** 本次触摸是不是从底部死区起手的 */
  const startedLowRef = useRef(false)

  /**
   * 一律用 pageX/pageY 换算，绝不能用 locationX/locationY ——
   * 后者是相对「触摸目标」算的，摸在时间线等子 View 上时会得到相对那个子 View 的坐标，
   * 于是死区判定失效、弹窗位置也被算到屏幕角落去。
   */
  const localPoint = (e: GestureResponderEvent): { x: number; y: number } => ({
    x: e.nativeEvent.pageX - originRef.current.x,
    y: e.nativeEvent.pageY - originRef.current.y
  })

  /** 触点是否落在底部时间线专属区 */
  const inDeadZone = (e: GestureResponderEvent): boolean =>
    insetRef.current > 0 &&
    stageRef.current.h > 0 &&
    localPoint(e).y > stageRef.current.h - insetRef.current
  const [bar, setBar] = useState<Size>({ w: 0, h: 0 })
  const holdRef = useRef(false)
  const movedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickRef = useRef<Pick | null>(null)
  const cbRef = useRef({ onFlick, togglePlay, setSignedRate, pause, resume, enabled })
  cbRef.current = { onFlick, togglePlay, setSignedRate, pause, resume, enabled }
  /** 进入调速模式前是否在播 —— 松手没选档时用它还原 */
  const wasPlayingRef = useRef(false)

  // —— 播放/暂停按钮：亮一下就淡出，不长期挡着画面 ——
  const btnOpacity = useRef(new Animated.Value(0)).current
  const btnAnim = useRef<Animated.CompositeAnimation | null>(null)
  const flashButton = useCallback((): void => {
    btnAnim.current?.stop()
    const a = Animated.sequence([
      Animated.timing(btnOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.delay(BTN_HOLD_MS),
      Animated.timing(btnOpacity, { toValue: 0, duration: 320, useNativeDriver: true })
    ])
    btnAnim.current = a
    a.start()
  }, [btnOpacity])

  // 播放态一变（含首次有视频时）就闪一下，其余时间保持隐藏
  useEffect(() => {
    if (enabled) flashButton()
  }, [playing, enabled, flashButton])

  useEffect(() => () => btnAnim.current?.stop(), [])

  const clearTimer = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const setPickBoth = (p: Pick | null): void => {
    pickRef.current = p
    setPick(p)
  }

  const pan = useRef(
    PanResponder.create({
      // 起手点决定归属，不能用当前位置判断：
      // 从底边往斜上滑时，等我们收到 move 手指已经离开死区了，
      // 于是 VideoStage 中途接管、起了长按计时器 —— 这才是斜上滑仍会弹倍率条的原因。
      // onStartShouldSetPanResponder 在每次触摸开始时都会被调用（即便最终没拿到响应者），
      // 正好用来记住起手位置。
      onStartShouldSetPanResponder: (e) => {
        // 没有视频时这里没有任何可操作的东西。此前忘了判 enabled，
        // 于是空白态下它照样抢走响应权再空转，压在上面的「最近打开」就点不动了
        if (!cbRef.current.enabled) return false
        startedLowRef.current = inDeadZone(e)
        return !startedLowRef.current
      },
      onMoveShouldSetPanResponder: (e, g) =>
        cbRef.current.enabled &&
        !startedLowRef.current &&
        !inDeadZone(e) &&
        (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
      onPanResponderGrant: (e) => {
        if (!cbRef.current.enabled) return
        holdRef.current = false
        movedRef.current = false
        if (pickRef.current) setPickBoth(null) // 清掉上一次被系统截断留下的残留
        // 按住一小会儿 → 进入调速模式（与「快速滑动」区分开）
        clearTimer()
        const at = localPoint(e)
        timerRef.current = setTimeout(() => {
          holdRef.current = true
          // 选倍率时先把画面停住：正放/快进/慢放/倒放都停，看清当前这一帧再决定
          wasPlayingRef.current = useStore.getState().playing
          if (wasPlayingRef.current) cbRef.current.pause()
          // 先亮出正向条做提示，未选中任何档
          setPickBoth({ dir: 'fwd', idx: -1, x: at.x, y: at.y })
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        }, HOLD_MS)
      },
      onPanResponderMove: (_e, g) => {
        if (!cbRef.current.enabled) return
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) movedRef.current = true
        if (!holdRef.current) {
          // 还没进入调速模式：快速横滑判为「收展列表」，明显竖滑判为系统手势/误触，
          // 两种都要取消 hold 计时。少了竖向这一条，从底边上滑就会弹出倍率条
          if (Math.abs(g.vx) > FLICK_V || Math.abs(g.dy) > VERTICAL_CANCEL_PX) clearTimer()
          return
        }
        // 调速模式：滑动方向决定用哪条倍率梯，位移决定停在哪一档。
        // 这里只用 dx，不再掺速度加成 —— vx 抖一下档位就乱跳；
        // 到头也不 clamp，改成回绕，滑到底继续滑会从最近的一档重新开始
        const dir: Dir = g.dx >= 0 ? 'fwd' : 'rev'
        const list = dir === 'fwd' ? FWD : REV
        const dist = Math.abs(g.dx)
        const steps = dist < DEAD_PX ? -1 : Math.floor((dist - DEAD_PX) / STEP_PX)
        const idx = steps < 0 ? -1 : steps % list.length
        const cur = pickRef.current
        if (!cur) return
        // 位置锚定在按下的落点，不跟着手指漂：滑动只改变贴哪一侧和高亮档位
        if (cur.dir !== dir || cur.idx !== idx) {
          setPickBoth({ ...cur, dir, idx })
          if (cur.idx !== idx && idx >= 0) void Haptics.selectionAsync()
        }
      },
      onPanResponderRelease: (_e, g) => {
        clearTimer()
        const hadPick = pickRef.current != null
        setPickBoth(null) // 任何情况下都收起，不能只在 holdRef 为真时收
        if (!cbRef.current.enabled) return
        if (holdRef.current) {
          const p = pickRef.current
          if (p && p.idx >= 0) {
            cbRef.current.setSignedRate((p.dir === 'fwd' ? FWD : REV)[p.idx])
          } else if (wasPlayingRef.current) {
            // 按住没选档就松手 → 恢复成按住之前的播放状态
            cbRef.current.resume()
          }
          holdRef.current = false
          return
        }
        // 倍率条还开着但没进调速模式（被系统手势打断过）→ 这一下只用来关掉它
        if (hadPick) return
        // 快速横滑 → 收起/展开列表
        if (Math.abs(g.dx) > FLICK_PX && Math.abs(g.vx) > FLICK_V) {
          cbRef.current.onFlick(g.dx > 0 ? 'right' : 'left')
          return
        }
        // 没移动 → 轻点：播放/暂停
        if (!movedRef.current) cbRef.current.togglePlay()
      },
      onPanResponderTerminate: () => {
        clearTimer()
        if (holdRef.current && wasPlayingRef.current) cbRef.current.resume()
        holdRef.current = false
        setPickBoth(null)
      },
      // 系统手势（底边上滑等）随时可能接管，别赖着不放，否则残留状态清不掉
      onPanResponderTerminationRequest: () => true
    })
  ).current

  // 左侧梯反着渲染：最快的 ◀4x 排最左，于是手指往左滑高亮也往左走
  const isRev = pick?.dir === 'rev'
  const rateList = isRev ? [...REV].reverse() : FWD
  const hotIdx = pick == null || pick.idx < 0 ? -1 : isRev ? REV.length - 1 - pick.idx : pick.idx
  const label = (v: number): string => (v < 0 ? `◀${-v}x` : `${v}x`)

  // 倍率条锚定在「按下的落点」旁边（不是屏幕边、也不跟手漂）：
  // 右滑贴落点右侧、左滑贴左侧，只在换方向时整体挪一次，再夹进画面内避免出界
  const PAD = 10
  const GAP_PX = 18
  const ABOVE_PX = 26 // 抬到触点上方，免得被手指和手掌盖住
  const rawLeft = pick
    ? pick.dir === 'fwd'
      ? pick.x + GAP_PX
      : pick.x - GAP_PX - bar.w
    : 0
  const barPos = {
    left: Math.max(PAD, Math.min(rawLeft, Math.max(PAD, stage.w - bar.w - PAD))),
    top: Math.max(
      PAD,
      Math.min((pick?.y ?? 0) - bar.h - ABOVE_PX, Math.max(PAD, stage.h - bar.h - PAD))
    ),
    // 首帧还没量到尺寸，先不显示，避免闪一下再归位
    opacity: bar.w > 0 ? 1 : 0
  }

  return (
    <View
      ref={viewRef}
      style={s.stage}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout
        stageRef.current = { w, h }
        setStage({ w, h })
        // 记录自身在窗口里的原点，供 pageX/pageY 换算
        viewRef.current?.measureInWindow((x, y) => {
          originRef.current = { x, y }
        })
      }}
      {...pan.panHandlers}
    >
      {children}

      {/* 中央播放/暂停按钮：只在切换播放态后短暂显示。pointerEvents=none，
          让点击/按住手势统一交给整个 stage 处理 */}
      {enabled && pick == null && (
        <Animated.View style={[s.centerBtn, { opacity: btnOpacity }]} pointerEvents="none">
          <Text style={s.centerIcon}>{playing ? '❚❚' : '▶'}</Text>
        </Animated.View>
      )}

      {/* 调速条：按住横滑时弹出，左右方向对应两套倍率 */}
      {pick != null && (
        <View
          style={[s.rateWrap, barPos]}
          pointerEvents="none"
          onLayout={(e) =>
            setBar({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
        >
          <View style={s.rateBar}>
            {rateList.map((v, i) => (
              <View key={v} style={[s.rateItem, i === hotIdx && s.rateItemOn]}>
                <Text style={[s.rateText, i === hotIdx && s.rateTextOn]}>{label(v)}</Text>
              </View>
            ))}
          </View>
          <Text style={s.rateTip}>
            {pick.dir === 'rev' ? '← 快退　｜　右滑：慢放 / 快进' : '左滑：快退　｜　慢放 / 快进 →'}
          </Text>
        </View>
      )}

      {/* 当前非 1x 时角标提示 */}
      {enabled && pick == null && playing && rate !== 1 && (
        <View style={s.rateBadge} pointerEvents="none">
          <Text style={s.rateBadgeText}>
            {direction === 'reverse' ? '◀' : ''}
            {rate}x
          </Text>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  centerBtn: {
    position: 'absolute',
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(15,23,42,0.35)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  centerIcon: { color: 'rgba(255,255,255,0.85)', fontSize: 24 },
  // 倍率条贴在手指触点旁边（位置在渲染时按触点算）
  rateWrap: { position: 'absolute', alignItems: 'center' },
  rateBar: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(2,6,23,0.75)',
    borderRadius: 14,
    padding: 6
  },
  rateItem: { paddingVertical: 8, paddingHorizontal: 9, borderRadius: 9 },
  rateItemOn: { backgroundColor: '#0891b2' },
  rateText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  rateTextOn: { color: '#fff', fontSize: 15, fontWeight: '500' },
  rateTip: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 7 },
  rateBadge: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(8,145,178,0.8)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3
  },
  rateBadgeText: { color: '#fff', fontSize: 12, fontWeight: '500' }
})

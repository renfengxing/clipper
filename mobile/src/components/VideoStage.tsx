import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { View, Text, StyleSheet, PanResponder, Animated } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useStore } from '@core/store/useStore'

/** 向右滑：慢放 → 正常 → 快进（手指越往右，越靠倍率条右端） */
const FWD = [0.1, 0.25, 0.5, 1, 2, 4, 8]
/** 向左滑：快退（倒放是手动回退帧，太高倍率会很卡，封顶 4x） */
const REV = [-1, -2, -4]

const STEP_PX = 38 // 每档所需位移
const DEAD_PX = 14 // 死区：按住但几乎没动 → 不选任何档
const HOLD_MS = 220 // 按住多久进入调速模式
const FLICK_PX = 60 // 快速滑动的最小位移
const FLICK_V = 0.5 // 快速滑动的最小速度
const BTN_HOLD_MS = 1400 // 播放/暂停按钮停留多久后淡出

type Dir = 'fwd' | 'rev'
interface Pick {
  dir: Dir
  idx: number // -1 = 还没选中任何档
}

interface Props {
  children: ReactNode // <Video> 及其上的静态浮层
  onFlick: (dir: 'left' | 'right') => void
  enabled: boolean
}

/**
 * 视频区手势分层：
 *  轻点        → 播放/暂停
 *  按住再横滑  → 弹出倍率条（右=慢放/快进，左=快退），松手应用
 *  快速横滑    → 收起/展开片段列表（onFlick）
 */
export function VideoStage({ children, onFlick, enabled }: Props): JSX.Element {
  const playing = useStore((s) => s.playing)
  const rate = useStore((s) => s.rate)
  const direction = useStore((s) => s.direction)
  const togglePlay = useStore((s) => s.togglePlay)
  const setSignedRate = useStore((s) => s.setSignedRate)

  const [pick, setPick] = useState<Pick | null>(null)
  const holdRef = useRef(false)
  const movedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickRef = useRef<Pick | null>(null)
  const cbRef = useRef({ onFlick, togglePlay, setSignedRate, enabled })
  cbRef.current = { onFlick, togglePlay, setSignedRate, enabled }

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
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        if (!cbRef.current.enabled) return
        holdRef.current = false
        movedRef.current = false
        // 按住一小会儿 → 进入调速模式（与「快速滑动」区分开）
        clearTimer()
        timerRef.current = setTimeout(() => {
          holdRef.current = true
          setPickBoth({ dir: 'fwd', idx: -1 }) // 先亮出正向条做提示，未选中任何档
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        }, HOLD_MS)
      },
      onPanResponderMove: (_e, g) => {
        if (!cbRef.current.enabled) return
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) movedRef.current = true
        if (!holdRef.current) {
          // 还没进入调速模式：一旦快速滑走就取消 hold 计时（判为快速滑动）
          if (Math.abs(g.vx) > FLICK_V) clearTimer()
          return
        }
        // 调速模式：滑动方向决定用哪条倍率梯，位移(+速度加成)决定停在哪一档
        const boosted = g.dx + g.vx * 90
        const dir: Dir = boosted >= 0 ? 'fwd' : 'rev'
        const list = dir === 'fwd' ? FWD : REV
        const dist = Math.abs(boosted)
        const idx =
          dist < DEAD_PX
            ? -1
            : Math.max(0, Math.min(list.length - 1, Math.round((dist - DEAD_PX) / STEP_PX)))
        const cur = pickRef.current
        if (!cur || cur.dir !== dir || cur.idx !== idx) {
          setPickBoth({ dir, idx })
          if (idx >= 0) void Haptics.selectionAsync()
        }
      },
      onPanResponderRelease: (_e, g) => {
        clearTimer()
        if (!cbRef.current.enabled) return
        if (holdRef.current) {
          const p = pickRef.current
          // 只在真的选中了某一档时才改速度；按住没怎么动 → 保持原样
          if (p && p.idx >= 0) cbRef.current.setSignedRate((p.dir === 'fwd' ? FWD : REV)[p.idx])
          holdRef.current = false
          setPickBoth(null)
          return
        }
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
        holdRef.current = false
        setPickBoth(null)
      }
    })
  ).current

  const rateList = pick?.dir === 'rev' ? REV : FWD
  const label = (v: number): string => (v < 0 ? `◀${-v}x` : `${v}x`)

  return (
    <View style={s.stage} {...pan.panHandlers}>
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
          style={[s.rateWrap, pick.dir === 'rev' ? s.rateWrapLeft : s.rateWrapRight]}
          pointerEvents="none"
        >
          <View style={s.rateBar}>
            {rateList.map((v, i) => (
              <View key={v} style={[s.rateItem, i === pick.idx && s.rateItemOn]}>
                <Text style={[s.rateText, i === pick.idx && s.rateTextOn]}>{label(v)}</Text>
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
  // 倍率条跟着滑动方向走：右滑贴右侧、左滑贴左侧，手指落点和视线落点一致
  rateWrap: { position: 'absolute', alignItems: 'center' },
  rateWrapLeft: { left: 16 },
  rateWrapRight: { right: 16 },
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

import { useRef, useState, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, PanResponder } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useStore } from '@core/store/useStore'

/** 倍率梯：负=倒放，正=正放。中间 1x 为原点 */
const RATES = [-4, -2, 0.1, 0.25, 1, 2, 4, 8]
const BASE = RATES.indexOf(1)
const STEP_PX = 42 // 每档所需位移
const HOLD_MS = 220 // 按住多久进入调速模式
const FLICK_PX = 60 // 快速滑动的最小位移
const FLICK_V = 0.5 // 快速滑动的最小速度

interface Props {
  children: ReactNode // <Video> 及其上的静态浮层
  onFlick: (dir: 'left' | 'right') => void
  enabled: boolean
}

/**
 * 视频区手势分层：
 *  轻点        → 播放/暂停
 *  按住再横滑  → 弹出倍率条，按位移+速度高亮，松手应用
 *  快速横滑    → 收起/展开片段列表（onFlick）
 */
export function VideoStage({ children, onFlick, enabled }: Props): JSX.Element {
  const playing = useStore((s) => s.playing)
  const rate = useStore((s) => s.rate)
  const direction = useStore((s) => s.direction)
  const togglePlay = useStore((s) => s.togglePlay)
  const setSignedRate = useStore((s) => s.setSignedRate)

  const [pickIdx, setPickIdx] = useState<number | null>(null)
  const holdRef = useRef(false)
  const movedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idxRef = useRef(BASE)
  const cbRef = useRef({ onFlick, togglePlay, setSignedRate, enabled })
  cbRef.current = { onFlick, togglePlay, setSignedRate, enabled }

  const clearTimer = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
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
          idxRef.current = BASE
          setPickIdx(BASE)
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
        // 调速模式：位移 + 速度共同决定高亮档位（滑得快跳得多）
        const boosted = g.dx + g.vx * 90
        const next = Math.max(0, Math.min(RATES.length - 1, BASE + Math.round(boosted / STEP_PX)))
        if (next !== idxRef.current) {
          idxRef.current = next
          setPickIdx(next)
          void Haptics.selectionAsync()
        }
      },
      onPanResponderRelease: (_e, g) => {
        clearTimer()
        if (!cbRef.current.enabled) return
        if (holdRef.current) {
          cbRef.current.setSignedRate(RATES[idxRef.current]) // 应用高亮的倍率
          holdRef.current = false
          setPickIdx(null)
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
        setPickIdx(null)
      }
    })
  ).current

  const label = (v: number): string => (v < 0 ? `◀${-v}x` : `${v}x`)

  return (
    <View style={s.stage} {...pan.panHandlers}>
      {children}

      {/* 中央播放/暂停浮动按钮 */}
      {enabled && pickIdx == null && (
        <Pressable style={s.centerBtn} onPress={() => togglePlay()} hitSlop={10}>
          <Text style={s.centerIcon}>{playing ? '❚❚' : '▶'}</Text>
        </Pressable>
      )}

      {/* 调速条：按住横滑时弹出 */}
      {pickIdx != null && (
        <View style={s.rateBar} pointerEvents="none">
          {RATES.map((v, i) => (
            <View key={v} style={[s.rateItem, i === pickIdx && s.rateItemOn]}>
              <Text style={[s.rateText, i === pickIdx && s.rateTextOn]}>{label(v)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 当前非 1x 时角标提示 */}
      {enabled && pickIdx == null && playing && rate !== 1 && (
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
  rateBar: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(2,6,23,0.75)',
    borderRadius: 14,
    padding: 6
  },
  rateItem: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 },
  rateItemOn: { backgroundColor: '#0891b2' },
  rateText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  rateTextOn: { color: '#fff', fontSize: 15, fontWeight: '500' },
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

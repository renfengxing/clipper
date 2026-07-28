import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useStore } from '@core/store/useStore'
import { fmtMs } from '@core/utils/time'
import { TrimBar } from './TrimBar'

interface Props {
  clipId: string
  floating?: boolean // 横屏浮在画面上
  onDone: () => void
}

/**
 * 裁剪模式：临时顶掉时间线，把拖拽手柄放到同一个位置。
 * 这样画面全程可见 —— 编辑面板是弹窗，一弹出来就把要看的东西挡住了。
 */
export function TrimPanel({ clipId, floating, onDone }: Props): JSX.Element | null {
  const clips = useStore((s) => s.clips)
  const selectClip = useStore((s) => s.selectClip)
  const clip = clips.find((c) => c.id === clipId)
  if (!clip) return null

  return (
    <View style={[s.wrap, floating && s.wrapFloat]}>
      <View style={s.head}>
        <Text numberOfLines={1} style={s.title}>
          {clip.title || '未命名片段'}
        </Text>
        <Text style={s.times}>
          {fmtMs(clip.in)} → {fmtMs(clip.out)} · {(clip.out - clip.in).toFixed(1)}s
        </Text>
        <Pressable style={s.playBtn} onPress={() => selectClip(clip.id)} hitSlop={6}>
          <Text style={s.playText}>▶ 试看</Text>
        </Pressable>
        <Pressable style={s.doneBtn} onPress={onDone} hitSlop={6}>
          <Text style={s.doneText}>完成</Text>
        </Pressable>
      </View>
      <TrimBar clipId={clipId} height={34} />
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 },
  wrapFloat: { backgroundColor: 'rgba(2,6,23,0.55)', borderRadius: 12, marginHorizontal: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6, paddingHorizontal: 4 },
  title: { color: '#e2e8f0', fontSize: 12, flexShrink: 1 },
  times: { color: '#94a3b8', fontSize: 11, fontVariant: ['tabular-nums'], marginLeft: 'auto' },
  playBtn: {
    borderRadius: 7,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderWidth: 0.5,
    borderColor: 'rgba(148,163,184,0.5)'
  },
  playText: { color: '#cbd5e1', fontSize: 12 },
  doneBtn: { backgroundColor: '#0891b2', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 12 },
  doneText: { color: '#fff', fontSize: 12, fontWeight: '500' }
})

import { View, Text, StyleSheet } from 'react-native'
import { useStore } from '@core/store/useStore'
import { localToGlobal } from '@core/utils/timeline'

/**
 * 播放时在画面下方显示当前命中片段的标题（与 PC 版 #75/#84 一致）。
 * 导出时烧进画面的也是同一份文字，这里让屏幕上先看到效果。
 */
export function Subtitle(): JSX.Element | null {
  const on = useStore((s) => s.subtitleOn)
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const currentTime = useStore((s) => s.currentTime)

  if (!on) return null
  const hits = clips.filter((c) => {
    if (!c.title) return false
    const gin = localToGlobal(videos, c.videoId, c.in)
    const gout = localToGlobal(videos, c.videoId, c.out)
    return currentTime >= gin && currentTime <= gout
  })
  if (hits.length === 0) return null

  return (
    <View style={s.wrap} pointerEvents="none">
      {hits.map((c) => (
        <Text key={c.id} style={s.text} numberOfLines={2}>
          {c.title}
        </Text>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 84, alignItems: 'center', gap: 3 },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    // 描边靠阴影模拟，保证亮底画面上也看得清
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 }
  }
})

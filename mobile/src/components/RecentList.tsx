import { useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useStore } from '@core/store/useStore'
import { platform } from '@core/ports'

/** 空白态里的「最近的时间线」，点一下直接打开（与 PC 版一致） */
export function RecentList(): JSX.Element | null {
  const videos = useStore((s) => s.videos)
  const openVideoPath = useStore((s) => s.openVideoPath)
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (videos.length > 0) return
    platform()
      .getRecent()
      .then(setRecent)
      .catch(() => {})
  }, [videos.length])

  if (videos.length > 0 || recent.length === 0) return null

  const label = (key: string): string => {
    const tail = decodeURIComponent(key.split('/').pop() || key)
    return tail.replace(/\.kkclip$/, '')
  }

  return (
    <View style={s.wrap}>
      <Text style={s.head}>最近的时间线</Text>
      <ScrollView style={s.list}>
        {recent.map((p) => (
          <Pressable key={p} style={s.row} onPress={() => void openVideoPath(p)}>
            <Text numberOfLines={1} style={s.rowText}>
              🎞 {label(p)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 24, right: 24, bottom: 30, maxHeight: '55%' },
  head: { color: '#475569', fontSize: 11, marginBottom: 6, paddingHorizontal: 4 },
  list: { borderRadius: 9, borderWidth: 0.5, borderColor: '#1e293b' },
  row: { paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: '#1e293b' },
  rowText: { color: '#cbd5e1', fontSize: 13 }
})

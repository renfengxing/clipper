import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { useStore } from '@core/store/useStore'
import { platform } from '@core/ports'

interface Props {
  /** floating = 浮在横屏的空白播放区上；否则按普通块级排版（竖屏放在片段列表位置） */
  floating?: boolean
}

/** 空白态里的「最近的时间线」，点一下直接打开（与 PC 版一致） */
export function RecentList({ floating }: Props = {}): JSX.Element | null {
  const videos = useStore((s) => s.videos)
  const openVideoPath = useStore((s) => s.openVideoPath)
  const [recent, setRecent] = useState<string[]>([])

  const reload = useCallback((): void => {
    platform()
      .getRecent()
      .then(setRecent)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (videos.length === 0) reload()
  }, [videos.length, reload])

  const forget = async (key: string): Promise<void> => {
    const st = await platform().getSettings()
    const next = (st.recent_files || []).filter((p) => p !== key)
    await platform().setSettings({ recent_files: next })
    setRecent(next)
  }

  /**
   * 先验一遍时间线里的视频还在不在再打开。
   * 重装 app 会清空整个沙盒容器，旧记录指向的文件全都不存在了 ——
   * 直接打开只会得到 AVFoundation 的 -11800，一句人话都没有。
   */
  const open = async (key: string): Promise<void> => {
    type Timeline = { videos?: Array<{ path: string }> }
    let raw = (await platform().loadData(key)) as Timeline | null
    let realKey = key
    // 旧版本的时间线文件是 .kkclip.json 结尾，最近记录里可能只存了 .kkclip
    if (!raw && !key.endsWith('.json')) {
      raw = (await platform().loadData(key + '.json')) as Timeline | null
      if (raw) realKey = key + '.json'
    }
    if (!raw) {
      Alert.alert(
        '这条记录打不开',
        `找不到对应的时间线文件：\n${decodeURIComponent(key.split('/').pop() || key)}\n\n多半是早期版本留下的记录。重新从相册选同一个视频即可，片段会自动回来。`,
        [
          { text: '知道了', style: 'cancel' },
          { text: '从列表移除', style: 'destructive', onPress: () => void forget(key) }
        ]
      )
      return
    }
    const list = raw.videos ?? []
    if (list.length === 0) {
      Alert.alert('这条记录里没有视频', '时间线是空的，直接从相册重新选一次吧。', [
        { text: '知道了', style: 'cancel' },
        { text: '从列表移除', style: 'destructive', onPress: () => void forget(key) }
      ])
      return
    }
    const missing: string[] = []
    for (const v of list) {
      if (!(await platform().exists(v.path))) missing.push(v.path)
    }
    if (missing.length === list.length) {
      Alert.alert(
        '这条时间线的视频已经不在了',
        '视频文件被系统清理或随重装 app 一起删掉了。重新从相册选同一个视频，标好的片段会自动回来。',
        [
          { text: '知道了', style: 'cancel' },
          { text: '从列表移除', style: 'destructive', onPress: () => void forget(key) }
        ]
      )
      return
    }
    if (missing.length > 0) {
      Alert.alert('部分视频已失效', `${list.length} 个视频里有 ${missing.length} 个找不到了，仍会打开其余部分。`)
    }
    await openVideoPath(realKey)
  }

  if (videos.length > 0 || recent.length === 0) return null

  const label = (key: string): string =>
    decodeURIComponent(key.split('/').pop() || key).replace(/\.kkclip$/, '')

  return (
    <View style={[s.wrap, floating ? s.wrapFloat : s.wrapBlock]}>
      <Text style={s.head}>最近的时间线</Text>
      <ScrollView style={s.list}>
        {recent.map((p) => (
          <Pressable
            key={p}
            style={s.row}
            onPress={() => void open(p)}
            onLongPress={() =>
              Alert.alert('从最近列表移除', label(p), [
                { text: '取消', style: 'cancel' },
                { text: '移除', style: 'destructive', onPress: () => void forget(p) }
              ])
            }
          >
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
  wrap: {},
  // 横屏：浮在空白播放区中央
  wrapFloat: { position: 'absolute', left: 40, right: 40, top: '44%', bottom: 20 },
  // 竖屏：占据片段列表那一块，跟着正常文档流走
  wrapBlock: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  head: { color: '#475569', fontSize: 11, marginBottom: 6, paddingHorizontal: 4 },
  list: { flex: 1, borderRadius: 9, borderWidth: 0.5, borderColor: '#1e293b' },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  rowText: { color: '#cbd5e1', fontSize: 13 }
})

import { View, Text, Pressable, Modal, ScrollView, Alert, StyleSheet } from 'react-native'
import { useStore } from '@core/store/useStore'
import { ordered } from '@core/utils/timeline'
import { fmtClock } from '@core/utils/time'

interface Props {
  visible: boolean
  onClose: () => void
}

/**
 * 视频管理面板。
 *
 * 之前移除视频只能长按时间线上的分段标签，而那行标签只有 2 个以上视频才出现 ——
 * 单个视频时等于没有出口。这里给每个视频一个明确的「移除」，外加「全部关闭」换下一场。
 */
export function VideoSheet({ visible, onClose }: Props): JSX.Element {
  const videos = useStore((s) => s.videos)
  const clips = useStore((s) => s.clips)
  const activeVideoId = useStore((s) => s.activeVideoId)
  const removeVideo = useStore((s) => s.removeVideo)
  const reorderVideos = useStore((s) => s.reorderVideos)
  const closeVideo = useStore((s) => s.closeVideo)
  const seek = useStore((s) => s.seek)
  const chooseAndAddVideos = useStore((s) => s.chooseAndAddVideos)

  const list = ordered(videos)

  // 关着的时候整个 Modal 都不要挂：iOS 上每个 RN Modal 都带一个 UIViewController，
  // 常驻的模态宿主会跟 App 的支持方向打架，转屏时来回抖个不停
  if (!visible) return <></>

  const askRemove = (id: string, name: string, n: number): void =>
    Alert.alert(
      '移除这个视频',
      `${name}\n\n只把它从这条时间线上拿掉，它的 ${n} 个片段仍然保存着，重新添加就会回来。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '移除', style: 'destructive', onPress: () => removeVideo(id) }
      ]
    )

  const askCloseAll = (): void =>
    Alert.alert('关闭当前时间线', '清空播放器，回到空白状态，去标记下一场比赛。\n\n所有片段都已保存，不会丢。', [
      { text: '取消', style: 'cancel' },
      {
        text: '关闭',
        style: 'destructive',
        onPress: () => {
          closeVideo()
          onClose()
        }
      }
    ])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={s.bar}>
            <Text style={s.title}>视频（{list.length}）</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.close}>完成</Text>
            </Pressable>
          </View>

          <ScrollView style={s.scroll}>
            {list.length === 0 && <Text style={s.empty}>还没有添加视频</Text>}

            {list.map((v, i) => {
              const n = clips.filter((c) => c.videoId === v.id).length
              return (
                <View key={v.id} style={[s.row, v.id === activeVideoId && s.rowActive]}>
                  <Pressable
                    style={s.info}
                    onPress={() => {
                      // 跳到这个视频的开头，方便确认自己动的是哪一个
                      let off = 0
                      for (const x of list) {
                        if (x.id === v.id) break
                        off += x.duration
                      }
                      seek(off)
                      onClose()
                    }}
                  >
                    <Text style={s.idx}>{i + 1}</Text>
                    <View style={s.meta}>
                      <Text numberOfLines={1} style={s.name}>
                        {v.fileName}
                      </Text>
                      <Text style={s.sub}>
                        {fmtClock(v.duration)} · {n} 个片段
                        {v.id === activeVideoId ? ' · 正在播放' : ''}
                      </Text>
                    </View>
                  </Pressable>

                  <View style={s.actions}>
                    <Pressable
                      style={[s.iconBtn, i === 0 && s.iconOff]}
                      disabled={i === 0}
                      onPress={() => reorderVideos(i, i - 1)}
                      hitSlop={6}
                    >
                      <Text style={s.icon}>↑</Text>
                    </Pressable>
                    <Pressable
                      style={[s.iconBtn, i === list.length - 1 && s.iconOff]}
                      disabled={i === list.length - 1}
                      onPress={() => reorderVideos(i, i + 1)}
                      hitSlop={6}
                    >
                      <Text style={s.icon}>↓</Text>
                    </Pressable>
                    <Pressable style={s.removeBtn} onPress={() => askRemove(v.id, v.fileName, n)} hitSlop={6}>
                      <Text style={s.removeText}>移除</Text>
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </ScrollView>

          <View style={s.footer}>
            <Pressable
              style={s.addBtn}
              onPress={() => {
                onClose()
                void chooseAndAddVideos()
              }}
            >
              <Text style={s.addText}>＋ 从相册添加</Text>
            </Pressable>
            {list.length > 0 && (
              <Pressable style={s.closeAllBtn} onPress={askCloseAll}>
                <Text style={s.closeAllText}>关闭全部</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    borderTopWidth: 0.5,
    borderColor: '#1e293b'
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '500' },
  close: { color: '#22d3ee', fontSize: 15 },

  scroll: { paddingHorizontal: 12 },
  empty: { color: '#64748b', fontSize: 13, textAlign: 'center', paddingVertical: 28 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 9,
    marginTop: 6
  },
  rowActive: { backgroundColor: 'rgba(8,145,178,0.13)' },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  idx: {
    color: '#64748b',
    fontSize: 13,
    width: 20,
    textAlign: 'center',
    fontVariant: ['tabular-nums']
  },
  meta: { flex: 1 },
  name: { color: '#e2e8f0', fontSize: 14 },
  sub: { color: '#64748b', fontSize: 11, marginTop: 3 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconOff: { opacity: 0.3 },
  icon: { color: '#cbd5e1', fontSize: 14 },
  removeBtn: {
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderWidth: 0.5,
    borderColor: 'rgba(248,113,113,0.5)',
    marginLeft: 2
  },
  removeText: { color: '#f87171', fontSize: 13 },

  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    paddingBottom: 28,
    borderTopWidth: 0.5,
    borderTopColor: '#1e293b'
  },
  addBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center'
  },
  addText: { color: '#e2e8f0', fontSize: 14 },
  closeAllBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderWidth: 0.5,
    borderColor: 'rgba(248,113,113,0.5)',
    alignItems: 'center'
  },
  closeAllText: { color: '#f87171', fontSize: 14 }
})

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  Image,
  Modal,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions
} from 'react-native'
import * as MediaLibrary from 'expo-media-library'
import { registerPicker, type PickedVideo } from '../platform/pickerBridge'

const PAGE = 90
const GAP = 2

function fmtDur(ms: number): string {
  const t = Math.round(ms / 1000)
  const m = Math.floor(t / 60)
  return `${m}:${String(t % 60).padStart(2, '0')}`
}

/**
 * 自建相册选择器。
 *
 * 为什么不用 expo-image-picker：它对视频会先按「兼容格式」转码，再整个文件
 * 拷进 app 沙盒 —— 4K HEVC 的比赛视频动辄上 GB，要等几十秒到几分钟，且全程无反馈。
 * 这里直接用 MediaLibrary 的 localUri（相册里的原始文件路径），零拷贝零转码，
 * 选完立刻就能播；缩略图由系统按需生成，滚动也不卡。
 */
export function AlbumPicker(): JSX.Element {
  const { width } = useWindowDimensions()
  const cols = width > 700 ? 6 : 3
  const cell = Math.floor((width - GAP * (cols + 1)) / cols)

  const [open, setOpen] = useState(false)
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [denied, setDenied] = useState(false)
  const cursor = useRef<string | undefined>(undefined)
  const hasMore = useRef(true)
  const resolveRef = useRef<((v: PickedVideo[]) => void) | null>(null)

  const finish = useCallback((v: PickedVideo[]): void => {
    const fn = resolveRef.current
    resolveRef.current = null
    setOpen(false)
    setResolving(false)
    fn?.(v)
  }, [])

  const loadPage = useCallback(async (): Promise<void> => {
    if (!hasMore.current || loading) return
    setLoading(true)
    try {
      const res = await MediaLibrary.getAssetsAsync({
        mediaType: [MediaLibrary.MediaType.video],
        sortBy: [MediaLibrary.SortBy.creationTime],
        first: PAGE,
        after: cursor.current
      })
      cursor.current = res.endCursor
      hasMore.current = res.hasNextPage
      setAssets((prev) => [...prev, ...res.assets])
    } catch (err) {
      console.warn('读取相册失败:', err)
      hasMore.current = false
    } finally {
      setLoading(false)
    }
  }, [loading])

  // 注册到桥上：core 调 pickVideos() 时把这个弹出来
  useEffect(() => {
    registerPicker((resolve) => {
      resolveRef.current = resolve
      setSel([])
      setDenied(false)
      setOpen(true)
      void (async () => {
        const perm = await MediaLibrary.requestPermissionsAsync()
        if (!perm.granted) {
          setDenied(true)
          return
        }
        // 每次打开都重新拉第一页，免得漏掉刚拍的视频
        cursor.current = undefined
        hasMore.current = true
        setAssets([])
        await loadPage()
      })()
    })
    return () => registerPicker(null)
  }, [loadPage])

  const toggle = (id: string): void =>
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const confirm = async (): Promise<void> => {
    if (sel.length === 0) return finish([])
    setResolving(true)
    const out: PickedVideo[] = []
    for (const id of sel) {
      const a = assets.find((x) => x.id === id)
      if (!a) continue
      try {
        // localUri 是相册里的原始文件（file://），不产生拷贝；
        // iCloud 上的资源会在这一步按需下载，所以要给用户转圈提示
        const info = await MediaLibrary.getAssetInfoAsync(id)
        out.push({ uri: info.localUri || a.uri, duration: a.duration })
      } catch (err) {
        console.warn('取视频路径失败:', err)
      }
    }
    finish(out)
  }

  return (
    <Modal visible={open} animationType="slide" onRequestClose={() => finish([])}>
      <View style={s.root}>
        <View style={s.bar}>
          <Pressable onPress={() => finish([])} hitSlop={10}>
            <Text style={s.cancel}>取消</Text>
          </Pressable>
          <Text style={s.title}>选择比赛视频</Text>
          <Pressable onPress={() => void confirm()} disabled={sel.length === 0} hitSlop={10}>
            <Text style={[s.done, sel.length === 0 && s.doneOff]}>
              {sel.length > 0 ? `添加 ${sel.length}` : '添加'}
            </Text>
          </Pressable>
        </View>

        {denied ? (
          <View style={s.center}>
            <Text style={s.empty}>没有相册权限{'\n'}请到「设置 → 宽宽爸视频切片 → 照片」里开启</Text>
          </View>
        ) : (
          <FlatList
            data={assets}
            keyExtractor={(a) => a.id}
            numColumns={cols}
            key={cols} // numColumns 变化时 FlatList 需要重建
            contentContainerStyle={{ padding: GAP }}
            onEndReached={() => void loadPage()}
            onEndReachedThreshold={1.2}
            initialNumToRender={cols * 6}
            windowSize={5}
            removeClippedSubviews
            ListEmptyComponent={
              loading ? null : <Text style={s.empty}>相册里没有视频</Text>
            }
            ListFooterComponent={
              loading ? <ActivityIndicator color="#22d3ee" style={s.footer} /> : null
            }
            renderItem={({ item }) => {
              const i = sel.indexOf(item.id)
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={[{ width: cell, height: cell, margin: GAP / 2 }, s.cell]}
                >
                  <Image source={{ uri: item.uri }} style={s.thumb} />
                  <Text style={s.dur}>{fmtDur(item.duration * 1000)}</Text>
                  <View style={[s.badge, i >= 0 && s.badgeOn]}>
                    {i >= 0 && <Text style={s.badgeText}>{i + 1}</Text>}
                  </View>
                  {i >= 0 && <View style={s.selRing} pointerEvents="none" />}
                </Pressable>
              )
            }}
          />
        )}

        {resolving && (
          <View style={s.overlay}>
            <ActivityIndicator color="#22d3ee" size="large" />
            <Text style={s.overlayText}>正在准备 {sel.length} 个视频…</Text>
            <Text style={s.overlaySub}>iCloud 上的视频需要先下载</Text>
          </View>
        )}
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 58,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '500' },
  cancel: { color: '#94a3b8', fontSize: 15 },
  done: { color: '#22d3ee', fontSize: 15, fontWeight: '500' },
  doneOff: { color: '#475569' },

  cell: { backgroundColor: '#1e293b', borderRadius: 3, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  dur: {
    position: 'absolute',
    right: 4,
    bottom: 3,
    color: '#fff',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeOn: { backgroundColor: '#0891b2', borderColor: '#22d3ee' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  selRing: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2.5,
    borderColor: '#22d3ee',
    borderRadius: 3
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#64748b', fontSize: 13, textAlign: 'center', lineHeight: 21, marginTop: 40 },
  footer: { paddingVertical: 18 },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,6,23,0.82)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  overlayText: { color: '#e2e8f0', fontSize: 15, marginTop: 14 },
  overlaySub: { color: '#64748b', fontSize: 12, marginTop: 6 }
})

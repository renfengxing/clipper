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
  Linking,
  useWindowDimensions
} from 'react-native'
import * as MediaLibrary from 'expo-media-library'
import * as FileSystem from 'expo-file-system'
import { registerPicker, type PickedVideo } from '../platform/pickerBridge'

const PAGE = 90
const GAP = 2
/**
 * 导入后的视频落地处。按相册资源 id 命名 → 同一场比赛再选一次直接命中，无需再拷。
 *
 * 放 Documents 而不是 Caches：Caches 会被系统在存储紧张时清掉，
 * 那样「最近打开」点进去就是一条视频全部失效的时间线（AVFoundation 报 -11800）。
 * 代价是这些副本会占用用户存储，可在「视频」面板里移除。
 */
const IMPORT_DIR = FileSystem.documentDirectory + 'imported/'

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40)
}

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
 * 这里改用 MediaLibrary：缩略图由系统按需生成，滚动不卡；选中后只做一次**纯文件拷贝**
 * （不转码），并按相册资源 id 缓存，同一场比赛再选一次直接命中。
 *
 * 为什么必须拷：expo-av 走 AVURLAsset URLAssetWithURL，没有 PHAsset 通道，
 * 既播不了 ph:// 资源标识符，也读不了相册容器里的原始路径 —— 直接喂给它就是黑屏。
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
  const [progress, setProgress] = useState(0) // 已导入几个
  const [failed, setFailed] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [limited, setLimited] = useState(false)
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
      setFailed(null)
      setOpen(true)
      void (async () => {
        // 要完整访问：「选择照片」模式下 getAssetInfoAsync 常常给不出 localUri
        const perm = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video'])
        if (!perm.granted) {
          setDenied(true)
          return
        }
        setLimited(perm.accessPrivileges === 'limited')
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
    setProgress(0)
    setFailed(null)
    const out: PickedVideo[] = []
    try {
      await FileSystem.makeDirectoryAsync(IMPORT_DIR, { intermediates: true }).catch(() => {})
      for (const id of sel) {
        const a = assets.find((x) => x.id === id)
        if (!a) continue

        // 缓存命中就直接用，省掉重复拷贝
        const ext = (a.filename.split('.').pop() || 'mov').toLowerCase()
        const dest = `${IMPORT_DIR}${safeName(a.filename.replace(/\.[^.]+$/, ''))}_${safeName(id).slice(-8)}.${ext}`
        const hit = await FileSystem.getInfoAsync(dest)
        if (hit.exists && hit.size > 0) {
          out.push({ uri: dest, duration: a.duration })
          setProgress(out.length)
          continue
        }

        // localUri 才是能读的原始文件；拿不到就必须报错 ——
        // 退回 a.uri（ph://）只会让播放器黑屏，比直接失败更难查
        const info = await MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: true })
        const src = info.localUri
        if (!src) {
          throw new Error(`拿不到「${a.filename}」的文件路径。若相册权限是「选择照片」，请改成「允许完全访问」。`)
        }
        await FileSystem.copyAsync({ from: src, to: dest })
        out.push({ uri: dest, duration: a.duration })
        setProgress(out.length)
      }
    } catch (err) {
      // 出错就停在面板上把原因显示出来，而不是丢一个播不了的视频进时间线
      setFailed(err instanceof Error ? err.message : String(err))
      setResolving(false)
      return
    }
    finish(out)
  }

  // 关着就整个不挂：常驻的 RN Modal 在 iOS 上会带一个 UIViewController，
  // 跟 App 的支持方向打架，转屏时来回抖（TitleSheet 一直是这么做的）
  if (!open) return <></>

  return (
    <Modal
      visible
      animationType="slide"
      // 不写这个，iOS 上 Modal 只支持竖屏：横屏点开会强行竖过来
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => finish([])}
    >
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

        {limited && (
          <Pressable style={s.warn} onPress={() => void Linking.openSettings()}>
            <Text style={s.warnText}>
              当前是「选择照片」权限，部分视频会读不出来 · 点这里改成「完全访问」
            </Text>
          </Pressable>
        )}

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
            <Text style={s.overlayText}>
              正在导入 {Math.min(progress + 1, sel.length)} / {sel.length}
            </Text>
            <Text style={s.overlaySub}>只做拷贝不转码；iCloud 上的需要先下载</Text>
          </View>
        )}

        {failed != null && (
          <View style={s.overlay}>
            <Text style={s.failTitle}>导入失败</Text>
            <Text style={s.failMsg}>{failed}</Text>
            <Pressable style={s.failBtn} onPress={() => setFailed(null)}>
              <Text style={s.failBtnText}>知道了</Text>
            </Pressable>
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
  overlaySub: { color: '#64748b', fontSize: 12, marginTop: 6 },

  warn: { backgroundColor: 'rgba(180,83,9,0.35)', paddingHorizontal: 14, paddingVertical: 9 },
  warnText: { color: '#fcd34d', fontSize: 12, lineHeight: 18 },

  failTitle: { color: '#f87171', fontSize: 16, fontWeight: '500', marginBottom: 10 },
  failMsg: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 28
  },
  failBtn: {
    marginTop: 20,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 26
  },
  failBtnText: { color: '#e2e8f0', fontSize: 14 }
})

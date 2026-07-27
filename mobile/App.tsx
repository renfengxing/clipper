import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Video, ResizeMode } from 'expo-av'
import { useStore, selectActiveVideo } from '@core/store/useStore'
import { fmtClock, fmtMs } from '@core/utils/time'
import { totalDuration } from '@core/utils/timeline'

/**
 * iOS 首屏（骨架）：验证共享 core 在 RN 里跑通 —— 相册选视频 → 探测时长
 * → 时间线数学 → 大按钮标记 → 片段列表。UI 后续按设计稿细化。
 */
export default function App(): JSX.Element {
  const videos = useStore((s) => s.videos)
  const clips = useStore((s) => s.clips)
  const active = useStore(selectActiveVideo)
  const currentTime = useStore((s) => s.currentTime)
  const playing = useStore((s) => s.playing)
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)

  const chooseAndAddVideos = useStore((s) => s.chooseAndAddVideos)
  const setPlayer = useStore((s) => s.setPlayer)
  const syncLocalTime = useStore((s) => s.syncLocalTime)
  const onVideoEnded = useStore((s) => s.onVideoEnded)
  const togglePlay = useStore((s) => s.togglePlay)
  const setMarkIn = useStore((s) => s.setMarkIn)
  const setMarkOut = useStore((s) => s.setMarkOut)
  const addClip = useStore((s) => s.addClip)
  const clearMarks = useStore((s) => s.clearMarks)

  const videoRef = useRef<Video>(null)
  const [ready, setReady] = useState(false)

  // 把 expo-av 的 ref 包成 Player 端口交给共享 store（与桌面 <video> 对称）
  useEffect(() => {
    if (!ready) return
    setPlayer({
      seekLocal: (sec) => {
        void videoRef.current?.setPositionAsync(sec * 1000)
      },
      play: () => {
        void videoRef.current?.playAsync()
      },
      pause: () => {
        void videoRef.current?.pauseAsync()
      },
      setRate: (r) => {
        void videoRef.current?.setRateAsync(r, true)
      }
    })
    return () => setPlayer(null)
  }, [ready, setPlayer, active?.id])

  const total = totalDuration(videos)
  const marking = markIn != null && markOut == null

  // 标记大按钮：一下起点、再一下终点（终点后直接用标签拼的占位标题存下）
  const onMarkPress = (): void => {
    if (markIn == null) setMarkIn()
    else {
      setMarkOut()
      // 骨架版先存占位标题；命名 sheet 下一步做
      setTimeout(() => addClip(`片段 ${clips.length + 1}`), 0)
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />

      <View style={s.videoBox}>
        {active ? (
          <Video
            ref={videoRef}
            source={{ uri: active.url }}
            style={s.video}
            resizeMode={ResizeMode.CONTAIN}
            onLoad={() => setReady(true)}
            onPlaybackStatusUpdate={(st) => {
              if (!st.isLoaded) return
              syncLocalTime((st.positionMillis || 0) / 1000)
              if (st.didJustFinish) onVideoEnded()
            }}
          />
        ) : (
          <Text style={s.hint}>还没有视频{'\n'}点下面「从相册添加」开始</Text>
        )}
        {marking && (
          <View style={s.markOverlay} pointerEvents="none">
            <Text style={s.markTitle}>● 正在标记片段</Text>
            <Text style={s.markSub}>已 {(currentTime - (markIn ?? 0)).toFixed(1)}s</Text>
          </View>
        )}
      </View>

      <View style={s.infoRow}>
        <Text style={s.time}>
          {fmtMs(currentTime)} / {fmtClock(total)}
        </Text>
        <Text style={s.meta}>
          {videos.length} 个视频 · {clips.length} 个片段
        </Text>
      </View>

      <View style={s.controls}>
        <Pressable style={s.ctrlBtn} onPress={() => togglePlay()}>
          <Text style={s.ctrlText}>{playing ? '⏸' : '▶'}</Text>
        </Pressable>
        <Pressable style={s.ctrlBtn} onPress={() => void chooseAndAddVideos()}>
          <Text style={s.ctrlText}>＋ 相册</Text>
        </Pressable>
        {marking && (
          <Pressable style={s.ctrlBtn} onPress={() => clearMarks()}>
            <Text style={s.ctrlText}>取消</Text>
          </Pressable>
        )}
      </View>

      <Pressable
        style={[s.markBtn, marking ? s.markBtnEnd : s.markBtnStart]}
        onPress={onMarkPress}
        disabled={!active}
      >
        <Text style={s.markBtnText}>
          {marking ? `■ 标记终点 · ${(currentTime - (markIn ?? 0)).toFixed(1)}s` : '◉ 标记起点'}
        </Text>
      </Pressable>

      <ScrollView style={s.list}>
        {clips.map((c, i) => (
          <View key={c.id} style={s.clipRow}>
            <Text style={s.clipIdx}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.clipTitle}>{c.title || '未命名片段'}</Text>
              <Text style={s.clipMeta}>
                {fmtClock(c.in)} - {fmtClock(c.out)} · {(c.out - c.in).toFixed(1)}s
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  videoBox: { height: 220, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  video: { width: '100%', height: '100%' },
  hint: { color: '#64748b', textAlign: 'center', fontSize: 14, lineHeight: 22 },
  markOverlay: { position: 'absolute', alignItems: 'center' },
  markTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 20, fontWeight: '500' },
  markSub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 4 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  time: { color: '#cbd5e1', fontSize: 13, fontVariant: ['tabular-nums'] },
  meta: { color: '#64748b', fontSize: 12 },
  controls: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  ctrlBtn: { backgroundColor: '#334155', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  ctrlText: { color: '#e2e8f0', fontSize: 15 },
  markBtn: { marginHorizontal: 14, marginBottom: 10, borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  markBtnStart: { backgroundColor: '#0891b2' },
  markBtnEnd: { backgroundColor: '#dc2626' },
  markBtnText: { color: '#fff', fontSize: 17, fontWeight: '500' },
  list: { flex: 1, borderTopWidth: 0.5, borderTopColor: '#1e293b' },
  clipRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  clipIdx: { color: '#475569', fontSize: 12, width: 20 },
  clipTitle: { color: '#e2e8f0', fontSize: 14 },
  clipMeta: { color: '#64748b', fontSize: 11, marginTop: 2 }
})

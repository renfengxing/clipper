import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Video, ResizeMode } from 'expo-av'
import { useStore, selectActiveVideo } from '@core/store/useStore'
import { platform } from '@core/ports'
import { fmtClock, fmtMs } from '@core/utils/time'
import { totalDuration } from '@core/utils/timeline'
import { TitleSheet } from './src/components/TitleSheet'
import { Timeline } from './src/components/Timeline'
import { ClipList } from './src/components/ClipList'

export default function App(): JSX.Element {
  const videos = useStore((s) => s.videos)
  const clips = useStore((s) => s.clips)
  const active = useStore(selectActiveVideo)
  const currentTime = useStore((s) => s.currentTime)
  const playing = useStore((s) => s.playing)
  const rate = useStore((s) => s.rate)
  const direction = useStore((s) => s.direction)
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)

  const chooseAndAddVideos = useStore((s) => s.chooseAndAddVideos)
  const setPlayer = useStore((s) => s.setPlayer)
  const syncLocalTime = useStore((s) => s.syncLocalTime)
  const onVideoEnded = useStore((s) => s.onVideoEnded)
  const applyPendingSeek = useStore((s) => s.applyPendingSeek)
  const togglePlay = useStore((s) => s.togglePlay)
  const speedUp = useStore((s) => s.speedUp)
  const resetSpeed = useStore((s) => s.resetSpeed)
  const jump = useStore((s) => s.jump)
  const setMarkIn = useStore((s) => s.setMarkIn)
  const setMarkOut = useStore((s) => s.setMarkOut)
  const clearMarks = useStore((s) => s.clearMarks)
  const setDefaultTags = useStore((s) => s.setDefaultTags)

  const videoRef = useRef<Video>(null)
  const [ready, setReady] = useState(false)

  // 启动读设置：默认标签是「标签优先」命名流的前提
  useEffect(() => {
    platform()
      .getSettings()
      .then((st) => {
        if (st.default_tags?.length) setDefaultTags(st.default_tags)
      })
      .catch(() => {})
  }, [setDefaultTags])

  // 换视频源时先置为未就绪，等新源 onLoad 再注册 Player（避免对旧源发指令）
  useEffect(() => {
    setReady(false)
  }, [active?.id])

  // 把 expo-av 的 ref 包成 Player 端口交给共享 store（与桌面 <video> 对称）
  useEffect(() => {
    if (!ready) return
    // 拖拽时会高频 seek，expo-av 会把前一个 seek 以 "Seeking interrupted" reject——
    // 这是预期行为，吞掉即可；同时做轻量节流，减少无谓的原生调用。
    let seekTimer: ReturnType<typeof setTimeout> | null = null
    let pendingSec: number | null = null
    const flushSeek = (): void => {
      seekTimer = null
      const sec = pendingSec
      pendingSec = null
      if (sec == null) return
      videoRef.current?.setPositionAsync(sec * 1000).catch(() => {})
    }

    setPlayer({
      seekLocal: (sec) => {
        pendingSec = sec
        if (seekTimer == null) seekTimer = setTimeout(flushSeek, 40)
      },
      play: () => {
        videoRef.current?.playAsync().catch(() => {})
      },
      pause: () => {
        videoRef.current?.pauseAsync().catch(() => {})
      },
      setRate: (r) => {
        videoRef.current?.setRateAsync(r, true).catch(() => {})
      }
    })
    // Player 注册好之后再应用待定 seek（onLoad 时 player 还是 null，那时调用会静默失效）
    applyPendingSeek()
    return () => {
      if (seekTimer) clearTimeout(seekTimer)
      setPlayer(null)
    }
  }, [ready, setPlayer, applyPendingSeek])

  const total = totalDuration(videos)
  const marking = markIn != null && markOut == null
  const elapsed = marking ? currentTime - (markIn ?? 0) : 0

  const onMarkPress = (): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (markIn == null) setMarkIn()
    else setMarkOut() // 自动弹出命名弹层
  }

  const rateLabel = playing && rate !== 1 ? `${direction === 'reverse' ? '◀ ' : ''}${rate}x` : null

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />

      <View style={s.videoBox}>
        {active ? (
          <Video
            key={active.id}
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
          <Text style={s.hint}>还没有视频{'\n'}点下面「＋ 相册」开始</Text>
        )}
        {marking && (
          <View style={s.markOverlay} pointerEvents="none">
            <Text style={s.markTitle}>● 正在标记片段</Text>
            <Text style={s.markSub}>已 {elapsed.toFixed(1)}s</Text>
          </View>
        )}
      </View>

      <View style={s.infoRow}>
        <Text style={s.time}>
          {fmtMs(currentTime)} / {fmtClock(total)}
          {rateLabel ? `  ${rateLabel}` : ''}
        </Text>
        <Text style={s.meta}>
          {videos.length} 个视频 · {clips.length} 个片段
        </Text>
      </View>

      <Timeline />

      <View style={s.controls}>
        <Pressable style={s.ctrlBtn} onPress={() => jump(-5)} disabled={!active}>
          <Text style={s.ctrlText}>-5s</Text>
        </Pressable>
        <Pressable style={s.ctrlBtn} onPress={() => togglePlay()} disabled={!active}>
          <Text style={s.ctrlText}>{playing ? '⏸' : '▶'}</Text>
        </Pressable>
        <Pressable style={s.ctrlBtn} onPress={() => jump(5)} disabled={!active}>
          <Text style={s.ctrlText}>+5s</Text>
        </Pressable>
        <Pressable style={s.ctrlBtn} onPress={() => resetSpeed()} disabled={!active}>
          <Text style={s.ctrlText}>慢放</Text>
        </Pressable>
        <Pressable style={s.ctrlBtn} onPress={() => speedUp()} disabled={!active}>
          <Text style={s.ctrlText}>快进</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={s.ctrlBtn} onPress={() => void chooseAndAddVideos()}>
          <Text style={s.ctrlText}>＋ 相册</Text>
        </Pressable>
      </View>

      <View style={s.markRow}>
        <Pressable
          style={[s.markBtn, marking ? s.markBtnEnd : s.markBtnStart, !active && s.markBtnOff]}
          onPress={onMarkPress}
          disabled={!active}
        >
          <Text style={s.markBtnText}>
            {marking ? `■ 标记终点 · ${elapsed.toFixed(1)}s` : '◉ 标记起点'}
          </Text>
        </Pressable>
        {marking && (
          <Pressable style={s.cancelBtn} onPress={() => clearMarks()}>
            <Text style={s.cancelText}>取消</Text>
          </Pressable>
        )}
      </View>

      <ClipList />
      <TitleSheet />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  videoBox: { height: 210, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  video: { width: '100%', height: '100%' },
  hint: { color: '#64748b', textAlign: 'center', fontSize: 14, lineHeight: 22 },
  markOverlay: { position: 'absolute', alignItems: 'center' },
  markTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 19, fontWeight: '500' },
  markSub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 4 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 7
  },
  time: { color: '#cbd5e1', fontSize: 12, fontVariant: ['tabular-nums'] },
  meta: { color: '#64748b', fontSize: 11 },
  controls: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
  ctrlBtn: { backgroundColor: '#334155', borderRadius: 7, paddingVertical: 9, paddingHorizontal: 11 },
  ctrlText: { color: '#e2e8f0', fontSize: 13 },
  markRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  markBtn: { flex: 1, borderRadius: 12, paddingVertical: 17, alignItems: 'center' },
  markBtnStart: { backgroundColor: '#0891b2' },
  markBtnEnd: { backgroundColor: '#dc2626' },
  markBtnOff: { opacity: 0.4 },
  markBtnText: { color: '#fff', fontSize: 17, fontWeight: '500' },
  cancelBtn: { borderWidth: 1, borderColor: '#475569', borderRadius: 12, paddingVertical: 17, paddingHorizontal: 18, justifyContent: 'center' },
  cancelText: { color: '#94a3b8', fontSize: 15 }
})

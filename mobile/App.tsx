import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native'
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
import { Controls } from './src/components/Controls'

export default function App(): JSX.Element {
  const { width, height } = useWindowDimensions()
  const landscape = width > height

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
  const setMarkIn = useStore((s) => s.setMarkIn)
  const setMarkOut = useStore((s) => s.setMarkOut)
  const clearMarks = useStore((s) => s.clearMarks)
  const setDefaultTags = useStore((s) => s.setDefaultTags)

  const videoRef = useRef<Video>(null)
  const [ready, setReady] = useState(false)
  const [listOpen, setListOpen] = useState(true)

  useEffect(() => {
    platform()
      .getSettings()
      .then((st) => {
        if (st.default_tags?.length) setDefaultTags(st.default_tags)
      })
      .catch(() => {})
  }, [setDefaultTags])

  useEffect(() => {
    setReady(false)
  }, [active?.id])

  useEffect(() => {
    if (!ready) return
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
    applyPendingSeek()
    return () => {
      if (seekTimer) clearTimeout(seekTimer)
      setPlayer(null)
    }
  }, [ready, setPlayer, applyPendingSeek])

  const total = totalDuration(videos)
  const marking = markIn != null && markOut == null
  const elapsed = marking ? currentTime - (markIn ?? 0) : 0
  const rateLabel = playing && rate !== 1 ? `${direction === 'reverse' ? '◀ ' : ''}${rate}x` : null

  const onMarkPress = (): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (markIn == null) setMarkIn()
    else setMarkOut()
  }

  const videoEl = active ? (
    <Video
      key={active.id}
      ref={videoRef}
      source={{ uri: active.url }}
      style={StyleSheet.absoluteFill}
      resizeMode={ResizeMode.CONTAIN}
      onLoad={() => setReady(true)}
      onPlaybackStatusUpdate={(st) => {
        if (!st.isLoaded) return
        syncLocalTime((st.positionMillis || 0) / 1000)
        if (st.didJustFinish) onVideoEnded()
      }}
    />
  ) : (
    <Text style={s.hint}>还没有视频{'\n'}点「＋ 相册」开始</Text>
  )

  const markingOverlay = marking ? (
    <View style={s.markOverlay} pointerEvents="none">
      <Text style={s.markTitle}>● 正在标记片段</Text>
      <Text style={s.markSub}>已 {elapsed.toFixed(1)}s</Text>
    </View>
  ) : null

  const statusText = (
    <Text style={s.time}>
      {fmtMs(currentTime)} / {fmtClock(total)}
      {rateLabel ? `  ${rateLabel}` : ''}
    </Text>
  )

  const markButton = (big?: boolean): JSX.Element => (
    <View style={s.markRow}>
      <Pressable
        style={[
          s.markBtn,
          big && s.markBtnBig,
          marking ? s.markBtnEnd : s.markBtnStart,
          !active && s.markBtnOff
        ]}
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
  )

  // ——— 横屏：视频铺满，控件半透明浮在画面上，片段列表在右侧可折叠（对齐 PC 版）———
  if (landscape) {
    return (
      <SafeAreaView style={s.root} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="light" hidden />
        <View style={s.landRow}>
          <View style={s.landVideo}>
            {videoEl}
            {markingOverlay}

            <View style={s.landTopBar} pointerEvents="none">
              <View style={s.pill}>{statusText}</View>
              <View style={s.pill}>
                <Text style={s.meta}>
                  {videos.length} 视频 · {clips.length} 片段
                </Text>
              </View>
            </View>

            <View style={s.landBottom}>
              <Timeline floating />
              <View style={s.landBottomRow}>
                <Controls floating onPickVideos={() => void chooseAndAddVideos()} />
                {markButton()}
              </View>
            </View>
          </View>

          {listOpen ? (
            <View style={s.landList}>
              <Pressable style={s.collapseBar} onPress={() => setListOpen(false)}>
                <Text style={s.collapseText}>▶ 收起</Text>
              </Pressable>
              <ClipList />
            </View>
          ) : (
            <Pressable style={s.expandTab} onPress={() => setListOpen(true)}>
              <Text style={s.collapseText}>◀</Text>
              <Text style={s.expandCount}>{clips.length}</Text>
            </Pressable>
          )}
        </View>
        <TitleSheet />
      </SafeAreaView>
    )
  }

  // ——— 竖屏：上下堆叠，适合单手快速标记 ———
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <View style={s.portVideo}>
        {videoEl}
        {markingOverlay}
      </View>
      <View style={s.infoRow}>
        {statusText}
        <Text style={s.meta}>
          {videos.length} 个视频 · {clips.length} 个片段
        </Text>
      </View>
      <Timeline />
      <Controls onPickVideos={() => void chooseAndAddVideos()} />
      {markButton(true)}
      <ClipList />
      <TitleSheet />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  hint: { color: '#64748b', textAlign: 'center', fontSize: 14, lineHeight: 22 },

  // 横屏
  landRow: { flex: 1, flexDirection: 'row' },
  landVideo: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  landTopBar: {
    position: 'absolute',
    top: 8,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  pill: {
    backgroundColor: 'rgba(15,23,42,0.55)',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  landBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  landBottomRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 12, paddingBottom: 6 },
  landList: { width: 300, backgroundColor: '#0f172a', borderLeftWidth: 0.5, borderLeftColor: '#1e293b' },
  collapseBar: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  collapseText: { color: '#94a3b8', fontSize: 12 },
  expandTab: {
    width: 34,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  expandCount: { color: '#22d3ee', fontSize: 12 },

  // 竖屏
  portVideo: { height: 210, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 7
  },

  time: { color: '#cbd5e1', fontSize: 12, fontVariant: ['tabular-nums'] },
  meta: { color: '#94a3b8', fontSize: 11 },

  markOverlay: { position: 'absolute', alignItems: 'center' },
  markTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 19, fontWeight: '500' },
  markSub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 4 },

  markRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
  markBtn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, alignItems: 'center' },
  markBtnBig: { flex: 1, paddingVertical: 17 },
  markBtnStart: { backgroundColor: 'rgba(8,145,178,0.85)' },
  markBtnEnd: { backgroundColor: 'rgba(220,38,38,0.85)' },
  markBtnOff: { opacity: 0.4 },
  markBtnText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  cancelBtn: {
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.5)',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    justifyContent: 'center'
  },
  cancelText: { color: '#cbd5e1', fontSize: 14 }
})

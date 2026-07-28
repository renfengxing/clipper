import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native'
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
import { VideoStage } from './src/components/VideoStage'
import { AlbumPicker } from './src/components/AlbumPicker'
import { VideoSheet } from './src/components/VideoSheet'

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
  const importing = useStore((s) => s.importing)

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
  const [playError, setPlayError] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false) // 默认收起，全屏看画面（#4）
  const [videoSheetOpen, setVideoSheetOpen] = useState(false)

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
    setPlayError(null)
  }, [active?.id])

  useEffect(() => {
    if (!ready) return
    let seekTimer: ReturnType<typeof setTimeout> | null = null
    let pendingSec: number | null = null
    // 所有指令串成一条链：并发的 setStatusAsync 会互相打断（"Seeking interrupted"）
    let chain: Promise<unknown> = Promise.resolve()

    const push = (status: Record<string, unknown>): void => {
      chain = chain
        .catch(() => {})
        .then(() => videoRef.current?.setStatusAsync(status))
        .catch(() => {}) // 拖拽时被后一次指令打断属正常
    }

    /** 取出待定 seek（并取消定时器），供与播放指令合并成一次原子调用 */
    const takePending = (): number | null => {
      if (seekTimer) {
        clearTimeout(seekTimer)
        seekTimer = null
      }
      const sec = pendingSec
      pendingSec = null
      return sec
    }

    setPlayer({
      seekLocal: (sec) => {
        // 拖拽期间高频调用 → 节流合并
        pendingSec = sec
        if (seekTimer == null) {
          seekTimer = setTimeout(() => {
            seekTimer = null
            const s = pendingSec
            pendingSec = null
            if (s != null) push({ positionMillis: Math.round(s * 1000) })
          }, 40)
        }
      },
      // 关键：定位与播放合并成一次 setStatusAsync，杜绝「先播后定位」的竞态
      play: () => {
        const s = takePending()
        push(s != null ? { positionMillis: Math.round(s * 1000), shouldPlay: true } : { shouldPlay: true })
      },
      pause: () => {
        takePending()
        push({ shouldPlay: false })
      },
      setRate: (r) => {
        const s = takePending()
        const base = { rate: r, shouldCorrectPitch: true }
        push(s != null ? { ...base, positionMillis: Math.round(s * 1000) } : base)
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

  // 快速右滑=收起列表，快速左滑=展开（与「按住调速」区分）
  const onFlick = (dir: 'left' | 'right'): void => setListOpen(dir === 'left')

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
      // 播放器出错时把原因显示出来，别让人对着黑屏猜
      onError={(e) => setPlayError(typeof e === 'string' ? e : JSON.stringify(e))}
      onPlaybackStatusUpdate={(st) => {
        if (!st.isLoaded) {
          if (st.error) setPlayError(st.error)
          return
        }
        syncLocalTime((st.positionMillis || 0) / 1000)
        if (st.didJustFinish) onVideoEnded()
      }}
    />
  ) : (
    <Text style={s.hint}>还没有视频{'\n'}点「＋ 相册」开始</Text>
  )

  const playErrorOverlay = playError ? (
    <View style={s.playError} pointerEvents="none">
      <Text style={s.playErrorTitle}>这个视频打不开</Text>
      <Text style={s.playErrorMsg} numberOfLines={4}>
        {playError}
      </Text>
    </View>
  ) : null

  const markingOverlay = marking ? (
    <View style={s.markOverlay} pointerEvents="none">
      <Text style={s.markTitle}>● 正在标记片段</Text>
      <Text style={s.markSub}>已 {elapsed.toFixed(1)}s</Text>
    </View>
  ) : null

  // 选完片到时间线就绪之间会有一小段空档，给个明确反馈，别让人以为没选上
  const importOverlay = importing ? (
    <View style={s.importOverlay}>
      <ActivityIndicator color="#22d3ee" size="large" />
      <Text style={s.importText}>正在载入视频…</Text>
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
          <VideoStage onFlick={onFlick} enabled={!!active}>
            {videoEl}
            {markingOverlay}
            {playErrorOverlay}

            <View style={s.landTopBar} pointerEvents="box-none">
              <View style={s.pill} pointerEvents="none">
                {statusText}
              </View>
              {/* 片段列表开关：做成浮动按钮，比屏幕边缘的细条好找得多 */}
              <Pressable style={s.listToggle} onPress={() => setListOpen(!listOpen)}>
                <Text style={s.listToggleText}>
                  {listOpen ? '片段 ▶' : `☰ 片段 ${clips.length}`}
                </Text>
              </Pressable>
            </View>

            {/* 标记按钮：独立浮在右侧，避免被控制条挤掉；两手握持时右拇指可及 */}
            <View style={s.landMark}>{markButton()}</View>

            <View style={s.landBottom}>
              <Timeline floating />
              <Controls
                floating
                videoCount={videos.length}
                onPickVideos={() => void chooseAndAddVideos()}
                onManageVideos={() => setVideoSheetOpen(true)}
              />
            </View>
          </VideoStage>

          {listOpen ? (
            <View style={s.landList}>
              <Pressable style={s.collapseBar} onPress={() => setListOpen(false)}>
                <Text style={s.collapseText}>片段 {clips.length}</Text>
                <Text style={s.collapseAction}>收起 ▶</Text>
              </Pressable>
              <ClipList />
            </View>
          ) : null}
        </View>
        <TitleSheet />
        <AlbumPicker />
        <VideoSheet visible={videoSheetOpen} onClose={() => setVideoSheetOpen(false)} />
        {importOverlay}
      </SafeAreaView>
    )
  }

  // ——— 竖屏：上下堆叠，适合单手快速标记 ———
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" hidden />
      <View style={s.portVideo}>
        <VideoStage onFlick={onFlick} enabled={!!active}>
          {videoEl}
          {markingOverlay}
          {playErrorOverlay}
        </VideoStage>
      </View>
      <View style={s.infoRow}>
        {statusText}
        <Text style={s.meta}>
          {videos.length} 个视频 · {clips.length} 个片段
        </Text>
      </View>
      <Timeline />
      <Controls
        videoCount={videos.length}
        onPickVideos={() => void chooseAndAddVideos()}
        onManageVideos={() => setVideoSheetOpen(true)}
      />
      {markButton(true)}
      <ClipList />
      <TitleSheet />
      <AlbumPicker />
      <VideoSheet visible={videoSheetOpen} onClose={() => setVideoSheetOpen(false)} />
      {importOverlay}
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
  // 标记按钮浮在视频区右侧、时间线之上
  landMark: { position: 'absolute', right: 10, bottom: 96 },
  landList: { width: 300, backgroundColor: '#0f172a', borderLeftWidth: 0.5, borderLeftColor: '#1e293b' },
  collapseBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  collapseText: { color: '#e2e8f0', fontSize: 13 },
  collapseAction: { color: '#22d3ee', fontSize: 12 },
  listToggle: {
    backgroundColor: 'rgba(8,145,178,0.75)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(34,211,238,0.6)'
  },
  listToggleText: { color: '#fff', fontSize: 13, fontWeight: '500' },

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
  cancelText: { color: '#cbd5e1', fontSize: 14 },

  importOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,6,23,0.75)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  importText: { color: '#e2e8f0', fontSize: 15, marginTop: 14 },

  playError: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(127,29,29,0.85)',
    borderRadius: 12,
    padding: 14
  },
  playErrorTitle: { color: '#fecaca', fontSize: 15, fontWeight: '500' },
  playErrorMsg: { color: 'rgba(254,226,226,0.8)', fontSize: 11, marginTop: 7, textAlign: 'center' }
})

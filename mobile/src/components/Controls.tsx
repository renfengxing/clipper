import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useStore } from '@core/store/useStore'

interface Props {
  /** 浮在画面上时用半透明样式（横屏） */
  floating?: boolean
  onPickVideos: () => void
}

/** 传输控制条：竖屏在画面下方，横屏半透明浮在画面上（对齐 PC 版按钮布局，无快捷键） */
export function Controls({ floating, onPickVideos }: Props): JSX.Element {
  const playing = useStore((s) => s.playing)
  const hasVideo = useStore((s) => s.videos.length > 0)
  const togglePlay = useStore((s) => s.togglePlay)
  const speedUp = useStore((s) => s.speedUp)
  const speedDown = useStore((s) => s.speedDown)
  const resetSpeed = useStore((s) => s.resetSpeed)
  const jump = useStore((s) => s.jump)

  const btn = [s.btn, floating && s.btnFloat]
  const txt = [s.txt, floating && s.txtFloat]

  return (
    <View style={[s.row, floating && s.rowFloat]}>
      <Pressable style={btn} onPress={() => speedDown()} disabled={!hasVideo}>
        <Text style={txt}>◀◀</Text>
      </Pressable>
      <Pressable style={btn} onPress={() => jump(-5)} disabled={!hasVideo}>
        <Text style={txt}>-5s</Text>
      </Pressable>
      <Pressable style={[...btn, s.btnPlay]} onPress={() => togglePlay()} disabled={!hasVideo}>
        <Text style={txt}>{playing ? '⏸' : '▶'}</Text>
      </Pressable>
      <Pressable style={btn} onPress={() => jump(5)} disabled={!hasVideo}>
        <Text style={txt}>+5s</Text>
      </Pressable>
      <Pressable style={btn} onPress={() => resetSpeed()} disabled={!hasVideo}>
        <Text style={txt}>慢放</Text>
      </Pressable>
      <Pressable style={btn} onPress={() => speedUp()} disabled={!hasVideo}>
        <Text style={txt}>▶▶</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable style={btn} onPress={onPickVideos}>
        <Text style={txt}>＋ 相册</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  rowFloat: { paddingVertical: 6 },
  btn: { backgroundColor: '#334155', borderRadius: 7, paddingVertical: 9, paddingHorizontal: 11 },
  btnFloat: { backgroundColor: 'rgba(30,41,59,0.55)', borderWidth: 0.5, borderColor: 'rgba(148,163,184,0.25)' },
  btnPlay: { paddingHorizontal: 15 },
  txt: { color: '#e2e8f0', fontSize: 13 },
  txtFloat: { color: 'rgba(255,255,255,0.85)' }
})

import { View, Text, Pressable, StyleSheet } from 'react-native'

interface Props {
  /** 浮在画面上时用半透明样式（横屏） */
  floating?: boolean
  onPickVideos: () => void
}

/**
 * 传输控制已全部改为手势（轻点=播放/暂停，按住横滑=调速），
 * 这里只剩添加视频的入口。
 */
export function Controls({ floating, onPickVideos }: Props): JSX.Element {
  return (
    <View style={[s.row, floating && s.rowFloat]}>
      <Pressable style={[s.btn, floating && s.btnFloat]} onPress={onPickVideos}>
        <Text style={[s.txt, floating && s.txtFloat]}>＋ 相册</Text>
      </Pressable>
      <Text style={s.hint}>轻点播放 · 按住横滑调速</Text>
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  rowFloat: { paddingVertical: 6 },
  btn: { backgroundColor: '#334155', borderRadius: 7, paddingVertical: 9, paddingHorizontal: 13 },
  btnFloat: {
    backgroundColor: 'rgba(30,41,59,0.55)',
    borderWidth: 0.5,
    borderColor: 'rgba(148,163,184,0.25)'
  },
  txt: { color: '#e2e8f0', fontSize: 13 },
  txtFloat: { color: 'rgba(255,255,255,0.85)' },
  hint: { color: 'rgba(148,163,184,0.7)', fontSize: 11 }
})

import { useEffect, useState } from 'react'
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native'
import { useStore } from '@core/store/useStore'
import { fmtPrecise } from '@core/utils/time'

/**
 * 命名弹层（手机版核心交互）：标签优先 → 三档速度
 *  最快：点 2~3 个标签，标题自动拼 → 保存（约 2 秒）
 *  中速：语音（后续接原生听写）
 *  慢：键盘打字写详细解说
 */
export function TitleSheet(): JSX.Element | null {
  const open = useStore((s) => s.titleModalOpen)
  const markIn = useStore((s) => s.markIn)
  const markOut = useStore((s) => s.markOut)
  const addClip = useStore((s) => s.addClip)
  const close = useStore((s) => s.closeTitleModal)
  const videoTags = useStore((s) => s.videoTags)
  const defaultTags = useStore((s) => s.defaultTags)

  const [tags, setTags] = useState<string[]>([])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    if (open) {
      setTags([])
      setText('')
      setTyping(false)
    }
  }, [open])

  if (!open || markIn == null || markOut == null) return null

  const lo = Math.min(markIn, markOut)
  const hi = Math.max(markIn, markOut)
  const candidates = Array.from(new Set([...videoTags, ...defaultTags]))
  // 分组：系统默认标签 = 事件；用户自建的（不在默认库里）= 人名/自定义，放前排更好点
  const events = candidates.filter((t) => defaultTags.includes(t))
  const names = candidates.filter((t) => !defaultTags.includes(t))

  const toggle = (t: string): void =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  // 标题：手打优先，否则用标签拼
  const title = text.trim() || tags.join(' ')

  const chip = (t: string): JSX.Element => (
    <Pressable
      key={t}
      onPress={() => toggle(t)}
      style={[s.chip, tags.includes(t) && s.chipOn]}
    >
      <Text style={[s.chipText, tags.includes(t) && s.chipTextOn]}>{t}</Text>
    </Pressable>
  )

  return (
    <View style={s.backdrop}>
      <View style={s.sheet}>
        <View style={s.handle} />
        <Text style={s.range}>
          {fmtPrecise(lo)} → {fmtPrecise(hi)}　<Text style={s.dur}>{(hi - lo).toFixed(1)}s</Text>
        </Text>

        <ScrollView style={{ maxHeight: 260 }}>
          {names.length > 0 && (
            <>
              <Text style={s.label}>谁 / 自定义</Text>
              <View style={s.chips}>{names.map(chip)}</View>
            </>
          )}
          {events.length > 0 && (
            <>
              <Text style={s.label}>做了什么</Text>
              <View style={s.chips}>{events.map(chip)}</View>
            </>
          )}
        </ScrollView>

        <View style={s.preview}>
          <Text style={title ? s.previewText : s.previewEmpty}>
            {title || '点标签自动生成标题，或打字写解说'}
          </Text>
        </View>

        {typing ? (
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            multiline
            placeholder="片段解说 / 评价"
            placeholderTextColor="#64748b"
            style={s.input}
          />
        ) : (
          <Pressable style={s.typeBtn} onPress={() => setTyping(true)}>
            <Text style={s.typeBtnText}>⌨️ 打字写解说</Text>
          </Pressable>
        )}

        <View style={s.actions}>
          <Pressable style={s.cancel} onPress={() => close()}>
            <Text style={s.cancelText}>跳过</Text>
          </Pressable>
          <Pressable
            style={[s.save, !title && s.saveOff]}
            disabled={!title}
            onPress={() => addClip(title, tags)}
          >
            <Text style={s.saveText}>保存</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,6,23,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1e293b', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 14, paddingBottom: 26 },
  handle: { width: 34, height: 3, borderRadius: 2, backgroundColor: '#475569', alignSelf: 'center', marginBottom: 10 },
  range: { color: '#94a3b8', fontSize: 13, marginBottom: 10, fontVariant: ['tabular-nums'] },
  dur: { color: '#22d3ee' },
  label: { color: '#64748b', fontSize: 11, marginBottom: 6, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { backgroundColor: '#334155', borderRadius: 14, paddingVertical: 7, paddingHorizontal: 13 },
  chipOn: { backgroundColor: '#0891b2' },
  chipText: { color: '#cbd5e1', fontSize: 14 },
  chipTextOn: { color: '#fff' },
  preview: { backgroundColor: '#0f172a', borderRadius: 8, padding: 10, marginTop: 6, marginBottom: 10 },
  previewText: { color: '#e2e8f0', fontSize: 15 },
  previewEmpty: { color: '#475569', fontSize: 13 },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 10,
    color: '#e2e8f0',
    fontSize: 15,
    minHeight: 70,
    marginBottom: 10,
    textAlignVertical: 'top'
  },
  typeBtn: { backgroundColor: '#334155', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 10 },
  typeBtnText: { color: '#e2e8f0', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 8 },
  cancel: { flex: 1, borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  cancelText: { color: '#94a3b8', fontSize: 15 },
  save: { flex: 2, backgroundColor: '#0891b2', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  saveOff: { backgroundColor: '#334155' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '500' }
})

import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView
} from 'react-native'
import { useStore } from '@core/store/useStore'
import { fmtClock } from '@core/utils/time'

interface Props {
  clipId: string | null
  onClose: () => void
}

/** 改片段的标题与标签。标签点一下就切换，也能现打新词 */
export function EditClipSheet({ clipId, onClose }: Props): JSX.Element {
  const clips = useStore((s) => s.clips)
  const videoTags = useStore((s) => s.videoTags)
  const updateClipTitle = useStore((s) => s.updateClipTitle)
  const addTag = useStore((s) => s.addTag)
  const removeTag = useStore((s) => s.removeTag)
  const addVideoTag = useStore((s) => s.addVideoTag)

  const clip = clips.find((c) => c.id === clipId) || null
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (clip) {
      setTitle(clip.title)
      setDraft('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId])

  if (!clip) return <></>

  const tags = clip.tags || []
  // 已用过的词 + 该视频的词表，去重后一起给出来
  const options = Array.from(new Set([...videoTags, ...tags]))

  const toggle = (t: string): void => {
    if (tags.includes(t)) removeTag(clip.id, t)
    else addTag(clip.id, t)
  }

  const addNew = (): void => {
    const t = draft.trim()
    if (!t) return
    addVideoTag(t) // 收进词表，之后别的片段也能一点就用
    if (!tags.includes(t)) addTag(clip.id, t)
    setDraft('')
  }

  const save = (): void => {
    updateClipTitle(clip.id, title.trim())
    onClose()
  }

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding" style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.bar}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.cancel}>取消</Text>
            </Pressable>
            <Text style={s.time}>
              {fmtClock(clip.in)} - {fmtClock(clip.out)} · {(clip.out - clip.in).toFixed(1)}s
            </Text>
            <Pressable onPress={save} hitSlop={12}>
              <Text style={s.done}>保存</Text>
            </Pressable>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>片段文字</Text>
            <TextInput
              style={s.input}
              value={title}
              onChangeText={setTitle}
              placeholder="比如：宽宽右路突破后传中"
              placeholderTextColor="#475569"
              multiline
              autoFocus
            />

            <Text style={[s.label, s.gap]}>标签</Text>
            <View style={s.chips}>
              {options.map((t) => {
                const on = tags.includes(t)
                return (
                  <Pressable key={t} style={[s.chip, on && s.chipOn]} onPress={() => toggle(t)}>
                    <Text style={[s.chipText, on && s.chipTextOn]}>{t}</Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={s.newRow}>
              <TextInput
                style={[s.input, s.newInput]}
                value={draft}
                onChangeText={setDraft}
                placeholder="新标签"
                placeholderTextColor="#475569"
                onSubmitEditing={addNew}
                returnKeyType="done"
              />
              <Pressable style={[s.addBtn, !draft.trim() && s.addOff]} onPress={addNew}>
                <Text style={s.addText}>加上</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%'
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  cancel: { color: '#94a3b8', fontSize: 15 },
  time: { color: '#64748b', fontSize: 11, fontVariant: ['tabular-nums'] },
  done: { color: '#22d3ee', fontSize: 15, fontWeight: '500' },

  body: { paddingHorizontal: 16, paddingTop: 12 },
  label: { color: '#e2e8f0', fontSize: 13, marginBottom: 7 },
  gap: { marginTop: 20 },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#e2e8f0',
    fontSize: 15,
    minHeight: 46
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 0.5,
    borderColor: '#334155'
  },
  chipOn: { backgroundColor: '#0891b2', borderColor: '#22d3ee' },
  chipText: { color: '#94a3b8', fontSize: 13 },
  chipTextOn: { color: '#fff' },

  newRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 34 },
  newInput: { flex: 1, minHeight: 0, paddingVertical: 10 },
  addBtn: {
    backgroundColor: '#334155',
    borderRadius: 9,
    paddingHorizontal: 16,
    justifyContent: 'center'
  },
  addOff: { opacity: 0.4 },
  addText: { color: '#e2e8f0', fontSize: 14 }
})

import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  PanResponder
} from 'react-native'
import { useStore } from '@core/store/useStore'
import { fmtMs } from '@core/utils/time'
import { clipDuration, clipGlobalIn, clipGlobalOut } from '@core/utils/timeline'

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
  const updateClipRange = useStore((s) => s.updateClipRange)
  const videos = useStore((s) => s.videos)
  const currentTime = useStore((s) => s.currentTime)
  const seek = useStore((s) => s.seek)
  const pause = useStore((s) => s.pause)

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

  // 一律用全局时间：片段可以跨视频，两端的局部时间分属不同参照系，直接加减会错
  const gin = clipGlobalIn(videos, clip)
  const gout = clipGlobalOut(videos, clip)
  const nudge = (which: 'in' | 'out', by: number): void => {
    const nextIn = which === 'in' ? gin + by : gin
    const nextOut = which === 'out' ? gout + by : gout
    if (nextOut - nextIn < 0.1) return // 至少留 0.1s，否则片段会翻转成负长度
    updateClipRange(clip.id, Math.max(0, nextIn), nextOut)
    seek(which === 'in' ? Math.max(0, nextIn) : nextOut)
  }
  const takeCurrent = (which: 'in' | 'out'): void => {
    const t = Math.max(0, currentTime)
    if (which === 'in' && gout - t < 0.1) return
    if (which === 'out' && t - gin < 0.1) return
    updateClipRange(clip.id, which === 'in' ? t : gin, which === 'out' ? t : gout)
  }

  const timeRow = (which: 'in' | 'out'): JSX.Element => (
    <View style={s.timeRow}>
      <Text style={s.timeLabel}>{which === 'in' ? '起点' : '终点'}</Text>
      <Text style={s.timeValue}>{fmtMs(which === 'in' ? gin : gout)}</Text>
      {[-1, -0.1, 0.1, 1].map((d) => (
        <Pressable key={d} style={s.nudge} onPress={() => nudge(which, d)}>
          <Text style={s.nudgeText}>{d > 0 ? `+${d}` : d}</Text>
        </Pressable>
      ))}
      <Pressable style={s.takeBtn} onPress={() => takeCurrent(which)}>
        <Text style={s.takeText}>取当前</Text>
      </Pressable>
    </View>
  )

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
            <Text style={s.time}>时长 {clipDuration(videos, clip).toFixed(1)}s</Text>
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
            />

            <Text style={[s.label, s.gap]}>起止时间微调</Text>
            {timeRow('in')}
            {timeRow('out')}
            <Text style={s.hint}>
              粗调直接在时间线上拖片段两端的手柄；这里用来做零点几秒的精调
            </Text>

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
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  timeLabel: { color: '#94a3b8', fontSize: 13, width: 30 },
  timeValue: {
    color: '#e2e8f0',
    fontSize: 13,
    width: 68,
    fontVariant: ['tabular-nums']
  },
  nudge: {
    backgroundColor: '#1e293b',
    borderRadius: 7,
    paddingVertical: 7,
    paddingHorizontal: 8,
    minWidth: 36,
    alignItems: 'center'
  },
  nudgeText: { color: '#cbd5e1', fontSize: 12 },
  takeBtn: {
    borderRadius: 7,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderWidth: 0.5,
    borderColor: 'rgba(34,211,238,0.55)'
  },
  takeText: { color: '#22d3ee', fontSize: 12 },
  hint: { color: '#64748b', fontSize: 11, lineHeight: 17, marginTop: 2 },
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

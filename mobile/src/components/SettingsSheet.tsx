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
import { platform } from '@core/ports'

interface Props {
  visible: boolean
  onClose: () => void
}

/** DeepSeek Key 与默认标签。两者都存在沙盒的 settings.json 里 */
export function SettingsSheet({ visible, onClose }: Props): JSX.Element {
  const defaultTags = useStore((s) => s.defaultTags)
  const setDefaultTags = useStore((s) => s.setDefaultTags)

  const [key, setKey] = useState('')
  const [tags, setTags] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!visible) return
    setSaved(false)
    platform()
      .getSettings()
      .then((st) => {
        setKey(st.deepseek_api_key || '')
        setTags((st.default_tags?.length ? st.default_tags : defaultTags).join('、'))
      })
      .catch(() => {})
  }, [visible, defaultTags])

  const save = async (): Promise<void> => {
    const list = tags
      .split(/[、,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    await platform().setSettings({ deepseek_api_key: key.trim(), default_tags: list })
    setDefaultTags(list)
    setSaved(true)
  }

  if (!visible) return <></>

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
            <Text style={s.title}>设置</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.close}>完成</Text>
            </Pressable>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>DeepSeek API Key</Text>
            <Text style={s.note}>用于「AI 打标签」和「比赛报告」。只存在这台手机上，不会上传别处。</Text>
            <View style={s.keyRow}>
              <TextInput
                style={[s.input, s.keyInput]}
                value={key}
                onChangeText={setKey}
                placeholder="sk-..."
                placeholderTextColor="#475569"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showKey}
              />
              <Pressable style={s.eye} onPress={() => setShowKey(!showKey)}>
                <Text style={s.eyeText}>{showKey ? '隐藏' : '显示'}</Text>
              </Pressable>
            </View>

            <Text style={[s.label, s.labelGap]}>默认标签</Text>
            <Text style={s.note}>新建时间线时预置的标签词表，用顿号或逗号分隔。</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={tags}
              onChangeText={setTags}
              multiline
              placeholder="进球、助攻、过人"
              placeholderTextColor="#475569"
            />

            <Pressable style={s.saveBtn} onPress={() => void save()}>
              <Text style={s.saveText}>{saved ? '已保存 ✓' : '保存'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '88%'
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '500' },
  close: { color: '#22d3ee', fontSize: 15 },

  body: { paddingHorizontal: 16, paddingTop: 14 },
  label: { color: '#e2e8f0', fontSize: 14, fontWeight: '500' },
  labelGap: { marginTop: 22 },
  note: { color: '#64748b', fontSize: 11, lineHeight: 17, marginTop: 4, marginBottom: 8 },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#e2e8f0',
    fontSize: 14
  },
  keyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  keyInput: { flex: 1 },
  eye: { paddingHorizontal: 10, paddingVertical: 11 },
  eyeText: { color: '#22d3ee', fontSize: 13 },
  multiline: { minHeight: 74, textAlignVertical: 'top' },

  saveBtn: {
    backgroundColor: '#0891b2',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 26,
    marginBottom: 34
  },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '500' }
})

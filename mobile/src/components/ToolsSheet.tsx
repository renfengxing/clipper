import { useState } from 'react'
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useStore } from '@core/store/useStore'
import { platform } from '@core/ports'

interface Props {
  visible: boolean
  onClose: () => void
  onExport: () => void
  onMerge: () => void
  onSettings: () => void
}

/** 工具入口：AI 打标签 / 比赛报告 / 导出 / 合并 / 设置 */
export function ToolsSheet({ visible, onClose, onExport, onMerge, onSettings }: Props): JSX.Element {
  const clips = useStore((s) => s.clips)
  const report = useStore((s) => s.report)
  const reportAt = useStore((s) => s.reportAt)
  const setReport = useStore((s) => s.setReport)
  const aiAutoTag = useStore((s) => s.aiAutoTag)
  const aiTagging = useStore((s) => s.aiTagging)

  const [reporting, setReporting] = useState(false)
  const [showReport, setShowReport] = useState(false)

  const noKeyHint = (): void =>
    Alert.alert('还没填 DeepSeek API Key', '到「设置」里填上就能用 AI 打标签和比赛报告了。', [
      { text: '知道了', style: 'cancel' },
      { text: '去设置', onPress: () => { onClose(); onSettings() } }
    ])

  const runTag = async (): Promise<void> => {
    if (clips.length === 0) return Alert.alert('还没有片段', '先标几个片段再来打标签。')
    const res = await aiAutoTag()
    if (res.ok) Alert.alert('打标签完成', `已为 ${clips.length} 个片段补上标签。`)
    else if (res.code === 'NO_KEY') noKeyHint()
    else Alert.alert('打标签失败', res.error || '未知错误')
  }

  const runReport = async (): Promise<void> => {
    if (clips.length === 0) return Alert.alert('还没有片段', '先标几个片段再生成报告。')
    setReporting(true)
    try {
      const res = await platform().report(clips)
      if (res.ok && res.report) {
        setReport(res.report)
        setShowReport(true)
      } else if (res.code === 'NO_KEY') {
        noKeyHint()
      } else {
        Alert.alert('生成报告失败', res.error || '未知错误')
      }
    } finally {
      setReporting(false)
    }
  }

  if (!visible) return <></>

  const item = (
    icon: string,
    label: string,
    sub: string,
    onPress: () => void,
    busy?: boolean
  ): JSX.Element => (
    <Pressable style={s.row} onPress={onPress} disabled={busy}>
      <Text style={s.icon}>{icon}</Text>
      <View style={s.meta}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
      {busy ? <ActivityIndicator color="#22d3ee" /> : <Text style={s.chev}>›</Text>}
    </Pressable>
  )

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.bar}>
            <Text style={s.title}>{showReport ? '比赛报告' : '工具'}</Text>
            <Pressable onPress={() => (showReport ? setShowReport(false) : onClose())} hitSlop={12}>
              <Text style={s.close}>{showReport ? '返回' : '完成'}</Text>
            </Pressable>
          </View>

          {showReport ? (
            <ScrollView style={s.reportBox}>
              <Text style={s.reportText}>{report || '（空）'}</Text>
            </ScrollView>
          ) : (
            <ScrollView style={s.list}>
              {item('🏷', 'AI 自动打标签', `按标题给 ${clips.length} 个片段补标签`, () => void runTag(), aiTagging)}
              {item(
                '📋',
                'AI 比赛报告',
                reportAt ? `上次生成于 ${new Date(reportAt).toLocaleString('zh-CN')}` : '按片段生成复盘报告',
                () => void runReport(),
                reporting
              )}
              {report ? item('📖', '查看上次的报告', '不重新生成，直接看', () => setShowReport(true)) : null}
              {item('📤', '导出片段', '裁好的片段存进相册', () => { onClose(); onExport() })}
              {item('🎬', '合并为一个视频', '多个片段接成一条，可烧字幕', () => { onClose(); onMerge() })}
              {item('⚙️', '设置', 'DeepSeek Key、默认标签', () => { onClose(); onSettings() })}
              <View style={s.pad} />
            </ScrollView>
          )}
        </View>
      </View>
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

  list: { paddingHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  icon: { fontSize: 19, width: 26, textAlign: 'center' },
  meta: { flex: 1 },
  label: { color: '#e2e8f0', fontSize: 15 },
  sub: { color: '#64748b', fontSize: 11, marginTop: 3 },
  chev: { color: '#475569', fontSize: 20 },
  pad: { height: 30 },

  reportBox: { paddingHorizontal: 16, paddingTop: 12 },
  reportText: { color: '#cbd5e1', fontSize: 13, lineHeight: 22, paddingBottom: 40 }
})

import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native'
import { useStore } from '@core/store/useStore'

interface Props {
  visible: boolean
  onClose: () => void
}

/** AI 比赛报告的阅读面板。生成动作在片段列表的工具行里 */
export function ReportSheet({ visible, onClose }: Props): JSX.Element {
  const report = useStore((s) => s.report)
  const reportAt = useStore((s) => s.reportAt)

  if (!visible) return <></>

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
            <View>
              <Text style={s.title}>比赛报告</Text>
              {reportAt && (
                <Text style={s.sub}>{new Date(reportAt).toLocaleString('zh-CN')}</Text>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.close}>完成</Text>
            </Pressable>
          </View>
          <ScrollView style={s.body}>
            <Text style={s.text}>{report || '（还没有生成报告）'}</Text>
          </ScrollView>
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
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b'
  },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '500' },
  sub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  close: { color: '#22d3ee', fontSize: 15 },
  body: { paddingHorizontal: 16, paddingTop: 12 },
  text: { color: '#cbd5e1', fontSize: 13, lineHeight: 22, paddingBottom: 40 }
})

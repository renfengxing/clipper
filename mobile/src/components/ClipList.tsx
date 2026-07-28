import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { useStore } from '@core/store/useStore'
import { fmtClock } from '@core/utils/time'
import { ordered, clipGlobalIn } from '@core/utils/timeline'

interface Props {
  /** 片段相关的工具（AI 标签 / 报告 / 导出 / 合并）都挂在列表上，随片段走 */
  onAiTag?: () => void
  onReport?: () => void
  onExport?: () => void
  onMerge?: () => void
}

/** 片段列表：点击=循环播放该片段，长按=删除；多视频时标来源徽标 */
export function ClipList({ onAiTag, onReport, onExport, onMerge }: Props = {}): JSX.Element {
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const deleteClip = useStore((s) => s.deleteClip)
  const activeTags = useStore((s) => s.activeTags)
  const toggleActiveTag = useStore((s) => s.toggleActiveTag)
  const clearActiveTags = useStore((s) => s.clearActiveTags)
  const tagFilterMode = useStore((s) => s.tagFilterMode)
  const aiTagging = useStore((s) => s.aiTagging)

  const idx: Record<string, number> = {}
  ordered(videos).forEach((v, i) => (idx[v.id] = i + 1))

  const usedTags = Array.from(new Set(clips.flatMap((c) => c.tags || []))).sort()
  let visible = [...clips].sort((a, b) => clipGlobalIn(videos, a) - clipGlobalIn(videos, b))
  if (activeTags.length > 0) {
    visible = visible.filter((c) => {
      const ct = c.tags || []
      return tagFilterMode === 'and'
        ? activeTags.every((t) => ct.includes(t))
        : activeTags.some((t) => ct.includes(t))
    })
  }

  const confirmDelete = (id: string, title: string): void => {
    Alert.alert('删除片段', title || '未命名片段', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteClip(id) }
    ])
  }

  const tool = (label: string, onPress?: () => void, busy?: boolean): JSX.Element => (
    <Pressable
      style={[s.tool, (!onPress || busy) && s.toolOff]}
      onPress={onPress}
      disabled={!onPress || busy || clips.length === 0}
    >
      <Text style={s.toolText}>{busy ? '…' : label}</Text>
    </Pressable>
  )

  return (
    <View style={s.wrap}>
      {(onAiTag || onReport || onExport || onMerge) && (
        <View style={s.toolRow}>
          {tool('🏷 标签', onAiTag, aiTagging)}
          {tool('📋 报告', onReport)}
          {tool('📤 导出', onExport)}
          {tool('🎬 合并', onMerge)}
        </View>
      )}

      {usedTags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          <Pressable
            onPress={clearActiveTags}
            style={[s.filterChip, activeTags.length === 0 && s.filterChipOn]}
          >
            <Text style={[s.filterText, activeTags.length === 0 && s.filterTextOn]}>全部</Text>
          </Pressable>
          {usedTags.map((t) => (
            <Pressable
              key={t}
              onPress={() => toggleActiveTag(t)}
              style={[s.filterChip, activeTags.includes(t) && s.filterChipOn]}
            >
              <Text style={[s.filterText, activeTags.includes(t) && s.filterTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <ScrollView style={s.list}>
        {visible.length === 0 ? (
          <Text style={s.empty}>
            {clips.length === 0 ? '还没有片段\n播放到位置点「标记起点」开始' : '没有符合条件的片段'}
          </Text>
        ) : (
          visible.map((c, i) => (
            <Pressable
              key={c.id}
              onPress={() => selectClip(c.id)}
              onLongPress={() => confirmDelete(c.id, c.title)}
              style={[s.row, c.id === selectedClipId && s.rowOn]}
            >
              <Text style={s.rowIdx}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={2}>
                  {c.title || '未命名片段'}
                </Text>
                <View style={s.rowMetaLine}>
                  {videos.length > 1 && idx[c.videoId] && (
                    <Text style={s.badge}>视频{idx[c.videoId]}</Text>
                  )}
                  <Text style={s.rowMeta}>
                    {fmtClock(c.in)} - {fmtClock(c.out)} · {(c.out - c.in).toFixed(1)}s
                  </Text>
                </View>
                {(c.tags || []).length > 0 && (
                  <View style={s.tagRow}>
                    {(c.tags || []).map((t) => (
                      <Text key={t} style={s.tag}>
                        {t}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
              {c.id === selectedClipId && <Text style={s.loop}>循环中</Text>}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  toolRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 2
  },
  tool: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center'
  },
  toolOff: { opacity: 0.4 },
  toolText: { color: '#cbd5e1', fontSize: 11 },

  wrap: { flex: 1, borderTopWidth: 0.5, borderTopColor: '#1e293b' },
  filterRow: { flexGrow: 0, paddingHorizontal: 10, paddingVertical: 8 },
  filterChip: { backgroundColor: '#334155', borderRadius: 12, paddingVertical: 5, paddingHorizontal: 11, marginRight: 6 },
  filterChipOn: { backgroundColor: '#0891b2' },
  filterText: { color: '#cbd5e1', fontSize: 12 },
  filterTextOn: { color: '#fff' },
  list: { flex: 1 },
  empty: { color: '#475569', fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 21 },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e293b',
    alignItems: 'flex-start'
  },
  rowOn: { backgroundColor: '#1e293b' },
  rowIdx: { color: '#475569', fontSize: 12, width: 18, paddingTop: 2 },
  rowTitle: { color: '#e2e8f0', fontSize: 14, lineHeight: 20 },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  badge: { color: '#94a3b8', fontSize: 10, backgroundColor: '#334155', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  rowMeta: { color: '#64748b', fontSize: 11 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  tag: { color: '#cbd5e1', fontSize: 10, backgroundColor: '#334155', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  loop: { color: '#22d3ee', fontSize: 10, paddingTop: 2 }
})

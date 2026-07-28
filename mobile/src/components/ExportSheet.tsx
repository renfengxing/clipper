import { useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  Switch,
  StyleSheet,
  ActivityIndicator
} from 'react-native'
import { useStore } from '@core/store/useStore'
import { platform } from '@core/ports'
import { APP_NAME } from '@core/constants'
import { fmtClock } from '@core/utils/time'
import { localToGlobal, clipSegments } from '@core/utils/timeline'
import { exportIdOf } from '../platform/ios'

type Mode = 'export' | 'merge'

interface Props {
  mode: Mode | null
  onClose: () => void
}

/**
 * 导出 / 合并。iOS 没有「选个文件夹」，成品一律写回系统相册里的同名相册。
 * 勾选逻辑复用 core 的 checkedIds，和桌面版一致。
 */
export function ExportSheet({ mode, onClose }: Props): JSX.Element {
  const clips = useStore((s) => s.clips)
  const videos = useStore((s) => s.videos)
  const checkedIds = useStore((s) => s.checkedIds)
  const toggleChecked = useStore((s) => s.toggleChecked)
  const setChecked = useStore((s) => s.setChecked)
  const timelineName = useStore((s) => s.timelineName)
  const setExportHistory = useStore((s) => s.setExportHistory)
  const exportHistory = useStore((s) => s.exportHistory)

  const [subtitle, setSubtitle] = useState(true)
  const [watermark, setWatermark] = useState(false)
  const [skipDone, setSkipDone] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ index: number; total: number; name: string } | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // 不再自动全选：导出/合并只作用于片段列表里勾选的那些（与 PC 版一致）
  useEffect(() => {
    if (mode) setResult(null)
  }, [mode])

  useEffect(() => {
    if (!running) return
    return platform().onExportProgress((p) => setProgress({ index: p.index, total: p.total, name: p.name }))
  }, [running])

  const sorted = [...clips].sort(
    (a, b) =>
      localToGlobal(videos, a.videoId, a.in) - localToGlobal(videos, b.videoId, b.in)
  )
  const picked = sorted.filter((c) => checkedIds.includes(c.id))

  const toInput = (c: (typeof clips)[number]): {
    videoRef: string
    in: number
    out: number
    title: string
    tags?: string[]
    segments?: Array<{ videoRef: string; in: number; out: number }>
  } => {
    // 跨视频片段拆成几段传给导出层，由它拼成一条连续视频
    const segs = clipSegments(videos, c).map((g) => ({
      videoRef: g.video.path,
      in: g.in,
      out: g.out
    }))
    return {
      videoRef: segs[0]?.videoRef || videos.find((v) => v.id === c.videoId)?.path || '',
      in: segs[0]?.in ?? c.in,
      out: segs[segs.length - 1]?.out ?? c.out,
      title: c.title,
      tags: c.tags,
      segments: segs
    }
  }

  const run = async (): Promise<void> => {
    if (picked.length === 0 || !mode) return
    setRunning(true)
    setProgress(null)
    setResult(null)
    try {
      if (mode === 'export') {
        const res = await platform().exportClips({
          outDir: '',
          clips: picked.map(toInput),
          skipExisting: skipDone,
          priorExports: exportHistory,
          watermark: watermark ? APP_NAME : undefined
        })
        setExportHistory(res.exports)
        const parts = [`已导出 ${res.exported} 个片段到相册`]
        if (res.skipped > 0) parts.push(`跳过 ${res.skipped} 个已导出过的`)
        if (res.failed > 0) parts.push(`失败 ${res.failed} 个`)
        setResult(parts.join('，'))
      } else {
        const res = await platform().mergeClips({
          outDir: '',
          name: `${timelineName || '合集'}-合并`,
          clips: picked.map(toInput),
          burnSubtitle: subtitle,
          watermark: watermark ? APP_NAME : undefined
        })
        setResult(res.ok ? '合并完成，已存入相册' : `合并失败：${res.error || '未知错误'}`)
      }
    } catch (err) {
      setResult(`失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  if (!mode) return <></>

  const total = picked.reduce((n, c) => n + (c.out - c.in), 0)

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
            <Text style={s.title}>{mode === 'export' ? '导出片段' : '合并为一个视频'}</Text>
            <Pressable onPress={onClose} hitSlop={12} disabled={running}>
              <Text style={[s.close, running && s.closeOff]}>关闭</Text>
            </Pressable>
          </View>

          <View style={s.selBar}>
            <Text style={s.selText}>
              已选 {picked.length} / {clips.length} 个 · 共 {fmtClock(total)}
            </Text>
            <View style={s.selBtns}>
              <Pressable onPress={() => setChecked(clips.map((c) => c.id))} hitSlop={8}>
                <Text style={s.selAction}>全选</Text>
              </Pressable>
              <Pressable onPress={() => setChecked([])} hitSlop={8}>
                <Text style={s.selAction}>清空</Text>
              </Pressable>
            </View>
          </View>

          {picked.length === 0 && (
            <Text style={s.needPick}>
              先在片段列表里勾选要{mode === 'export' ? '导出' : '合并'}的片段，这里也可以直接勾。
            </Text>
          )}

          <ScrollView style={s.list}>
            {sorted.map((c, i) => {
              const on = checkedIds.includes(c.id)
              return (
                <Pressable key={c.id} style={s.row} onPress={() => toggleChecked(c.id)}>
                  <View style={[s.box, on && s.boxOn]}>{on && <Text style={s.tick}>✓</Text>}</View>
                  <View style={s.rowMeta}>
                    <Text numberOfLines={1} style={s.rowTitle}>
                      {i + 1}. {c.title || '未命名片段'}
                    </Text>
                    <Text style={s.rowSub}>
                      {(c.out - c.in).toFixed(1)}s
                      {(c.tags || []).length ? ` · ${(c.tags || []).join(' ')}` : ''}
                      {exportHistory[exportIdOf(toInput(c))] ? ' · 已导出' : ''}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
            {clips.length === 0 && <Text style={s.empty}>还没有标记任何片段</Text>}
          </ScrollView>

          <View style={s.opts}>
            {mode === 'merge' && (
              <View style={s.optRow}>
                <Text style={s.optLabel}>把片段标题烧成字幕</Text>
                <Switch value={subtitle} onValueChange={setSubtitle} />
              </View>
            )}
            <View style={s.optRow}>
              <Text style={s.optLabel}>右下角加水印</Text>
              <Switch value={watermark} onValueChange={setWatermark} />
            </View>
            {mode === 'export' && (
              <View style={s.optRow}>
                <Text style={s.optLabel}>跳过已导出过的片段</Text>
                <Switch value={skipDone} onValueChange={setSkipDone} />
              </View>
            )}
            <Text style={s.optNote}>
              成品保存到相册的「{APP_NAME}」相册。烧字幕/水印需要重新编码，比直接裁剪慢不少。
            </Text>
          </View>

          <View style={s.footer}>
            {running ? (
              <View style={s.runRow}>
                <ActivityIndicator color="#22d3ee" />
                <Text style={s.runText}>
                  {progress
                    ? `正在处理 ${progress.index + 1}/${progress.total} · ${progress.name}`
                    : '正在准备…'}
                </Text>
              </View>
            ) : (
              <Pressable
                style={[s.goBtn, picked.length === 0 && s.goOff]}
                disabled={picked.length === 0}
                onPress={() => void run()}
              >
                <Text style={s.goText}>
                  {mode === 'export' ? `导出 ${picked.length} 个片段` : `合并 ${picked.length} 个片段`}
                </Text>
              </Pressable>
            )}
            {result && <Text style={s.result}>{result}</Text>}
          </View>
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
    maxHeight: '90%'
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
  closeOff: { color: '#475569' },

  selBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9
  },
  selText: { color: '#94a3b8', fontSize: 12 },
  selBtns: { flexDirection: 'row', gap: 14 },
  selAction: { color: '#22d3ee', fontSize: 13 },

  list: { paddingHorizontal: 12, maxHeight: 260 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, paddingHorizontal: 4 },
  box: {
    width: 21,
    height: 21,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#475569',
    alignItems: 'center',
    justifyContent: 'center'
  },
  boxOn: { backgroundColor: '#0891b2', borderColor: '#22d3ee' },
  tick: { color: '#fff', fontSize: 12, fontWeight: '700' },
  rowMeta: { flex: 1 },
  rowTitle: { color: '#e2e8f0', fontSize: 14 },
  rowSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  empty: { color: '#64748b', fontSize: 13, textAlign: 'center', paddingVertical: 26 },

  opts: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#1e293b' },
  optRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  optLabel: { color: '#cbd5e1', fontSize: 14 },
  optNote: { color: '#64748b', fontSize: 11, lineHeight: 17, marginTop: 6 },

  footer: { padding: 14, paddingBottom: 30 },
  goBtn: { backgroundColor: '#0891b2', borderRadius: 11, paddingVertical: 14, alignItems: 'center' },
  goOff: { opacity: 0.4 },
  goText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  runRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 13 },
  runText: { color: '#cbd5e1', fontSize: 13 },
  result: { color: '#22d3ee', fontSize: 13, textAlign: 'center', marginTop: 11 },
  needPick: {
    color: '#fcd34d',
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 6
  }
})

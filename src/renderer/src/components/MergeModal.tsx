import { useEffect, useState } from 'react'
import { useStore } from '@core/store/useStore'
import type { ExportProgress } from '@core/types'
import { APP_NAME } from '@core/constants'
import { uuid } from '@core/utils/id'
import { dirOf, basename } from '../utils/media'
import { ordered, clipSegments } from '@core/utils/timeline'

export function MergeModal(): JSX.Element | null {
  const open = useStore((s) => s.mergeOpen)
  const close = useStore((s) => s.closeMerge)
  const clips = useStore((s) => s.clips)
  const checkedIds = useStore((s) => s.checkedIds)
  const videos = useStore((s) => s.videos)
  const timelineName = useStore((s) => s.timelineName)
  const lastExportDir = useStore((s) => s.lastExportDir)
  const setLastExportDir = useStore((s) => s.setLastExportDir)
  const videoTags = useStore((s) => s.videoTags)

  const [name, setName] = useState('合并片段')
  const [burnDanmaku, setBurnDanmaku] = useState(false)
  const [watermark, setWatermark] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [done, setDone] = useState<{ ok: boolean; outPath?: string; error?: string } | null>(null)

  useEffect(() => {
    if (open) {
      setRunning(false)
      setProgress(null)
      setDone(null)
      const tags = Array.from(
        new Set(clips.filter((c) => checkedIds.includes(c.id)).flatMap((c) => c.tags || []))
      )
      setName(['合并', ...tags].join('_'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => window.api.onExportProgress((p) => setProgress(p)), [])

  if (!open || videos.length === 0) return null

  const videoById = (id: string): (typeof videos)[number] | undefined => videos.find((v) => v.id === id)
  // 按视频顺序 + 局部入点排序勾选片段
  const selected = clips
    .filter((c) => checkedIds.includes(c.id))
    .sort((a, b) => (videoById(a.videoId)?.order ?? 0) - (videoById(b.videoId)?.order ?? 0) || a.in - b.in)
  const firstDir = dirOf(ordered(videos)[0]?.path || '')
  const outDir = lastExportDir || firstDir + '/' + (timelineName || '合并')

  const start = async (): Promise<void> => {
    setRunning(true)
    setDone(null)
    const res = await window.api.mergeClips({
      outDir,
      name: name.trim() || '合并片段',
      burnDanmaku,
      watermark: watermark ? APP_NAME : undefined,
      clips: selected
        .map((c) => {
          const v = videoById(c.videoId)
          if (!v) return null
          // 跨视频片段拆成分段，导出层会把它们接成一条连续视频
          const segs = clipSegments(videos, c).map((g) => ({
            videoRef: g.video.path,
            in: g.in,
            out: g.out
          }))
          return {
            sourcePath: segs[0]?.videoRef || v.path,
            in: segs[0]?.in ?? c.in,
            out: segs[segs.length - 1]?.out ?? c.out,
            title: c.title,
            segments: segs
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    })
    if (res.ok && res.outPath) {
      setLastExportDir(outDir)
      // #76/#96：合并视频的片段写到它的 sidecar；再建个只含该视频的时间线 .kkclip
      const outPath = res.outPath
      const iso = new Date().toISOString()
      const probe = await window.api.probeVideo(outPath)
      let acc = 0
      const mclips = selected.map((c, i) => {
        const len = c.out - c.in
        const clip = { id: uuid(), in: acc, out: acc + len, title: c.title, order: i, created_at: iso, tags: c.tags || [] }
        acc += len
        return clip
      })
      const fileName = basename(outPath)
      await window.api.saveProject(outPath + '.kkfb.json', {
        version: '1.1',
        app_name: APP_NAME,
        clips: mclips,
        video_tags: videoTags,
        updated_at: iso
      })
      const kkclip = outPath.replace(/\.[^./\\]+$/, '') + '.kkclip'
      await window.api.saveProject(kkclip, {
        version: '2.0',
        app_name: APP_NAME,
        name: name.trim() || '合并片段',
        created_at: iso,
        updated_at: iso,
        videos: [{ path: outPath, fileName, duration: probe.duration || acc, fps: probe.fps || 30, order: 0 }],
        video_tags: videoTags
      })
      void window.api.addRecentFile(kkclip)
    }
    setDone(res)
    setRunning(false)
  }

  const pct = progress ? Math.round((progress.index / progress.total) * 100) : 0

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70">
      <div className="w-[460px] rounded-lg bg-slate-800 border border-slate-600 shadow-2xl p-5">
        <h3 className="text-base font-medium text-slate-100 mb-1">合并 {selected.length} 个片段</h3>
        <div className="text-xs text-slate-500 mb-3">按时间顺序拼接为一个新视频（可跨视频）</div>

        <label className="block text-sm text-slate-300 mb-1">输出文件名</label>
        <div className="flex items-center gap-1 mb-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={running}
            className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-600 text-slate-100 outline-none focus:border-cyan-400 text-sm"
          />
          <span className="text-slate-500 text-sm">.mp4</span>
        </div>
        <div className="text-xs text-slate-500 truncate mb-3">输出到：{outDir}</div>

        <label className="flex items-center gap-2 mb-1 text-sm text-slate-200 cursor-pointer">
          <input type="checkbox" checked={burnDanmaku} onChange={(e) => setBurnDanmaku(e.target.checked)} disabled={running} />
          合并字幕（把片段标题烧录进画面）
        </label>
        <label className="flex items-center gap-2 mb-1 text-sm text-slate-200 cursor-pointer">
          <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} disabled={running} />
          加水印「{APP_NAME}」（右下角）
        </label>
        <div className="text-[11px] text-slate-500 mb-4 pl-6">
          勾选字幕或水印会重新编码（较慢）；跨视频且编码不一致时也会重编码。
        </div>

        {(running || progress) && !done && (
          <div className="mb-4">
            <div className="h-2 rounded bg-slate-700 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-slate-400 truncate">{progress ? progress.name : '准备中…'}</div>
          </div>
        )}

        {done && (
          <div className="mb-4 text-sm">
            {done.ok ? (
              <span className="text-emerald-400">完成：{done.outPath}</span>
            ) : (
              <span className="text-red-400">失败：{done.error}</span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {done?.ok && (
            <button
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200 mr-auto"
              onClick={() => window.api.openFolder(outDir)}
            >
              📂 打开文件夹
            </button>
          )}
          <button
            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200"
            onClick={close}
            disabled={running}
          >
            {done?.ok ? '关闭' : '取消'}
          </button>
          {!done?.ok && (
            <button
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm text-white disabled:opacity-50"
              onClick={start}
              disabled={running || selected.length < 2}
            >
              {running ? '合并中…' : '开始合并'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

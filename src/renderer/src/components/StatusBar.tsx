import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'

function clockOf(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => n.toString().padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function StatusBar(): JSX.Element {
  const video = useStore((s) => s.video)
  const savedAt = useStore((s) => s.savedAt)
  const [ffmpeg, setFfmpeg] = useState<{ ok: boolean; version: string } | null>(null)

  useEffect(() => {
    window.api.ffmpegHealth().then((h) => setFfmpeg({ ok: h.ok, version: h.version }))
  }, [])

  return (
    <footer className="flex items-center justify-between px-4 h-7 bg-slate-950 border-t border-slate-800 text-xs text-slate-500 shrink-0">
      <span>
        {!video
          ? '就绪'
          : savedAt
            ? `已保存 ${clockOf(savedAt)}`
            : '未保存'}
      </span>
      <span className="text-slate-600">
        {ffmpeg == null
          ? 'ffmpeg 检测中…'
          : ffmpeg.ok
            ? `ffmpeg ✓ ${ffmpeg.version}`
            : 'ffmpeg ✗ 未找到'}
      </span>
    </footer>
  )
}

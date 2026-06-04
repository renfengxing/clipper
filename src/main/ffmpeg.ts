import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import ffmpegStatic from 'ffmpeg-static'
import type { Settings } from './settings'

export interface ExportClip {
  sourcePath: string // 每个片段按自己所属视频的源文件切（多视频）
  in: number
  out: number
  title: string
  tags?: string[]
}

export interface ExportOptions {
  outDir: string
  clips: ExportClip[]
  skipExisting: boolean
  /** 上次导出记录：key=`${标题}|${入点}` → 文件名。命中且文件还在则跳过（规格外·增量导出） */
  priorExports?: Record<string, string>
  watermark?: string // #81：导出水印（应用名）
}

export interface ExportResult {
  exported: number
  skipped: number
  failed: number
  exports: Record<string, string> // 更新后的导出记录
}

function exportKey(title: string, inSec: number): string {
  return `${title}|${inSec.toFixed(3)}`
}

export interface ExportProgress {
  index: number // 第几个（1-based）
  total: number
  name: string
  status: 'running' | 'done' | 'skipped' | 'failed'
  error?: string
}

/** 解析 ffmpeg 可执行路径：设置指定 > 打包内置(ffmpeg-static) > 系统 PATH */
export function resolveFfmpegPath(settings: Settings): string {
  if (settings.ffmpeg_path && settings.ffmpeg_path !== 'bundled') {
    if (existsSync(settings.ffmpeg_path)) return settings.ffmpeg_path
  }
  if (ffmpegStatic) {
    // 打包后二进制被解到 app.asar.unpacked
    const unpacked = ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
    if (existsSync(unpacked)) return unpacked
    if (existsSync(ffmpegStatic)) return ffmpegStatic
  }
  return 'ffmpeg' // 兜底走 PATH
}

/** 探测视频时长(秒)+帧率(fps)。ffmpeg-static 不带 ffprobe，跑 `ffmpeg -i` 解析 stderr。 */
export function probeVideo(sourcePath: string, settings: Settings): { duration: number; fps: number } {
  const ffmpeg = resolveFfmpegPath(settings)
  try {
    const r = spawnSync(ffmpeg, ['-i', sourcePath], { encoding: 'utf-8' })
    const text = (r.stderr || '') + (r.stdout || '')
    const fm = /([0-9]+(?:\.[0-9]+)?)\s*fps/.exec(text)
    const fps = fm && parseFloat(fm[1]) > 0 ? parseFloat(fm[1]) : 30
    // Duration: 00:14:52.96,
    const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
    const duration = dm
      ? parseInt(dm[1], 10) * 3600 + parseInt(dm[2], 10) * 60 + parseFloat(dm[3])
      : 0
    return { duration, fps }
  } catch {
    return { duration: 0, fps: 30 }
  }
}

export function ffmpegHealth(settings: Settings): { ok: boolean; version: string; path: string } {
  const path = resolveFfmpegPath(settings)
  try {
    const r = spawnSync(path, ['-version'], { encoding: 'utf-8' })
    const first = (r.stdout || '').split('\n')[0] || ''
    const m = /ffmpeg version (\S+)/.exec(first)
    return { ok: r.status === 0, version: m ? m[1] : first, path }
  } catch {
    return { ok: false, version: '', path }
  }
}

/** 文件名清洗：去掉非法字符，空标题给占位名 */
function sanitize(title: string, index: number): string {
  const cleaned = title.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || `片段${index + 1}`
}

/** 文件名基名：标签 + 标题（#63：标签在前）*/
function clipBaseName(clip: ExportClip, index: number): string {
  const parts = [...(clip.tags || []), clip.title].filter(Boolean)
  return sanitize(parts.join('_'), index)
}

function runOne(ffmpeg: string, source: string, out: string, inSec: number, dur: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // 规格 6.3：-ss <in> -i <source> -t <duration> -c copy <out> -y（秒级、不重编码）
    const args = ['-ss', String(inSec), '-i', source, '-t', String(dur), '-c', 'copy', out, '-y']
    const p = spawn(ffmpeg, args)
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-400)))))
  })
}

export async function exportClips(
  settings: Settings,
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void
): Promise<ExportResult> {
  const ffmpeg = resolveFfmpegPath(settings)
  if (!existsSync(opts.outDir)) mkdirSync(opts.outDir, { recursive: true }) // #40：自动建目录
  const total = opts.clips.length
  const prior = opts.priorExports || {}
  const exports: Record<string, string> = { ...prior }
  const used = new Set<string>()
  let exported = 0
  let skipped = 0
  let failed = 0

  // #81：有水印则重编码（生成一份 wm.ass 复用），否则 -c copy
  const wmDir = opts.watermark ? mkdtempSync(join(tmpdir(), 'fcwm-')) : null
  const wmAss = wmDir ? join(wmDir, 'wm.ass') : null
  if (wmAss && opts.watermark) writeFileSync(wmAss, buildAss([], opts.watermark), 'utf-8')

  try {
  for (let i = 0; i < total; i++) {
    const clip = opts.clips[i]
    const base = clipBaseName(clip, i)
    const key = exportKey(base, clip.in)

    // 增量导出：标题+入点都没变且文件还在 → 跳过，不重新截取
    const priorName = prior[key]
    if (priorName && existsSync(join(opts.outDir, priorName))) {
      used.add(priorName)
      skipped++
      onProgress({ index: i + 1, total, name: priorName, status: 'skipped' })
      continue
    }

    // 命名冲突自动加 _02 _03（规格 12）
    let name = base
    let n = 1
    let outPath = join(opts.outDir, name + '.mp4')
    if (existsSync(outPath) && opts.skipExisting) {
      used.add(name + '.mp4')
      exports[key] = name + '.mp4'
      skipped++
      onProgress({ index: i + 1, total, name: name + '.mp4', status: 'skipped' })
      continue
    }
    while (used.has(name + '.mp4') || existsSync(outPath)) {
      n++
      name = `${base}_${String(n).padStart(2, '0')}`
      outPath = join(opts.outDir, name + '.mp4')
    }
    used.add(name + '.mp4')

    onProgress({ index: i + 1, total, name: name + '.mp4', status: 'running' })
    try {
      if (wmAss) await runOneWithAss(ffmpeg, clip.sourcePath, outPath, clip.in, clip.out - clip.in, wmAss)
      else await runOne(ffmpeg, clip.sourcePath, outPath, clip.in, clip.out - clip.in)
      exported++
      exports[key] = name + '.mp4'
      onProgress({ index: i + 1, total, name: name + '.mp4', status: 'done' })
    } catch (err) {
      failed++
      onProgress({
        index: i + 1,
        total,
        name: name + '.mp4',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
  return { exported, skipped, failed, exports }
  } finally {
    if (wmDir) rmSync(wmDir, { recursive: true, force: true })
  }
}

// 供导出弹窗在源目录不可写时参考（保留扩展点）
export function sourceDir(sourcePath: string): string {
  return dirname(sourcePath)
}

function runConcat(ffmpeg: string, listPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath, '-y']
    const p = spawn(ffmpeg, args)
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-400)))))
  })
}

export interface MergeOptions {
  outDir: string
  name: string
  clips: ExportClip[] // 每个片段带自己的 sourcePath（可跨视频）
  burnDanmaku?: boolean // #77：把标题烧录成弹幕
  watermark?: string // #81：水印（应用名）
}

function assTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.floor((sec - Math.floor(sec)) * 100)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, ' ').replace(/[{}]/g, '').replace(/\n/g, ' ')
}

/** 生成 ASS：弹幕（标题在时间窗内从右往左飘）+ 可选水印（右下角常驻） */
function buildAss(
  events: Array<{ start: number; end: number; text: string }>,
  watermark?: string
): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,PingFang SC,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1
Style: WM,PingFang SC,28,&H64FFFFFF,&H000000FF,&H64000000,&H80000000,0,0,0,0,100,100,0,0,1,1.5,1,3,0,18,14,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines = events.map((e, i) => {
    const y = 40 + (i % 6) * 70
    const move = `{\\move(1280,${y},-500,${y})}`
    return `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Default,,0,0,0,,${move}${escapeAss(e.text)}`
  })
  if (watermark) {
    lines.push(
      `Dialogue: 0,0:00:00.00,9:59:59.99,WM,,0,0,0,,${escapeAss(watermark)}`
    )
  }
  return header + lines.join('\n') + '\n'
}

function vfAss(assPath: string): string {
  const escaped = assPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
  return `ass='${escaped}'`
}

/** 带 ASS 叠加（水印/弹幕）截取单个片段，需重编码 */
function runOneWithAss(
  ffmpeg: string,
  source: string,
  out: string,
  inSec: number,
  dur: number,
  assPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss', String(inSec), '-i', source, '-t', String(dur),
      '-vf', vfAss(assPath),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'copy', out, '-y'
    ]
    const p = spawn(ffmpeg, args)
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-500)))))
  })
}

function runReencodeWithAss(ffmpeg: string, input: string, ass: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', input,
      '-vf', vfAss(ass),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'copy', out, '-y'
    ]
    const p = spawn(ffmpeg, args)
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-500)))))
  })
}

/** 把多个片段合并成一个新视频（先各自 -c copy 截取到临时目录，再 concat，#45） */
export async function mergeClips(
  settings: Settings,
  opts: MergeOptions,
  onProgress: (p: ExportProgress) => void
): Promise<{ outPath: string }> {
  const ffmpeg = resolveFfmpegPath(settings)
  if (!existsSync(opts.outDir)) mkdirSync(opts.outDir, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'fcmerge-'))
  const total = opts.clips.length
  const parts: string[] = []
  try {
    for (let i = 0; i < total; i++) {
      const clip = opts.clips[i]
      onProgress({ index: i + 1, total: total + 1, name: `截取 ${i + 1}/${total}`, status: 'running' })
      const part = join(tmp, `part_${String(i).padStart(3, '0')}.mp4`)
      await runOne(ffmpeg, clip.sourcePath, part, clip.in, clip.out - clip.in)
      parts.push(part)
    }
    // concat 列表（路径里的单引号需转义）
    const listPath = join(tmp, 'list.txt')
    writeFileSync(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))

    const base = sanitize(opts.name, 0)
    let name = base
    let n = 1
    let outPath = join(opts.outDir, name + '.mp4')
    while (existsSync(outPath)) {
      n++
      name = `${base}_${String(n).padStart(2, '0')}`
      outPath = join(opts.outDir, name + '.mp4')
    }
    onProgress({ index: total + 1, total: total + 1, name: `合并为 ${name}.mp4`, status: 'running' })

    if (opts.burnDanmaku || opts.watermark) {
      // 先 concat 到临时文件，再用 ASS 叠加弹幕/水印（需重编码，#77/#81）
      const mergedTmp = join(tmp, 'merged.mp4')
      await runConcat(ffmpeg, listPath, mergedTmp)
      // 弹幕事件（仅在勾选时）：合并时间线上各片段顺序位置
      let acc = 0
      const events = opts.burnDanmaku
        ? opts.clips.map((c) => {
            const len = c.out - c.in
            const ev = { start: acc, end: acc + len, text: c.title || '' }
            acc += len
            return ev
          })
        : []
      const assPath = join(tmp, 'overlay.ass')
      writeFileSync(assPath, buildAss(events, opts.watermark), 'utf-8')
      onProgress({ index: total + 1, total: total + 1, name: `烧录画面…`, status: 'running' })
      await runReencodeWithAss(ffmpeg, mergedTmp, assPath, outPath)
    } else {
      await runConcat(ffmpeg, listPath, outPath)
    }

    onProgress({ index: total + 1, total: total + 1, name: `${name}.mp4`, status: 'done' })
    return { outPath }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

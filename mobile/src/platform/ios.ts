import * as FileSystem from 'expo-file-system'
import type { Platform, Settings } from '@core/ports'
import { requestPickVideos } from './pickerBridge'
import { ClipperMedia, onProgress as onNativeProgress } from '../../modules/clipper-media'
import type { ExportProgress } from '@core/types'

/** 选片时相册已给出时长，缓存下来省一次探测（fps 拿不到，先按 30 兜底） */
const metaCache = new Map<string, { duration: number; fps: number }>()

/**
 * iOS 平台实现。
 * videoRef = 相册资源标识（PHAsset localIdentifier 或 file:// URI）。
 * 关键差异：相册视频旁边写不了 sidecar，所以工程数据一律存 app 沙盒，
 * 以 videoRef 的哈希做文件名 —— 这正是 Platform 端口把 key 抽象出来的原因。
 */

/** 导出去向：系统相册里的这个相册（iOS 没有「选文件夹」的概念） */
const ALBUM_NAME = '宽宽爸视频切片'

const DATA_DIR = FileSystem.documentDirectory + 'clipper/'
const SETTINGS_FILE = DATA_DIR + 'settings.json'

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DATA_DIR)
  if (!info.exists) await FileSystem.makeDirectoryAsync(DATA_DIR, { intermediates: true })
}

/** 把任意 ref/key 变成安全的文件名 */
function safeName(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  const tail = key.replace(/[^a-zA-Z0-9]/g, '').slice(-16)
  return `${tail}_${(h >>> 0).toString(36)}`
}

/** 导出记录的键：同一个视频的同一段时间即视为同一次导出 */
export function exportIdOf(c: { videoRef: string; in: number; out: number }): string {
  return `${refKey(c.videoRef)}#${c.in.toFixed(2)}-${c.out.toFixed(2)}`
}

/** 用文件名（内含相册资源 id）做稳定 key，跨重装仍能对上同一个视频 */
function refKey(videoRef: string): string {
  return safeName(decodeURIComponent(videoRef.split('/').pop() || videoRef))
}

const DEFAULT_SETTINGS: Settings = {
  deepseek_api_key: '',
  default_tags: ['进球', '助攻', '过人', '射门', '防守', '失误', '扑救', '任意球'],
  keybindings: {},
  recent_files: [],
  last_timeline: ''
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = await FileSystem.readAsStringAsync(SETTINGS_FILE)
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function deepseek(prompt: string, maxTokens: number): Promise<string> {
  const s = await readSettings()
  const key = (s.deepseek_api_key || '').trim()
  if (!key) {
    const e = new Error('未设置 DeepSeek API Key') as Error & { code: string }
    e.code = 'NO_KEY'
    throw e
  }
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) throw new Error(`DeepSeek API ${res.status}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return (data.choices?.[0]?.message?.content || '').trim()
}

export const iosPlatform: Platform = {
  // —— 视频 ——
  async probeVideo(videoRef) {
    // 选片时已缓存；缓存没有则返回 0（时间线会等 onLoad 后再修正）
    const cached = metaCache.get(videoRef)
    return cached ?? { duration: 0, fps: 30 }
  },

  /**
   * 走自建的 AlbumPicker（见 components/AlbumPicker.tsx）。
   * 拿到的是相册原始文件的 file:// 路径 —— 不拷贝、不转码，所以是秒开。
   */
  async pickVideos() {
    try {
      const picked = await requestPickVideos()
      return picked.map((p) => {
        metaCache.set(p.uri, { duration: p.duration, fps: 30 })
        return p.uri
      })
    } catch (err) {
      console.warn('选择视频失败:', err)
      return []
    }
  },

  resolveUrl: (videoRef) => videoRef,

  async exists(videoRef) {
    try {
      const info = await FileSystem.getInfoAsync(videoRef)
      return info.exists
    } catch {
      return false
    }
  },

  displayName(videoRef) {
    const tail = decodeURIComponent(videoRef.split('/').pop() || videoRef)
    return tail.length > 28 ? tail.slice(0, 28) + '…' : tail
  },

  // —— 工程数据：一律进沙盒（相册旁边写不了）——
  // 注意只取文件名做 key：完整路径里含 app 容器 UUID，每次重装都会变，
  // 拿整条路径做 key 会让重装后的数据全部对不上号
  clipsKeyFor: (videoRef) => DATA_DIR + refKey(videoRef) + '.clips.json',
  // 必须以 .kkclip 结尾：core 的 openVideoPath 靠这个后缀区分「时间线」和「裸视频」，
  // 「最近打开」列表里存的正是这个 key
  timelineKeyFor: (videoRef) => DATA_DIR + refKey(videoRef) + '.kkclip',

  async loadData(key) {
    try {
      const raw = await FileSystem.readAsStringAsync(key)
      return JSON.parse(raw)
    } catch {
      return null
    }
  },
  async saveData(key, data) {
    await ensureDir()
    await FileSystem.writeAsStringAsync(key, JSON.stringify(data, null, 2))
  },
  async dataExists(key) {
    const info = await FileSystem.getInfoAsync(key)
    return info.exists
  },

  // —— 设置 / 最近 ——
  getSettings: readSettings,
  async setSettings(partial) {
    await ensureDir()
    const merged = { ...(await readSettings()), ...partial }
    await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(merged, null, 2))
  },
  async getRecent() {
    return (await readSettings()).recent_files || []
  },
  async addRecent(key) {
    const s = await readSettings()
    const next = [key, ...(s.recent_files || []).filter((p) => p !== key)].slice(0, 10)
    await this.setSettings({ recent_files: next })
  },

  // —— AI（fetch 在 RN 里可用，逻辑与桌面一致）——
  async autoTag(clips, videoTags) {
    try {
      const list = clips.map((c, i) => `${i + 1}. ${c.title || '未命名片段'}`).join('\n')
      const rule =
        videoTags.length > 0
          ? `事件类标签只能从以下里选（可多选）：${videoTags.join('、')}。人名标签不受此限制。`
          : `事件类标签请自行提出简洁词（每个≤15字）。`
      const prompt = `你是青少年足球比赛视频片段的标签助手。给每个片段打标签。
重要规则：
1. 标题里出现人名（如 宽宽、康康）时，**必须把该人名单独作为一个标签**。
2. 再补 1~2 个事件类标签。${rule}
片段列表：
${list}
只返回 JSON 数组，长度与片段数相同，元素是标签字符串数组。例如：[["宽宽","进球"],[]]
不要任何解释。`
      const raw = await deepseek(prompt, Math.min(8000, 400 + clips.length * 28))
      let cleaned = raw.trim().replace(/```(?:json)?/gi, '').trim()
      const s = cleaned.indexOf('[')
      const e = cleaned.lastIndexOf(']')
      if (s >= 0 && e > s) cleaned = cleaned.slice(s, e + 1)
      const parsed = JSON.parse(cleaned.replace(/,\s*]/g, ']'))
      if (!Array.isArray(parsed)) throw new Error('AI 返回不是数组')
      return {
        ok: true,
        tags: clips.map((_, i) => {
          const item = (parsed as unknown[])[i]
          const arr = Array.isArray(item) ? item : []
          return arr.map((x) => String(x).trim().slice(0, 15)).filter(Boolean)
        })
      }
    } catch (err) {
      const e2 = err as Error & { code?: string }
      return { ok: false, code: e2.code, error: e2.message }
    }
  },

  async report(clips) {
    try {
      const lines = clips
        .map((c, i) => {
          const tag = (c.tags || []).length ? `[${(c.tags || []).join(',')}]` : ''
          return `${i + 1}. ${c.title || '未命名'} ${tag}（${(c.out - c.in).toFixed(1)}s）`
        })
        .join('\n')
      const prompt = `你是资深青少年足球教练兼比赛分析师。根据下面标记的片段写一份比赛复盘报告。
按此结构（中文、分点、具体可执行）：
## 一、总体概述
## 二、我方特点（按球员归纳）
## 三、对手特点
## 四、双方对比
## 五、战术调整（如何赢下对手）
## 六、针对性训练
片段列表：
${lines}`
      return { ok: true, report: await deepseek(prompt, 2200) }
    } catch (err) {
      const e2 = err as Error & { code?: string }
      return { ok: false, code: e2.code, error: e2.message }
    }
  },

  /**
   * —— 导出 / 合并：走本地原生模块 ClipperMedia（AVFoundation）——
   * iOS 没有「选个文件夹」的概念，一律写回系统相册的同名相册里，
   * 所以 outDir 在这里当相册名用。
   */
  async exportClips(opts) {
    const exports: Record<string, string> = { ...(opts.priorExports || {}) }
    // iOS 写的是相册，没法像桌面那样去目标目录里看文件在不在，
    // 所以用「导出记录」判重：记录随时间线一起保存，跨启动仍然有效
    const wanted = opts.clips.map((c, i) => ({
      id: exportIdOf(c),
      sourcePath: c.videoRef,
      start: c.in,
      end: c.out,
      title: c.title || `片段${i + 1}`,
      segments: (c.segments || []).map((g) => ({
        sourcePath: g.videoRef,
        start: g.in,
        end: g.out
      }))
    }))
    const todo = opts.skipExisting ? wanted.filter((c) => !exports[c.id]) : wanted
    const skipped = wanted.length - todo.length
    if (todo.length === 0) return { exported: 0, skipped, failed: 0, exports }
    try {
      const res = await ClipperMedia.exportClips({
        albumName: ALBUM_NAME,
        burnSubtitle: true,
        watermark: opts.watermark || '',
        clips: todo
      })
      const now = new Date().toISOString()
      res.ids.forEach((id) => {
        exports[id] = now
      })
      return { exported: res.count, skipped, failed: 0, exports }
    } catch (err) {
      console.warn('导出失败:', err)
      return { exported: 0, skipped, failed: todo.length, exports }
    }
  },

  async mergeClips(opts) {
    try {
      await ClipperMedia.mergeClips({
        albumName: ALBUM_NAME,
        name: opts.name,
        burnSubtitle: opts.burnSubtitle !== false,
        watermark: opts.watermark || '',
        clips: opts.clips.map((c, i) => ({
          id: String(i),
          sourcePath: c.videoRef,
          start: c.in,
          end: c.out,
          title: c.title || '',
          segments: (c.segments || []).map((g) => ({
            sourcePath: g.videoRef,
            start: g.in,
            end: g.out
          }))
        }))
      })
      return { ok: true, outPath: `相册 · ${ALBUM_NAME}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  onExportProgress(cb) {
    const sub = onNativeProgress((e) => {
      const p: ExportProgress = {
        index: e.index,
        total: e.total,
        name: e.name,
        status: e.progress >= 1 ? 'done' : 'running'
      }
      cb(p)
    })
    return () => sub.remove()
  }
}

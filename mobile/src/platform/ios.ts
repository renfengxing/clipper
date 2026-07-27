import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import type { Platform, Settings } from '@core/ports'

/**
 * 选片时缓存元数据：ImagePicker 直接给了 uri 和时长，
 * 不必再走 MediaLibrary（那需要另一套权限，且相册资源 id 不能直接喂播放器）。
 */
const metaCache = new Map<string, { duration: number; fps: number }>()

/**
 * iOS 平台实现。
 * videoRef = 相册资源标识（PHAsset localIdentifier 或 file:// URI）。
 * 关键差异：相册视频旁边写不了 sidecar，所以工程数据一律存 app 沙盒，
 * 以 videoRef 的哈希做文件名 —— 这正是 Platform 端口把 key 抽象出来的原因。
 */

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

  async pickVideos() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) return []
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsMultipleSelection: true,
        quality: 1
      })
      if (res.canceled) return []
      return res.assets.map((a) => {
        // uri 是 app 沙盒里的 file://，可直接喂 expo-av，也能当稳定 key
        metaCache.set(a.uri, { duration: (a.duration ?? 0) / 1000, fps: 30 })
        return a.uri
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
  clipsKeyFor: (videoRef) => DATA_DIR + safeName(videoRef) + '.clips.json',
  timelineKeyFor: (videoRef) => DATA_DIR + safeName(videoRef) + '.kkclip.json',

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

  // —— 导出：iOS 用 AVFoundation（后续接原生模块），先留占位 ——
  async exportClips() {
    throw new Error('iOS 导出尚未接入（计划用 AVAssetExportSession）')
  },
  async mergeClips() {
    throw new Error('iOS 合并尚未接入（计划用 AVMutableComposition）')
  },
  onExportProgress() {
    return () => {}
  }
}

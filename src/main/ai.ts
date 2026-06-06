import type { Settings } from './settings'

/** 规格 九：标题整理 Prompt */
function buildPrompt(voiceText: string, settings: Settings): string {
  const players = settings.default_player_names.join('/')
  return `你是青少年足球比赛视频片段的标题整理助手。
用户会用口语描述刚刚标记的片段，请整理成简洁标题。

规则：
- 优先包含：球员名（${players}）+ 动作 + 结果
- 控制在 25 字以内
- 不加引号、句号、表情
- 失误也直说，不美化
- 如果用户原话已经很规范，直接返回原话
- 标题模板参考：${settings.title_template}

用户原话：「${voiceText}」
返回：仅一个标题字符串，不加任何解释或前后缀。`
}

/**
 * 用 DeepSeek 整理标题（OpenAI 兼容接口，便宜）。在主进程调用，Key 不暴露给渲染层。
 */
export async function cleanupTitle(voiceText: string, settings: Settings): Promise<string> {
  const key = settings.deepseek_api_key?.trim()
  if (!key) {
    const e = new Error('未设置 DeepSeek API Key') as Error & { code: string }
    e.code = 'NO_KEY'
    throw e
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 64,
      temperature: 0.3,
      messages: [{ role: 'user', content: buildPrompt(voiceText, settings) }]
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return (data.choices?.[0]?.message?.content || '').trim()
}

async function deepseek(prompt: string, settings: Settings, maxTokens: number): Promise<string> {
  const key = settings.deepseek_api_key?.trim()
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
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return (data.choices?.[0]?.message?.content || '').trim()
}

/**
 * AI 自动给片段打标签（#50）。
 * 有 videoTags 时只从中多选；为空时由模型提出简洁新标签（≤15字）。
 * 返回与输入等长的标签数组。
 */
export async function autoTagClips(
  clips: Array<{ title: string }>,
  videoTags: string[],
  settings: Settings
): Promise<string[][]> {
  const list = clips.map((c, i) => `${i + 1}. ${c.title || '未命名片段'}`).join('\n')
  const tagRule =
    videoTags.length > 0
      ? `事件类标签只能从以下里选（可多选）：${videoTags.join('、')}。但人名标签不受此限制，按下面规则照打。`
      : `事件类标签请自行提出简洁词（每个≤15字，如：进球、过人、失误、防守、扑救），同类复用同一标签。`
  const prompt = `你是青少年足球比赛视频片段的标签助手。下面按编号列出片段标题，给每个片段打标签。

重要规则：
1. 标题里几乎都有一个"主语/人名"（如 宽宽、康康、浩浩、王悦恒 等中文名）。**只要标题中出现人名，必须把该人名单独作为一个标签**（人名标签优先于事件标签）。
2. 再补 1~2 个事件类标签。${tagRule}
3. 一个片段可有多个标签：人名 + 事件。例如标题「宽宽过人没体力」→ ["宽宽","过人"]。

片段列表：
${list}

只返回一个 JSON 数组，长度与片段数相同，每个元素是该片段的标签字符串数组（无合适标签则空数组）。例如：[["宽宽","进球"],["康康","失误"],[]]
不要任何解释或多余文字。`

  const raw = await deepseek(prompt, settings, 512)
  // 容错：截取第一个 [ 到最后一个 ]
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('AI 返回格式无法解析')
  }
  if (!Array.isArray(parsed)) throw new Error('AI 返回不是数组')
  return clips.map((_, i) => {
    const item = (parsed as unknown[])[i]
    if (!Array.isArray(item)) return []
    return item.map((x) => String(x).trim().slice(0, 15)).filter(Boolean)
  })
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * AI 分析报告（#59）：基于片段标题/时长/标签生成。领域不限（足球/教学/会议…由标题推断）。
 */
export async function analyzeReport(
  clips: Array<{ title: string; in: number; out: number; tags?: string[] }>,
  settings: Settings
): Promise<string> {
  const lines = clips
    .map((c, i) => {
      const tag = (c.tags || []).length ? `[${(c.tags || []).join(',')}]` : ''
      return `${i + 1}. ${c.title || '未命名'} ${tag}（${mmss(c.in)}-${mmss(c.out)}，${(c.out - c.in).toFixed(1)}s）`
    })
    .join('\n')
  const prompt = `你是一名视频内容分析助手。下面是用户从一段视频里标记的若干片段（含标题、时长、标签）。
请根据这些信息写一份简洁的分析报告。注意：领域不一定是足球，请从标题/标签语义自行判断（可能是球类比赛、教学、会议、Vlog 等）。

报告包含：
1. 总体概述（共多少片段、总时长、大致主题）
2. 按标签或主题归纳分类
3. 值得关注的亮点或问题
4. 简短建议

片段列表：
${lines}

用中文，分点清晰，不要客套话。`

  return deepseek(prompt, settings, 1200)
}

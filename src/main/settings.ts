import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'

export interface Keybindings {
  speedUp: string
  speedDown: string
  reset: string
  mark: string
  playPause: string
}

/** 应用设置（规格 7.2） */
export interface Settings {
  deepseek_api_key: string
  title_template: string
  default_player_names: string[]
  ffmpeg_path: string // 'bundled' 或绝对路径
  export_default_dir: string // 'same_as_source' 或绝对路径
  keybindings: Keybindings
  recent_files: string[] // 最近打开（最多 10，#41）
  default_tags: string[] // 系统标签库（#54，每个 ≤15 字）
  last_timeline: string // 上次打开的时间线（.kkclip 路径），用于重启/重载后恢复（#109）
}

const DEFAULTS: Settings = {
  deepseek_api_key: '',
  title_template: '球员（宽宽/康康/浩浩/王悦恒）+ 动作 + 结果，25字内，失误直说',
  default_player_names: ['宽宽', '康康', '浩浩', '王悦恒'],
  ffmpeg_path: 'bundled',
  export_default_dir: 'same_as_source',
  keybindings: {
    speedUp: 'KeyL',
    speedDown: 'KeyJ',
    reset: 'KeyK',
    mark: 'KeyN',
    playPause: 'Space'
  },
  recent_files: [],
  default_tags: ['进球', '助攻', '过人', '射门', '防守', '失误', '扑救', '任意球'],
  last_timeline: ''
}

/** 加入最近打开列表（去重、最近在前、最多 10，#41） */
export function addRecentFile(path: string): string[] {
  const cur = readSettings().recent_files.filter((p) => p !== path)
  const next = [path, ...cur].slice(0, 10)
  writeSettings({ recent_files: next })
  return next
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function readSettings(): Settings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULTS,
      ...parsed,
      keybindings: { ...DEFAULTS.keybindings, ...(parsed.keybindings || {}) }
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSettings(partial: Partial<Settings>): Settings {
  const merged = { ...readSettings(), ...partial }
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = settingsPath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8')
  renameSync(tmp, p) // 原子替换
  return merged
}

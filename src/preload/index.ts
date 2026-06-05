import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface Keybindings {
  speedUp: string
  speedDown: string
  reset: string
  mark: string
  playPause: string
}

export interface Settings {
  deepseek_api_key: string
  title_template: string
  default_player_names: string[]
  ffmpeg_path: string
  export_default_dir: string
  keybindings: Keybindings
  recent_files?: string[]
  default_tags: string[]
}


export interface ExportProgress {
  index: number
  total: number
  name: string
  status: 'running' | 'done' | 'skipped' | 'failed'
  error?: string
}

export interface ExportClipInput {
  sourcePath: string
  in: number
  out: number
  title: string
  tags?: string[]
}

export interface ExportOptions {
  outDir: string
  clips: ExportClipInput[]
  skipExisting: boolean
  priorExports?: Record<string, string>
  watermark?: string
}

export interface ExportResult {
  exported: number
  skipped: number
  failed: number
  exports: Record<string, string>
}

const api = {
  /** 工具栏「打开」按钮调用：弹出系统文件选择框 */
  openVideoDialog: (): Promise<void> => ipcRenderer.invoke('video:open-dialog'),

  /** 拖入文件时，取其在磁盘上的绝对路径 */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** 监听主进程（菜单或对话框）选中的视频路径。返回取消订阅函数。 */
  onVideoOpened: (callback: (filePath: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, filePath: string): void => callback(filePath)
    ipcRenderer.on('video:opened', listener)
    return () => ipcRenderer.removeListener('video:opened', listener)
  },

  /** 菜单「设置…」(Cmd+,) 触发 */
  onOpenSettings: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('open-settings', listener)
    return () => ipcRenderer.removeListener('open-settings', listener)
  },

  /** 菜单「关闭当前视频」触发 */
  onVideoClose: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('video:close', listener)
    return () => ipcRenderer.removeListener('video:close', listener)
  },

  /** 全屏 */
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('window:toggle-fullscreen'),
  onFullscreenChanged: (callback: (full: boolean) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, full: boolean): void => callback(full)
    ipcRenderer.on('fullscreen-changed', listener)
    return () => ipcRenderer.removeListener('fullscreen-changed', listener)
  },

  // —— 设置 ——
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (partial: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', partial),

  // —— 最近打开（#41）——
  getRecentFiles: (): Promise<string[]> => ipcRenderer.invoke('recent:get'),
  addRecentFile: (filePath: string): Promise<string[]> =>
    ipcRenderer.invoke('recent:add', filePath),
  openVideoPath: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('video:open-path', filePath),

  // —— 工程文件 / sidecar（任意 JSON）——
  loadProject: (path: string): Promise<unknown> => ipcRenderer.invoke('project:load', path),
  saveProject: (path: string, data: unknown): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('project:save', path, data),
  fileExists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', path),
  chooseVideos: (): Promise<string[]> => ipcRenderer.invoke('video:choose'),

  // —— ffmpeg / 导出 ——
  ffmpegHealth: (): Promise<{ ok: boolean; version: string; path: string }> =>
    ipcRenderer.invoke('ffmpeg:health'),
  probeVideo: (path: string): Promise<{ duration: number; fps: number }> =>
    ipcRenderer.invoke('video:probe', path),
  chooseExportDir: (): Promise<string | null> => ipcRenderer.invoke('export:choose-dir'),
  openFolder: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path),
  exportClips: (opts: ExportOptions): Promise<ExportResult> =>
    ipcRenderer.invoke('export:run', opts),
  mergeClips: (opts: {
    outDir: string
    name: string
    clips: ExportClipInput[]
    burnDanmaku?: boolean
    watermark?: string
  }): Promise<{ ok: boolean; outPath?: string; error?: string }> =>
    ipcRenderer.invoke('export:merge', opts),
  onExportProgress: (callback: (p: ExportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ExportProgress): void => callback(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },

  // —— AI ——
  cleanupTitle: (
    voiceText: string
  ): Promise<{ ok: boolean; title?: string; code?: string; error?: string }> =>
    ipcRenderer.invoke('ai:cleanup-title', voiceText),
  autoTag: (
    clips: Array<{ title: string }>,
    videoTags: string[]
  ): Promise<{ ok: boolean; tags?: string[][]; code?: string; error?: string }> =>
    ipcRenderer.invoke('ai:auto-tag', clips, videoTags),
  report: (
    clips: Array<{ title: string; in: number; out: number; tags?: string[] }>
  ): Promise<{ ok: boolean; report?: string; code?: string; error?: string }> =>
    ipcRenderer.invoke('ai:report', clips),
  saveReport: (
    content: string,
    defaultName: string
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('report:save', content, defaultName)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

import { app, shell, BrowserWindow, Menu, dialog, ipcMain, protocol } from 'electron'
import { join, extname, basename } from 'path'
import { createReadStream, statSync, existsSync, writeFileSync } from 'fs'
import { Readable } from 'stream'
import { readSettings, writeSettings, addRecentFile, type Settings } from './settings'
import { loadProject, saveJson, fileExists } from './project'
import { ffmpegHealth, probeVideo, exportClips, mergeClips, type ExportOptions, type MergeOptions } from './ffmpeg'
import { cleanupTitle, autoTagClips, analyzeReport } from './ai'

const isMac = process.platform === 'darwin'

// 让 userData 落在 ~/Library/Application Support/FootballClipper（规格 7.2）
app.setName('FootballClipper')

// 注册自定义协议，用于在渲染进程安全地加载本地视频文件（支持 Range 请求 → 可拖动 seek）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true }
  }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '宽宽爸视频切片',
    backgroundColor: '#0f172a',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 全屏状态变化通知渲染层（用于隐藏顶/底/右栏）
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('fullscreen-changed', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('fullscreen-changed', false))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite: dev 走 dev server，prod 走打包后的 html
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 弹出文件选择框，选中后把路径发给渲染进程
async function openVideoDialog(): Promise<void> {
  if (!mainWindow) return
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开视频',
    properties: ['openFile'],
    filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'MP4', 'MOV'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return
  mainWindow.webContents.send('video:opened', result.filePaths[0])
}

// 打开指定路径的视频（菜单/最近列表用）
function openVideoFile(filePath: string): void {
  if (!mainWindow || !existsSync(filePath)) return
  mainWindow.webContents.send('video:opened', filePath)
}

// 「打开最近」子菜单项
function recentMenuItems(): Electron.MenuItemConstructorOptions[] {
  const recent = readSettings().recent_files.filter((p) => existsSync(p))
  if (recent.length === 0) {
    return [{ label: '（暂无）', enabled: false }]
  }
  return recent.map((p) => ({ label: basename(p), click: () => openVideoFile(p) }))
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: '宽宽爸视频切片',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: '设置…',
                accelerator: 'CmdOrCtrl+,',
                click: () => mainWindow?.webContents.send('open-settings')
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开视频…',
          accelerator: 'CmdOrCtrl+O',
          click: () => openVideoDialog()
        },
        {
          label: '打开最近',
          submenu: recentMenuItems()
        },
        { type: 'separator' },
        {
          label: '关闭当前视频',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => mainWindow?.webContents.send('video:close')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime'
}

// media:// → 手动按 Range 流式读取本地文件，保证时长/首帧/拖动 seek 都正常
function handleMedia(request: Request): Response {
  // request.url 形如 media:///Users/xxx/视频.mp4（standard scheme，host 为空）
  const filePath = decodeURIComponent(new URL(request.url).pathname)
  const stat = statSync(filePath)
  const total = stat.size
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'

  const range = request.headers.get('Range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1
    if (isNaN(start) || start < 0) start = 0
    if (isNaN(end) || end >= total) end = total - 1
    if (start > end) start = 0
    const stream = createReadStream(filePath, { start, end })
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes'
      }
    })
  }

  const stream = createReadStream(filePath)
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes'
    }
  })
}

app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    try {
      return handleMedia(request)
    } catch (err) {
      console.error('[media] 读取失败:', err)
      return new Response('Not Found', { status: 404 })
    }
  })

  // 渲染进程主动请求打开视频（工具栏「打开」按钮）
  ipcMain.handle('video:open-dialog', () => openVideoDialog())

  // 切换窗口全屏（macOS 原生全屏，Esc 不会退出）
  ipcMain.handle('window:toggle-fullscreen', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })

  // —— 设置 ——
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, partial: Partial<Settings>) => writeSettings(partial))

  // —— 最近打开（#41）——
  ipcMain.handle('recent:get', () => readSettings().recent_files.filter((p) => existsSync(p)))
  ipcMain.handle('recent:add', (_e, filePath: string) => {
    const list = addRecentFile(filePath)
    buildMenu() // 重建菜单以刷新「打开最近」
    return list.filter((p) => existsSync(p))
  })
  ipcMain.handle('video:open-path', (_e, filePath: string) => openVideoFile(filePath))

  // —— 工程文件 / sidecar（任意 JSON）——
  ipcMain.handle('project:load', (_e, path: string) => loadProject(path))
  ipcMain.handle('project:save', (_e, path: string, data: unknown) => {
    saveJson(path, data)
    return { ok: true }
  })
  ipcMain.handle('fs:exists', (_e, path: string) => fileExists(path))

  // 选择视频文件（可多选，用于"添加视频"）
  ipcMain.handle('video:choose', async () => {
    if (!mainWindow) return []
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '添加视频',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'MP4', 'MOV'] }]
    })
    return r.canceled ? [] : r.filePaths
  })

  // —— ffmpeg ——
  ipcMain.handle('ffmpeg:health', () => ffmpegHealth(readSettings()))
  ipcMain.handle('video:probe', (_e, path: string) => probeVideo(path, readSettings()))
  ipcMain.handle('shell:open-path', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('export:choose-dir', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择导出目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle('export:run', (e, opts: ExportOptions) =>
    exportClips(readSettings(), opts, (p) => e.sender.send('export:progress', p))
  )
  ipcMain.handle('export:merge', async (e, opts: MergeOptions) => {
    try {
      const r = await mergeClips(readSettings(), opts, (p) => e.sender.send('export:progress', p))
      return { ok: true, outPath: r.outPath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // —— AI 标题整理 ——
  ipcMain.handle('ai:cleanup-title', async (_e, voiceText: string) => {
    try {
      const title = await cleanupTitle(voiceText, readSettings())
      return { ok: true, title }
    } catch (err) {
      const e2 = err as Error & { code?: string }
      return { ok: false, code: e2.code, error: e2.message }
    }
  })

  // —— AI 自动打标签（#50）——
  ipcMain.handle(
    'ai:auto-tag',
    async (_e, clips: Array<{ title: string }>, videoTags: string[]) => {
      try {
        const tags = await autoTagClips(clips, videoTags, readSettings())
        return { ok: true, tags }
      } catch (err) {
        const e2 = err as Error & { code?: string }
        return { ok: false, code: e2.code, error: e2.message }
      }
    }
  )

  // —— 保存报告为 Markdown（#70）——
  ipcMain.handle('report:save', async (_e, content: string, defaultName: string) => {
    if (!mainWindow) return { ok: false }
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '保存分析报告',
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false }
    try {
      writeFileSync(r.filePath, content, 'utf-8')
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // —— AI 分析报告（#59）——
  ipcMain.handle(
    'ai:report',
    async (_e, clips: Array<{ title: string; in: number; out: number; tags?: string[] }>) => {
      try {
        const report = await analyzeReport(clips, readSettings())
        return { ok: true, report }
      } catch (err) {
        const e2 = err as Error & { code?: string }
        return { ok: false, code: e2.code, error: e2.message }
      }
    }
  )

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

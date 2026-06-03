import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { Toolbar } from './components/Toolbar'
import { VideoPlayer } from './components/VideoPlayer'
import { Timeline } from './components/Timeline'
import { ClipList } from './components/ClipList'
import { StatusBar } from './components/StatusBar'
import { TitleModal } from './components/TitleModal'
import { SettingsModal } from './components/SettingsModal'
import { ExportModal } from './components/ExportModal'
import { MergeModal } from './components/MergeModal'
import { ReportModal } from './components/ReportModal'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { useAutoSave } from './hooks/useAutoSave'

const VIDEO_EXT = /\.(mp4|m4v|mov)$/i
const MIN_W = 260
const MAX_W = 640

function App(): JSX.Element {
  const openVideoPath = useStore((s) => s.openVideoPath)
  const closeVideo = useStore((s) => s.closeVideo)
  const setTitleTemplate = useStore((s) => s.setTitleTemplate)
  const setKeybindings = useStore((s) => s.setKeybindings)
  const setDefaultTags = useStore((s) => s.setDefaultTags)
  const openSettings = useStore((s) => s.openSettings)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const setIsFullscreen = useStore((s) => s.setIsFullscreen)

  const [dragging, setDragging] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [listWidth, setListWidth] = useState(340)
  const resizingRef = useRef(false)

  useGlobalShortcuts()
  useAutoSave()

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setTitleTemplate(s.title_template || '')
      if (s.keybindings) setKeybindings(s.keybindings)
      if (s.default_tags) setDefaultTags(s.default_tags)
    })
  }, [setTitleTemplate, setKeybindings, setDefaultTags])

  useEffect(() => {
    return window.api.onVideoOpened((filePath) => openVideoPath(filePath))
  }, [openVideoPath])

  useEffect(() => window.api.onOpenSettings(() => openSettings()), [openSettings])
  useEffect(() => window.api.onVideoClose(() => closeVideo()), [closeVideo])

  // 全屏：窗口原生全屏（Esc 不退出，#33），隐藏顶/底/右栏只留左侧列（#18）
  useEffect(() => window.api.onFullscreenChanged((full) => setIsFullscreen(full)), [setIsFullscreen])
  const toggleFullscreen = (): void => void window.api.toggleFullscreen()

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const file = Array.from(e.dataTransfer.files).find((f) => VIDEO_EXT.test(f.name))
    if (!file) return
    const path = window.api.getPathForFile(file)
    if (path) openVideoPath(path)
  }

  // 拖动分隔条调列表宽度
  const onResizeDown = (e: React.PointerEvent): void => {
    resizingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: React.PointerEvent): void => {
    if (!resizingRef.current) return
    const w = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - e.clientX))
    setListWidth(w)
  }
  const onResizeUp = (e: React.PointerEvent): void => {
    resizingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      className="relative flex flex-col h-full bg-slate-950 text-slate-100"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {!isFullscreen && <Toolbar />}
      <div className="flex flex-1 min-h-0">
        <main className="relative flex-1 flex flex-col min-w-0 bg-slate-950">
          <VideoPlayer isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />
          <Timeline />
          {/* 命名框放在左侧列内：全屏只剩此列时也能弹出（#26） */}
          <TitleModal />
        </main>

        {!isFullscreen &&
          (listCollapsed ? (
            <button
              className="w-6 border-l border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-400 flex items-center justify-center"
              title="展开片段列表"
              onClick={() => setListCollapsed(false)}
            >
              ◀
            </button>
          ) : (
            <>
              <div
                className="w-1.5 cursor-col-resize bg-slate-800 hover:bg-cyan-500 shrink-0"
                onPointerDown={onResizeDown}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
              />
              <ClipList width={listWidth} onCollapse={() => setListCollapsed(true)} />
            </>
          ))}
      </div>
      {!isFullscreen && <StatusBar />}

      <SettingsModal />
      <ExportModal />
      <MergeModal />
      <ReportModal />

      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 border-4 border-dashed border-cyan-400 pointer-events-none">
          <div className="text-center">
            <div className="text-5xl mb-2">📥</div>
            <div className="text-lg text-cyan-300">松手以打开视频</div>
            <div className="text-xs text-slate-400 mt-1">支持 mp4 / mov / m4v</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

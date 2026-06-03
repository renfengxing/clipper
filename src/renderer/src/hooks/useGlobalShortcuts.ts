import { useEffect } from 'react'
import { useStore } from '../store/useStore'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

/**
 * 全局快捷键。传输相关键（快进/快退/重置/标记/暂停）可在设置里改（#23），
 * 其余（单帧、跳秒、保存、删除、取消、导出）固定。
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return
      const s = useStore.getState()
      if (!s.video) return
      const kb = s.keybindings
      const code = e.code

      // —— 可配置键 ——
      if (code === kb.playPause) {
        e.preventDefault()
        return s.togglePlay()
      }
      if (code === kb.speedUp) {
        e.preventDefault()
        return s.speedUp()
      }
      if (code === kb.speedDown) {
        e.preventDefault()
        return s.speedDown()
      }
      if (code === kb.reset) {
        e.preventDefault()
        return s.resetSpeed()
      }
      if (code === kb.mark) {
        e.preventDefault()
        if (s.markIn == null) s.setMarkIn()
        else if (s.markOut == null) s.setMarkOut()
        return
      }

      // —— 固定键 ——
      switch (code) {
        case 'ArrowLeft':
          e.preventDefault()
          e.shiftKey ? s.jump(-5) : s.stepFrame(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          e.shiftKey ? s.jump(5) : s.stepFrame(1)
          break
        case 'Enter':
        case 'NumpadEnter':
          e.preventDefault()
          s.openTitleModal()
          break
        case 'Escape':
          e.preventDefault()
          // 标记中：取消标记（全屏不退）；非标记：可退全屏；否则取消选中
          if (s.markIn != null || s.markOut != null) s.clearMarks()
          else if (s.isFullscreen) void window.api.toggleFullscreen()
          else if (s.selectedClipId) s.deselectClip()
          break
        case 'Delete':
        case 'Backspace':
          if (s.selectedClipId) {
            e.preventDefault()
            s.deleteClip(s.selectedClipId)
          }
          break
        case 'KeyE':
          if ((e.metaKey || e.ctrlKey) && s.clips.length > 0) {
            e.preventDefault()
            s.openExport()
          }
          break
        case 'KeyM':
          e.preventDefault()
          void window.api.toggleFullscreen()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

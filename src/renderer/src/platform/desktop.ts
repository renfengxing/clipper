import type { Platform, Settings } from '@core/ports'
import { toMediaUrl, basename, dirOf, stripExt } from '../utils/media'

/**
 * 桌面（Electron）平台实现：把端口转成现有的 window.api 调用。
 * videoRef = 文件绝对路径；工程数据仍写在视频旁边的 sidecar。
 */
export const desktopPlatform: Platform = {
  probeVideo: (ref) => window.api.probeVideo(ref),
  pickVideos: () => window.api.chooseVideos(),
  resolveUrl: (ref) => toMediaUrl(ref),
  exists: (ref) => window.api.fileExists(ref),
  displayName: (ref) => basename(ref),

  // 桌面：片段随视频存 sidecar；时间线按视频名建在同目录
  clipsKeyFor: (ref) => ref + '.kkfb.json',
  timelineKeyFor: (ref) => dirOf(ref) + '/' + stripExt(basename(ref)) + '.kkclip',
  loadData: (key) => window.api.loadProject(key),
  saveData: async (key, data) => {
    await window.api.saveProject(key, data)
  },
  dataExists: (key) => window.api.fileExists(key),

  getSettings: () => window.api.getSettings() as unknown as Promise<Settings>,
  setSettings: async (partial) => {
    await window.api.setSettings(partial as never)
  },
  getRecent: () => window.api.getRecentFiles(),
  addRecent: async (key) => {
    await window.api.addRecentFile(key)
  },

  autoTag: (clips, videoTags) => window.api.autoTag(clips, videoTags),
  report: (clips) => window.api.report(clips),

  exportClips: (opts) =>
    window.api.exportClips({
      outDir: opts.outDir,
      skipExisting: opts.skipExisting,
      priorExports: opts.priorExports,
      watermark: opts.watermark,
      clips: opts.clips.map((c) => ({
        sourcePath: c.videoRef,
        in: c.in,
        out: c.out,
        title: c.title,
        tags: c.tags
      }))
    }),
  mergeClips: (opts) =>
    window.api.mergeClips({
      outDir: opts.outDir,
      name: opts.name,
      burnDanmaku: opts.burnSubtitle,
      watermark: opts.watermark,
      clips: opts.clips.map((c) => ({
        sourcePath: c.videoRef,
        in: c.in,
        out: c.out,
        title: c.title,
        tags: c.tags
      }))
    }),
  onExportProgress: (cb) => window.api.onExportProgress(cb),

  openFolder: (path) => {
    void window.api.openFolder(path)
  },
  toggleFullscreen: () => {
    void window.api.toggleFullscreen()
  },
  saveReport: (content, defaultName) => window.api.saveReport(content, defaultName)
}

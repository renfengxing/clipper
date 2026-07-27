export { basename, dirOf, stripExt } from '@core/utils/path'

/** 桌面专用：本地路径 → media:// 协议地址 */
export function toMediaUrl(path: string): string {
  return 'media://local' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

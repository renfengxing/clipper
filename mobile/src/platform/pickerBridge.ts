/**
 * 把「core 里调 platform().pickVideos() 拿路径」和「React 里弹一个选择器 UI」接起来。
 * core 是纯逻辑层（不认识组件），所以用一个模块级的 opener 做桥：
 * AlbumPicker 挂载时注册自己，pickVideos() 调用时返回一个等它 resolve 的 Promise。
 */

export interface PickedVideo {
  uri: string // 可直接喂播放器的 file:// 路径
  duration: number // 秒
}

type Opener = (resolve: (v: PickedVideo[]) => void) => void

let opener: Opener | null = null

export function registerPicker(fn: Opener | null): void {
  opener = fn
}

export function requestPickVideos(): Promise<PickedVideo[]> {
  const fn = opener
  if (!fn) return Promise.resolve([])
  return new Promise((res) => fn(res))
}

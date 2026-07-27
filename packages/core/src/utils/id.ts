/**
 * 跨平台 uuid：浏览器/Electron 有 crypto.randomUUID，
 * React Native 的 Hermes 没有 —— 退回 Math.random 版（只做本地对象 id，无需密码学强度）。
 */
export function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  const native = g.crypto?.randomUUID
  if (typeof native === 'function') return native.call(g.crypto)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

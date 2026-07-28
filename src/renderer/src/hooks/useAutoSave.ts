import { useEffect } from 'react'
import { startAutoSave } from '@core/persist/autoSave'

/** 自动保存逻辑已下沉到 packages/core（与 iOS 端共用），这里只负责挂载/卸载 */
export function useAutoSave(): void {
  useEffect(() => startAutoSave(), [])
}

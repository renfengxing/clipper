/** e.code → 友好按键标签，用于提示和设置页 */
export function keyLabel(code: string): string {
  if (!code) return '—'
  if (code === 'Space') return '空格'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Arrow')) {
    return { Left: '←', Right: '→', Up: '↑', Down: '↓' }[code.slice(5)] || code
  }
  return code
}

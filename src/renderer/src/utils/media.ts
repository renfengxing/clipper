export function toMediaUrl(path: string): string {
  return 'media://local' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(0, i) : path
}

export function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

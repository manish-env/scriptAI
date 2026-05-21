import type { H3Event } from 'h3'

export function uuid() {
  return crypto.randomUUID()
}

/** Nitro catch-all `path` is a single string (e.g. `scene_image/user/id.png`), not string[]. */
export function resolveAssetPath(event: H3Event): string {
  const raw = getRouterParam(event, 'path')
  if (Array.isArray(raw)) return raw.map(decodeURIComponent).join('/')
  if (typeof raw === 'string' && raw.length) return decodeURIComponent(raw)
  const prefix = '/api/assets/'
  const pathname = getRequestURL(event).pathname
  if (pathname.startsWith(prefix)) return decodeURIComponent(pathname.slice(prefix.length))
  return ''
}

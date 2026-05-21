import { uuid } from '../utils/helpers'

interface Env { DB: D1Database; BUCKET: R2Bucket }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const { url, base64, type, user_id, session_id } = await readBody(event)

  if ((!url && !base64) || !type || !user_id) {
    throw createError({ statusCode: 400, message: 'url or base64, type and user_id required' })
  }
  if (!['photo', 'hero', 'scene_image', 'video'].includes(type)) throw createError({ statusCode: 400, message: 'invalid type' })

  if (!env.BUCKET) {
    return { id: uuid(), key: null, assetUrl: url }
  }

  let contentType = 'image/jpeg'
  let body: ReadableStream | ArrayBuffer | Uint8Array

  if (base64) {
    const raw = base64.includes(',') ? base64.split(',')[1] : base64
    const binary = atob(raw)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    body = bytes
    contentType = 'image/jpeg'
  } else {
    const remote = await fetch(url!)
    if (!remote.ok) throw createError({ statusCode: 502, message: 'could not fetch remote asset' })
    contentType = remote.headers.get('content-type') || 'image/jpeg'
    body = remote.body as ReadableStream
  }

  const ext = contentType.includes('png') ? 'png' : contentType.includes('webm') ? 'webm' : 'jpg'
  const key = `${type}/${user_id}/${uuid()}.${ext}`

  await env.BUCKET.put(key, body as ReadableStream, { httpMetadata: { contentType } })

  const id = uuid()
  if (env.DB) await env.DB.prepare('INSERT INTO assets (id, user_id, session_id, type, r2_key) VALUES (?, ?, ?, ?, ?)').bind(id, user_id, session_id ?? null, type, key).run()

  return { id, key, assetUrl: `/api/assets/${key}` }
})

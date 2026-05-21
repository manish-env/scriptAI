import { uuid } from '../utils/helpers'

interface Env { DB: D1Database; ASSETS: R2Bucket }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const { url, type, user_id, session_id } = await readBody(event)

  if (!url || !type || !user_id) throw createError({ statusCode: 400, message: 'url, type and user_id required' })
  if (!['photo', 'scene_image', 'video'].includes(type)) throw createError({ statusCode: 400, message: 'invalid type' })

  if (!env.ASSETS) {
    return { id: uuid(), key: `${type}/${user_id}/${uuid()}.jpg`, assetUrl: url }
  }

  const remote = await fetch(url)
  if (!remote.ok) throw createError({ statusCode: 502, message: 'could not fetch remote asset' })

  const contentType = remote.headers.get('content-type') || 'image/jpeg'
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webm') ? 'webm' : 'jpg'
  const key = `${type}/${user_id}/${uuid()}.${ext}`

  await env.ASSETS.put(key, remote.body as ReadableStream, { httpMetadata: { contentType } })

  const id = uuid()
  if (env.DB) await env.DB.prepare('INSERT INTO assets (id, user_id, session_id, type, r2_key) VALUES (?, ?, ?, ?, ?)').bind(id, user_id, session_id ?? null, type, key).run()

  return { id, key, assetUrl: `/api/assets/${key}` }
})

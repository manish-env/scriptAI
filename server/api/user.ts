import { uuid } from '../utils/helpers'

interface Env { DB: D1Database }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env

  if (event.method === 'GET') {
    const id = getQuery(event).id as string
    if (!id) throw createError({ statusCode: 400, message: 'id required' })
    if (!env.DB) return null
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
    return user ?? null
  }

  if (event.method === 'POST') {
    const { id, name, niche, photo_key, hero_key } = await readBody(event)
    if (!name) throw createError({ statusCode: 400, message: 'name required' })
    const uid = id || uuid()
    if (!env.DB) return { id: uid, name, niche }
    await env.DB.prepare(`
      INSERT INTO users (id, name, niche, photo_key, hero_key, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, niche = excluded.niche,
        photo_key = COALESCE(excluded.photo_key, photo_key),
        hero_key = COALESCE(excluded.hero_key, hero_key),
        updated_at = datetime('now')
    `).bind(uid, name, niche ?? null, photo_key ?? null, hero_key ?? null).run()
    return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first()
  }
})

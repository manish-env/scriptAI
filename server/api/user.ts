import { uuid } from '../utils/helpers'

interface Env { DB: D1Database }

interface UserBody {
  id?: string
  name: string
  niche?: string | null
  photo_key?: string | null
  hero_key?: string | null
  clear_hero?: boolean
}

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env

  if (event.method === 'GET') {
    const id = getQuery(event).id as string
    if (!id) throw createError({ statusCode: 400, message: 'id required' })
    if (!env.DB) return null
    try {
      const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
      return user ?? null
    } catch {
      const user = await env.DB.prepare(
        'SELECT id, name, niche, photo_key, created_at, updated_at FROM users WHERE id = ?',
      ).bind(id).first()
      return user ?? null
    }
  }

  if (event.method === 'POST') {
    const body = await readBody(event) as UserBody
    if (!body.name?.trim()) throw createError({ statusCode: 400, message: 'name required' })
    const uid = body.id || uuid()
    if (!env.DB) return { id: uid, name: body.name, niche: body.niche ?? null }

    const name = body.name.trim()
    const niche = body.niche?.trim() || null
    const photoKey = body.photo_key ?? null
    const clearHero = !!body.clear_hero

    try {
      if (clearHero) {
        await env.DB.prepare(`
          INSERT INTO users (id, name, niche, photo_key, hero_key, updated_at)
          VALUES (?, ?, ?, ?, NULL, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            niche = excluded.niche,
            photo_key = COALESCE(excluded.photo_key, photo_key),
            hero_key = NULL,
            updated_at = datetime('now')
        `).bind(uid, name, niche, photoKey).run()
      } else if (body.hero_key) {
        await env.DB.prepare(`
          INSERT INTO users (id, name, niche, photo_key, hero_key, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            niche = excluded.niche,
            photo_key = COALESCE(excluded.photo_key, photo_key),
            hero_key = COALESCE(excluded.hero_key, hero_key),
            updated_at = datetime('now')
        `).bind(uid, name, niche, photoKey, body.hero_key).run()
      } else {
        await env.DB.prepare(`
          INSERT INTO users (id, name, niche, photo_key, hero_key, updated_at)
          VALUES (?, ?, ?, ?, NULL, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            niche = excluded.niche,
            photo_key = COALESCE(excluded.photo_key, photo_key),
            updated_at = datetime('now')
        `).bind(uid, name, niche, photoKey).run()
      }
      const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first()
      return user
    } catch {
      await env.DB.prepare(`
        INSERT INTO users (id, name, niche, photo_key, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          niche = excluded.niche,
          photo_key = COALESCE(excluded.photo_key, photo_key),
          updated_at = datetime('now')
      `).bind(uid, name, niche, photoKey).run()
      return env.DB.prepare(
        'SELECT id, name, niche, photo_key, created_at, updated_at FROM users WHERE id = ?',
      ).bind(uid).first()
    }
  }
})

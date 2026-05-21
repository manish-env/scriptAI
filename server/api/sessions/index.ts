import { uuid } from '../../utils/helpers'

interface Env { DB: D1Database }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env

  if (event.method === 'GET') {
    const user_id = getQuery(event).user_id as string
    if (!user_id) throw createError({ statusCode: 400, message: 'user_id required' })
    if (!env.DB) return []
    const { results } = await env.DB.prepare(`
      SELECT s.id, s.title, s.topic, s.created_at, s.updated_at,
        COUNT(sc.id) as scene_count,
        (SELECT sc2.image_key FROM scenes sc2 WHERE sc2.session_id = s.id ORDER BY sc2.position ASC LIMIT 1) as thumbnail_key
      FROM sessions s
      LEFT JOIN scenes sc ON sc.session_id = s.id
      WHERE s.user_id = ?
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).bind(user_id).all()
    return results
  }

  if (event.method === 'POST') {
    const { user_id } = await readBody(event)
    if (!user_id) throw createError({ statusCode: 400, message: 'user_id required' })
    const id = uuid()
    if (env.DB) await env.DB.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').bind(id, user_id).run()
    return { id, user_id }
  }
})

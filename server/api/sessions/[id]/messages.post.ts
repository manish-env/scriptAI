import { uuid } from '../../../utils/helpers'

interface Env { DB: D1Database }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const session_id = getRouterParam(event, 'id')!
  const body = await readBody(event)
  const items: { role: string; content: string }[] = body.messages ?? [body]
  if (!items.length) throw createError({ statusCode: 400, message: 'no messages' })
  if (env.DB) {
    const stmt = env.DB.prepare('INSERT OR IGNORE INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)')
    await env.DB.batch(items.map(m => stmt.bind(uuid(), session_id, m.role, m.content)))
  }
  return { ok: true, saved: items.length }
})

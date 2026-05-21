import { deleteSessionRecords } from '../../utils/sessionAssets'

interface Env { DB: D1Database; BUCKET: R2Bucket }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const id = getRouterParam(event, 'id')!

  if (event.method === 'DELETE') {
    return deleteSessionRecords(env, id)
  }

  if (event.method === 'GET') {
    if (!env.DB) return null
    const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first()
    if (!session) throw createError({ statusCode: 404 })
    const [{ results: messages }, { results: scenes }] = await Promise.all([
      env.DB.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').bind(id).all(),
      env.DB.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY position ASC').bind(id).all(),
    ])
    return { ...session, messages, scenes }
  }

  if (event.method === 'PATCH') {
    const { title, topic } = await readBody(event)
    if (env.DB) await env.DB.prepare(
      `UPDATE sessions SET title = ?, topic = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(title ?? null, topic ?? null, id).run()
    return { ok: true }
  }
})

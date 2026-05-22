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
    const body = await readBody(event)
    if (env.DB) {
      // video_key is updated independently so saving a video never overwrites title/topic
      if ('video_key' in body) {
        await env.DB.prepare(
          `UPDATE sessions SET video_key = ?, updated_at = datetime('now') WHERE id = ?`,
        ).bind(body.video_key ?? null, id).run()
      } else {
        await env.DB.prepare(
          `UPDATE sessions SET title = ?, topic = ?, updated_at = datetime('now') WHERE id = ?`,
        ).bind(body.title ?? null, body.topic ?? null, id).run()
      }
    }
    return { ok: true }
  }
})

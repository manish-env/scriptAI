import { uuid } from '../../../utils/helpers'

interface Scene { title: string; narration: string; imagePrompt: string; duration: number; mood: string }
interface Env { DB: D1Database }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const session_id = getRouterParam(event, 'id')!

  if (event.method === 'POST') {
    const { scenes }: { scenes: (Scene & { image_key?: string | null; frame_keys?: string | null })[] } = await readBody(event)
    if (!scenes?.length) throw createError({ statusCode: 400, message: 'scenes required' })
    if (env.DB) {
      // Only fetch existing IDs so rows keep a stable UUID across syncs.
      // image_key / frame_keys come from the client payload — the client holds
      // the authoritative set of generated frame URLs in memory and sends them
      // on every schedulePersistScenes call, which eliminates the race between
      // a concurrent PATCH (after image generation) and this DELETE+INSERT.
      const { results: existing } = await env.DB
        .prepare('SELECT id, position FROM scenes WHERE session_id = ? ORDER BY position ASC')
        .bind(session_id).all()

      type ExistingRow = { id: string; position: number }
      const idByPos = new Map((existing as ExistingRow[]).map(r => [r.position, r.id]))

      await env.DB.prepare('DELETE FROM scenes WHERE session_id = ?').bind(session_id).run()

      const stmt = env.DB.prepare(
        'INSERT INTO scenes (id, session_id, position, title, narration, image_prompt, duration, mood, image_key, frame_keys) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      await env.DB.batch(scenes.map((s, i) => {
        const id = idByPos.get(i) ?? uuid()
        const image_key = s.image_key ?? null
        const frame_keys = s.frame_keys ?? null
        return stmt.bind(id, session_id, i, s.title, s.narration, s.imagePrompt, Math.min(10, Math.max(2, s.duration ?? 5)), s.mood ?? null, image_key, frame_keys)
      }))

      const { results } = await env.DB
        .prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY position ASC')
        .bind(session_id).all()
      return results
    }
    return scenes
  }

  if (event.method === 'PATCH') {
    const { position, image_key, frame_keys } = await readBody(event)
    if (position === undefined || position === null) throw createError({ statusCode: 400, message: 'position required' })
    if (env.DB && frame_keys !== undefined) {
      await env.DB.prepare(
        'UPDATE scenes SET image_key = ?, frame_keys = ? WHERE session_id = ? AND position = ?',
      ).bind(image_key ?? null, frame_keys, session_id, position).run()
    }
    return { ok: true }
  }
})

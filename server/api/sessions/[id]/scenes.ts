import { uuid } from '../../../utils/helpers'

interface Scene { title: string; narration: string; imagePrompt: string; duration: number; mood: string }
interface Env { DB: D1Database }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const session_id = getRouterParam(event, 'id')!

  if (event.method === 'POST') {
    const { scenes }: { scenes: Scene[] } = await readBody(event)
    if (!scenes?.length) throw createError({ statusCode: 400, message: 'scenes required' })
    if (env.DB) {
      // Preserve existing scene IDs + image keys by position so that:
      // 1. scene.id stays stable (PATCH calls keep working after a sync)
      // 2. image_key / frame_keys are not wiped when script text is edited
      const { results: existing } = await env.DB
        .prepare('SELECT id, position, image_key, frame_keys FROM scenes WHERE session_id = ? ORDER BY position ASC')
        .bind(session_id).all()

      type ExistingRow = { id: string; position: number; image_key: string | null; frame_keys: string | null }
      const byPos = new Map((existing as ExistingRow[]).map(r => [r.position, r]))

      await env.DB.prepare('DELETE FROM scenes WHERE session_id = ?').bind(session_id).run()

      const stmt = env.DB.prepare(
        'INSERT INTO scenes (id, session_id, position, title, narration, image_prompt, duration, mood, image_key, frame_keys) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      await env.DB.batch(scenes.map((s, i) => {
        const prev = byPos.get(i)
        const id = prev?.id ?? uuid()
        const image_key = prev?.image_key ?? null
        const frame_keys = prev?.frame_keys ?? null
        return stmt.bind(id, session_id, i, s.title, s.narration, s.imagePrompt, Math.min(5, Math.max(2, s.duration ?? 5)), s.mood ?? null, image_key, frame_keys)
      }))

      const { results } = await env.DB
        .prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY position ASC')
        .bind(session_id).all()
      return results
    }
    return scenes
  }

  if (event.method === 'PATCH') {
    const { scene_id, image_key, frame_keys } = await readBody(event)
    if (!scene_id) throw createError({ statusCode: 400, message: 'scene_id required' })
    if (env.DB) {
      if (frame_keys !== undefined) {
        await env.DB.prepare(
          'UPDATE scenes SET image_key = COALESCE(?, image_key), frame_keys = ? WHERE id = ? AND session_id = ?',
        ).bind(image_key ?? null, frame_keys, scene_id, session_id).run()
      } else if (image_key) {
        await env.DB.prepare('UPDATE scenes SET image_key = ? WHERE id = ? AND session_id = ?').bind(image_key, scene_id, session_id).run()
      }
    }
    return { ok: true }
  }
})

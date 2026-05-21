import { createError } from 'h3'
import { getElevenLabsApiKey } from '../../utils/secrets'

interface Env { DB: D1Database }

export default defineEventHandler(async (event) => {
  const apiKey = getElevenLabsApiKey(event)
  const env = (event.context.cloudflare?.env ?? {}) as Env

  const body = await readBody<{ voice_id: string; user_id: string }>(event)
  if (!body?.voice_id || !body?.user_id) {
    throw createError({ statusCode: 400, message: 'voice_id and user_id required' })
  }

  // Delete from ElevenLabs (best-effort)
  await fetch(`https://api.elevenlabs.io/v1/voices/${body.voice_id}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey },
  }).catch(() => { /* ignore errors — voice may already be gone */ })

  // Clear from user row
  if (env.DB) {
    await env.DB.prepare(
      'UPDATE users SET eleven_voice_id = NULL, updated_at = datetime(\'now\') WHERE id = ?',
    ).bind(body.user_id).run()
  }

  return { ok: true }
})

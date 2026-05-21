import { createError } from 'h3'
import { getElevenLabsApiKey } from '../../utils/secrets'

interface Env { DB: D1Database }

export default defineEventHandler(async (event) => {
  const apiKey = getElevenLabsApiKey(event)
  const env = (event.context.cloudflare?.env ?? {}) as Env

  const body = await readBody<{ audio_base64: string; user_id: string; name?: string }>(event)
  if (!body?.audio_base64 || !body?.user_id) {
    throw createError({ statusCode: 400, message: 'audio_base64 and user_id are required' })
  }

  // Decode base64 audio
  const raw = body.audio_base64.includes(',') ? body.audio_base64.split(',')[1] : body.audio_base64
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  // Build multipart form for ElevenLabs
  const form = new FormData()
  form.append('name', body.name || 'My Voice')
  form.append('description', 'Cloned from user recording')
  form.append('files', new Blob([bytes], { type: 'audio/webm' }), 'sample.webm')

  const res = await $fetch<{ voice_id: string }>('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  }).catch((e: unknown) => {
    const err = e as { data?: { detail?: { message?: string } | string }; statusCode?: number }
    const detail = typeof err.data?.detail === 'string'
      ? err.data.detail
      : err.data?.detail?.message || 'Voice clone failed'
    throw createError({ statusCode: err.statusCode || 502, message: detail })
  })

  if (!res?.voice_id) throw createError({ statusCode: 502, message: 'ElevenLabs returned no voice_id' })

  // Persist voice_id to user row
  if (env.DB) {
    await env.DB.prepare(
      'UPDATE users SET eleven_voice_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).bind(res.voice_id, body.user_id).run()
  }

  return { voice_id: res.voice_id }
})

import { createError } from 'h3'
import { uuid } from '../../utils/helpers'
import { getElevenLabsApiKey } from '../../utils/secrets'

interface Env { BUCKET: R2Bucket }

export default defineEventHandler(async (event) => {
  const apiKey = getElevenLabsApiKey(event)
  const env = (event.context.cloudflare?.env ?? {}) as Env

  const body = await readBody<{ text: string; voice_id: string; user_id: string }>(event)
  if (!body?.text?.trim() || !body?.voice_id || !body?.user_id) {
    throw createError({ statusCode: 400, message: 'text, voice_id and user_id are required' })
  }

  const audioRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${body.voice_id}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: body.text.trim(),
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
    }),
  })

  if (!audioRes.ok) {
    const detail = await audioRes.text().catch(() => 'ElevenLabs TTS failed')
    throw createError({ statusCode: audioRes.status, message: detail })
  }

  const audioBytes = await audioRes.arrayBuffer()

  // Upload MP3 to R2 and return a stable asset URL
  if (env.BUCKET) {
    const key = `voice/${body.user_id}/${uuid()}.mp3`
    await env.BUCKET.put(key, audioBytes, { httpMetadata: { contentType: 'audio/mpeg' } })
    return { audioUrl: `/api/assets/${key}` }
  }

  // Fallback: return as base64 data URL (no R2 in dev)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(audioBytes)))
  return { audioUrl: `data:audio/mpeg;base64,${b64}` }
})

import { createError } from 'h3'
import { getReplicateApiKey } from '../utils/secrets'

const TTS_MODEL = 'minimax/speech-02-turbo'

export default defineEventHandler(async (event) => {
  const apiKey = getReplicateApiKey(event)
  const body = await readBody<{ text: string; voice_id?: string; speed?: number }>(event)

  if (!body?.text?.trim()) {
    throw createError({ statusCode: 400, message: 'text is required' })
  }

  try {
    return await $fetch<unknown>(`https://api.replicate.com/v1/models/${TTS_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        input: {
          text: body.text.trim(),
          voice_id: body.voice_id ?? 'Deep_Voice_Man',
          speed: body.speed ?? 1,
          emotion: 'neutral',
          english_normalization: true,
        },
      },
    })
  } catch (e: unknown) {
    const err = e as { statusCode?: number; data?: { detail?: string } }
    if (err.statusCode === 401) {
      throw createError({
        statusCode: 401,
        message: 'Replicate rejected the API key. Check REPLICATE_API_KEY is valid (starts with r8_).',
      })
    }
    throw createError({
      statusCode: err.statusCode || 502,
      message: err.data?.detail || 'Text-to-speech request failed',
    })
  }
})

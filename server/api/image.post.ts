import { createError } from 'h3'
import { getReplicateApiKey } from '../utils/secrets'

export default defineEventHandler(async (event) => {
  const apiKey = getReplicateApiKey(event)
  const body = await readBody(event)

  try {
    return await $fetch<unknown>('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
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
      message: err.data?.detail || 'Replicate image request failed',
    })
  }
})

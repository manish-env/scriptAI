import { createError, type H3Event } from 'h3'
import { getReplicateApiKey } from './secrets'

export async function createReplicatePrediction(
  event: H3Event,
  body: { version?: string; model?: string; input: Record<string, unknown> },
) {
  const apiKey = getReplicateApiKey(event)

  const url = body.model
    ? `https://api.replicate.com/v1/models/${body.model}/predictions`
    : 'https://api.replicate.com/v1/predictions'

  const payload = body.model
    ? { input: body.input }
    : { version: body.version, input: body.input }

  try {
    return await $fetch<unknown>(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: payload,
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
}

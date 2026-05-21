import { createError } from 'h3'
import { getAnthropicApiKey } from '../utils/secrets'

const ALLOWED_MODELS = new Set([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
])
const MAX_TOKENS_CAP = 8192

export default defineEventHandler(async (event) => {
  const apiKey = getAnthropicApiKey(event)

  const body = await readBody<{
    model?: string
    max_tokens?: number
    system?: string
    messages: { role: string; content: string }[]
  }>(event)

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, message: 'messages array is required' })
  }

  const model = ALLOWED_MODELS.has(body.model ?? '') ? body.model : 'claude-opus-4-7'
  const max_tokens = Math.min(body.max_tokens ?? 1500, MAX_TOKENS_CAP)

  const payload: Record<string, unknown> = {
    model,
    max_tokens,
    messages: body.messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
  }
  if (body.system) payload.system = body.system

  const res = await $fetch<unknown>('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: payload,
  })

  return res
})

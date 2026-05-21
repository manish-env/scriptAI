import { createError, type H3Event } from 'h3'

type CloudflareEnv = Record<string, string | undefined>

function cloudflareEnv(event: H3Event): CloudflareEnv {
  return (event.context.cloudflare?.env ?? {}) as CloudflareEnv
}

export function getReplicateApiKey(event: H3Event): string {
  const env = cloudflareEnv(event)
  const config = useRuntimeConfig(event)
  const key =
    env.NUXT_REPLICATE_API_KEY
    || env.REPLICATE_API_KEY
    || config.replicateApiKey
  if (!key) {
    throw createError({
      statusCode: 500,
      message: 'REPLICATE_API_KEY not configured. Add it to .env, .dev.vars, or Cloudflare Pages secrets.',
    })
  }
  return key
}

export function getAnthropicApiKey(event: H3Event): string {
  const env = cloudflareEnv(event)
  const config = useRuntimeConfig(event)
  const key =
    env.NUXT_ANTHROPIC_API_KEY
    || env.ANTHROPIC_API_KEY
    || config.anthropicApiKey
  if (!key) {
    throw createError({
      statusCode: 500,
      message: 'ANTHROPIC_API_KEY not configured. Add it to .env, .dev.vars, or Cloudflare Pages secrets.',
    })
  }
  return key
}

export function getElevenLabsApiKey(event: H3Event): string {
  const env = cloudflareEnv(event)
  const config = useRuntimeConfig(event)
  const key =
    env.NUXT_ELEVENLABS_API_KEY
    || env.ELEVENLABS_API_KEY
    || (config as Record<string, unknown>).elevenLabsApiKey as string | undefined
  if (!key) {
    throw createError({
      statusCode: 500,
      message: 'ELEVENLABS_API_KEY not configured. Add it to .env, .dev.vars, or Cloudflare Pages secrets.',
    })
  }
  return key
}

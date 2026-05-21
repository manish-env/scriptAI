import { createError } from 'h3'

interface Env { NUXT_REPLICATE_API_KEY: string }

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const apiKey = config.replicateApiKey || env.NUXT_REPLICATE_API_KEY
  if (!apiKey) throw createError({ statusCode: 500, message: 'REPLICATE_API_KEY not configured' })
  const body = await readBody(event)

  const res = await $fetch<unknown>('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  })

  return res
})

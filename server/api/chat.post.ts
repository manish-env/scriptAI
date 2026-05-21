interface Env { ANTHROPIC_API_KEY: string }

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const apiKey = config.anthropicApiKey || env.ANTHROPIC_API_KEY

  if (!apiKey) throw createError({ statusCode: 500, message: 'ANTHROPIC_API_KEY not configured' })

  const body = await readBody(event)

  const res = await $fetch<unknown>('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body,
  })

  return res
})

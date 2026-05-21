interface Env { NUXT_REPLICATE_API_KEY: string }

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const apiKey = config.replicateApiKey || env.NUXT_REPLICATE_API_KEY
  const id = getRouterParam(event, 'id')

  return $fetch<unknown>(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
})

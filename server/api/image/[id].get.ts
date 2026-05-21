export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const id = getRouterParam(event, 'id')

  return $fetch<unknown>(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { 'Authorization': `Token ${config.replicateApiKey}` },
  })
})

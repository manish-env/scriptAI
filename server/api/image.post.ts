export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)

  const res = await $fetch<unknown>('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${config.replicateApiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  })

  return res
})

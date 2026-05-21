import { getAnthropicApiKey } from '../utils/secrets'

export default defineEventHandler(async (event) => {
  const apiKey = getAnthropicApiKey(event)

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

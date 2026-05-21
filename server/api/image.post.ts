import { createReplicatePrediction } from '../utils/replicateImage'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    version?: string
    model?: string
    input: Record<string, unknown>
  }>(event)

  if (!body?.input || (!body.version && !body.model)) {
    throw createError({ statusCode: 400, message: 'Provide model or version plus input' })
  }

  return createReplicatePrediction(event, body)
})

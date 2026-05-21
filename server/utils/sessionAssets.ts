import { createError } from 'h3'

type SceneRow = { image_key?: string | null; frame_keys?: string | null }
type AssetRow = { r2_key: string }

export function collectR2KeysFromScenes(scenes: SceneRow[]): string[] {
  const keys = new Set<string>()
  for (const scene of scenes) {
    if (scene.image_key) keys.add(scene.image_key)
    if (scene.frame_keys) {
      try {
        const parsed = JSON.parse(scene.frame_keys) as string[]
        if (Array.isArray(parsed)) parsed.forEach(k => keys.add(k))
      } catch { /* ignore */ }
    }
  }
  return [...keys]
}

export async function deleteR2Keys(bucket: R2Bucket | undefined, keys: string[]) {
  if (!bucket || !keys.length) return
  await Promise.all(keys.map(key => bucket.delete(key).catch(() => undefined)))
}

async function loadScenesForSession(env: { DB: D1Database }, sessionId: string): Promise<SceneRow[]> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT image_key, frame_keys FROM scenes WHERE session_id = ?',
    ).bind(sessionId).all()
    return (results ?? []) as SceneRow[]
  } catch {
    const { results } = await env.DB.prepare(
      'SELECT image_key FROM scenes WHERE session_id = ?',
    ).bind(sessionId).all()
    return ((results ?? []) as { image_key?: string | null }[]).map(r => ({
      image_key: r.image_key,
      frame_keys: null,
    }))
  }
}

export async function gatherSessionAssetKeys(env: { DB?: D1Database }, sessionId: string) {
  const keys = new Set<string>()
  if (!env.DB) return []
  const scenes = await loadScenesForSession(env, sessionId)
  collectR2KeysFromScenes(scenes).forEach(k => keys.add(k))
  try {
    const { results } = await env.DB.prepare(
      'SELECT r2_key FROM assets WHERE session_id = ?',
    ).bind(sessionId).all()
    for (const a of (results ?? []) as AssetRow[]) keys.add(a.r2_key)
  } catch { /* assets table optional in dev */ }
  return [...keys]
}

export async function deleteSessionRecords(env: { DB?: D1Database; BUCKET?: R2Bucket }, sessionId: string) {
  const keys = await gatherSessionAssetKeys(env, sessionId)
  await deleteR2Keys(env.BUCKET, keys)
  if (!env.DB) return { ok: true, cleared: keys.length }
  await env.DB.prepare('DELETE FROM messages WHERE session_id = ?').bind(sessionId).run()
  await env.DB.prepare('DELETE FROM scenes WHERE session_id = ?').bind(sessionId).run()
  try {
    await env.DB.prepare('DELETE FROM assets WHERE session_id = ?').bind(sessionId).run()
  } catch { /* ignore */ }
  const result = await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run()
  if (result.meta.changes === 0) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }
  return { ok: true, cleared: keys.length }
}

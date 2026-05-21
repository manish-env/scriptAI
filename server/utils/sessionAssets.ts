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

export async function gatherSessionAssetKeys(env: { DB?: D1Database }, sessionId: string) {
  const keys = new Set<string>()
  if (!env.DB) return []
  const [{ results: scenes }, { results: assets }] = await Promise.all([
    env.DB.prepare('SELECT image_key, frame_keys FROM scenes WHERE session_id = ?').bind(sessionId).all(),
    env.DB.prepare('SELECT r2_key FROM assets WHERE session_id = ?').bind(sessionId).all(),
  ])
  collectR2KeysFromScenes((scenes ?? []) as SceneRow[]).forEach(k => keys.add(k))
  for (const a of (assets ?? []) as AssetRow[]) keys.add(a.r2_key)
  return [...keys]
}

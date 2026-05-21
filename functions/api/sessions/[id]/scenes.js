import { json, err, uuid } from '../../../_helpers.js';

// POST /api/sessions/:id/scenes  — bulk insert scenes from script
// PATCH /api/sessions/:id/scenes — update one scene's image_key
export async function onRequestPost({ params, request, env }) {
  const { id: session_id } = params;
  const { scenes } = await request.json();
  if (!scenes?.length) return err('scenes required');

  // Clear old scenes for this session before inserting fresh
  await env.DB.prepare('DELETE FROM scenes WHERE session_id = ?').bind(session_id).run();

  const stmt = env.DB.prepare(`
    INSERT INTO scenes (id, session_id, position, title, narration, image_prompt, duration, mood)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await env.DB.batch(
    scenes.map((s, i) => stmt.bind(uuid(), session_id, i, s.title, s.narration, s.imagePrompt, s.duration || 10, s.mood || null))
  );

  const { results } = await env.DB.prepare(
    'SELECT * FROM scenes WHERE session_id = ? ORDER BY position ASC'
  ).bind(session_id).all();

  return json(results);
}

// PATCH body: { scene_id, image_key }
export async function onRequestPatch({ params, request, env }) {
  const { id: session_id } = params;
  const { scene_id, image_key } = await request.json();
  if (!scene_id || !image_key) return err('scene_id and image_key required');

  await env.DB.prepare(
    'UPDATE scenes SET image_key = ? WHERE id = ? AND session_id = ?'
  ).bind(image_key, scene_id, session_id).run();

  return json({ ok: true });
}

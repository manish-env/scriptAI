import { json, err } from '../../_helpers.js';

// GET /api/sessions/:id   — full session (messages + scenes)
// PATCH /api/sessions/:id — update title/topic
export async function onRequestGet({ params, env }) {
  const { id } = params;

  const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
  if (!session) return json(null, 404);

  const { results: messages } = await env.DB.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).bind(id).all();

  const { results: scenes } = await env.DB.prepare(
    'SELECT * FROM scenes WHERE session_id = ? ORDER BY position ASC'
  ).bind(id).all();

  return json({ ...session, messages, scenes });
}

export async function onRequestPatch({ params, request, env }) {
  const { id } = params;
  const { title, topic } = await request.json();

  await env.DB.prepare(`
    UPDATE sessions SET title = ?, topic = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(title || null, topic || null, id).run();

  return json({ ok: true });
}

import { json, err, uuid } from '../../../_helpers.js';

// POST /api/sessions/:id/messages — save one or many messages
// body: { role, content } OR { messages: [{role, content}] }
export async function onRequestPost({ params, request, env }) {
  const { id: session_id } = params;
  const body = await request.json();

  const items = body.messages || [body];
  if (!items.length) return err('no messages provided');

  const stmt = env.DB.prepare(
    'INSERT OR IGNORE INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
  );

  await env.DB.batch(
    items.map(m => stmt.bind(uuid(), session_id, m.role, m.content))
  );

  return json({ ok: true, saved: items.length });
}

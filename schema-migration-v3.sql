-- Run: wrangler d1 execute brandme-db --file=schema-migration-v3.sql --remote
ALTER TABLE users ADD COLUMN eleven_voice_id TEXT;

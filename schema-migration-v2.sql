-- Run: wrangler d1 execute brandme-db --file=schema-migration-v2.sql --remote
ALTER TABLE users ADD COLUMN hero_key TEXT;
ALTER TABLE scenes ADD COLUMN frame_keys TEXT;

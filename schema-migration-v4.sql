-- Run: wrangler d1 execute brandme-db --file=schema-migration-v4.sql --remote
ALTER TABLE sessions ADD COLUMN video_key TEXT;

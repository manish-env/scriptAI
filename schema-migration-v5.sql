-- Migration v5: add video_key to scenes for per-scene AI video clips
ALTER TABLE scenes ADD COLUMN video_key TEXT;

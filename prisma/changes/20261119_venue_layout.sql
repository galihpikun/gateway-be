ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "venue_layout" TEXT,
  ADD COLUMN IF NOT EXISTS "ticket_background_url" TEXT,
  ADD COLUMN IF NOT EXISTS "ticket_background_id" TEXT;

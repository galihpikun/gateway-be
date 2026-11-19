CREATE TABLE IF NOT EXISTS "order_buyer_contacts" (
  "order_id" TEXT PRIMARY KEY REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "full_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "identity_type" TEXT NOT NULL,
  "identity_last_four" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'id',
  "next_email_attempt" TIMESTAMP(3),
  "email_sent_at" TIMESTAMP(3),
  "email_attempts" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "order_buyer_contacts_next_email_attempt_idx"
ON "order_buyer_contacts" ("next_email_attempt");

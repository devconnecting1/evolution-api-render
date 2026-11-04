-- Lookups by message id ("key"->>'id'): getMessage, the duplicate check of messages.upsert and every
-- messages.update (delivery/read ACK). Without it each one is a sequential scan of "Message" (#2753).
-- Prisma cannot describe expression indexes, so it lives only here (not in the schema).
-- Not CONCURRENTLY: migrations run inside a transaction; the table is small and the lock is short.
CREATE INDEX IF NOT EXISTS "Message_instanceId_keyId_idx" ON "Message" ("instanceId", (("key"->>'id')));

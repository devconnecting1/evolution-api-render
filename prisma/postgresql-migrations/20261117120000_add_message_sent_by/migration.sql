-- Quem escreveu cada mensagem (ai, panel, api, device, contact). Nulo nas linhas antigas: a leitura deduz pela chave
-- e o script scripts/backfill-message-sender.ts preenche o que der para provar.
ALTER TABLE "Message" ADD COLUMN "sentBy" VARCHAR(16);

-- Leitura por período de uma instância (exportação e revisão das conversas).
-- Não CONCURRENTLY: migrations rodam numa transação.
CREATE INDEX IF NOT EXISTS "Message_instanceId_messageTimestamp_idx" ON "Message"("instanceId", "messageTimestamp" DESC);

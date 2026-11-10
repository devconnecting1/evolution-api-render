-- Sessões do bot: cada mensagem recebida procura a sessão por instância + contato.
-- Sem índice era leitura completa da tabela (123 mil varreduras em 18 dias no escritório).
CREATE INDEX IF NOT EXISTS "IntegrationSession_instanceId_remoteJid_idx" ON "IntegrationSession"("instanceId", "remoteJid");

-- Lista de conversas do painel (findChats: DISTINCT ON key->>'remoteJid' ORDER BY messageTimestamp DESC)
-- e as consultas por contato do Baileys. Sem índice, cada abertura/atualização da lista percorria todas
-- as mensagens da instância. Expressão: o Prisma não descreve esse índice, ele vive só aqui.
CREATE INDEX IF NOT EXISTS "Message_instanceId_remoteJid_ts_idx" ON "Message" ("instanceId", (("key"->>'remoteJid')), "messageTimestamp" DESC);

-- Quem escreveu cada mensagem (ai, panel, api, device, contact). Nulo nas linhas antigas.
ALTER TABLE `Message` ADD COLUMN `sentBy` VARCHAR(16) NULL;

-- Leitura por período de uma instância (exportação e revisão das conversas).
CREATE INDEX `Message_instanceId_messageTimestamp_idx` ON `Message`(`instanceId`, `messageTimestamp` DESC);

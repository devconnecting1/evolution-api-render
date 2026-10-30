-- AlterTable
ALTER TABLE `OpenaiBot` ADD COLUMN `historyMessages` INTEGER NULL,
    ADD COLUMN `maxAudioSeconds` INTEGER NULL,
    ADD COLUMN `maxDocumentMB` INTEGER NULL,
    ADD COLUMN `readDocuments` BOOLEAN NULL,
    ADD COLUMN `readImages` BOOLEAN NULL,
    ADD COLUMN `transcribeAudio` BOOLEAN NULL,
    ADD COLUMN `transcriptionModel` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `OpenaiSetting` ADD COLUMN `historyMessages` INTEGER NULL DEFAULT 10,
    ADD COLUMN `maxAudioSeconds` INTEGER NULL DEFAULT 300,
    ADD COLUMN `maxDocumentMB` INTEGER NULL DEFAULT 10,
    ADD COLUMN `readDocuments` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `readImages` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `transcribeAudio` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `transcriptionModel` VARCHAR(100) NULL DEFAULT 'gpt-transcribe';


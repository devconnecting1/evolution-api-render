-- CreateTable
CREATE TABLE `Lead` (
    `id` VARCHAR(191) NOT NULL,
    `remoteJid` VARCHAR(100) NOT NULL,
    `pushName` VARCHAR(100) NULL,
    `name` VARCHAR(120) NULL,
    `area` VARCHAR(60) NULL,
    `city` VARCHAR(80) NULL,
    `summary` VARCHAR(600) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'novo',
    `statusSource` VARCHAR(10) NOT NULL DEFAULT 'ai',
    `manualFields` JSON NULL,
    `priority` VARCHAR(10) NOT NULL DEFAULT 'normal',
    `priorityRank` INTEGER NOT NULL DEFAULT 1,
    `priorityReason` VARCHAR(160) NULL,
    `missingInfo` JSON NULL,
    `nextStep` VARCHAR(200) NULL,
    `opposingParty` VARCHAR(120) NULL,
    `hasLawyer` BOOLEAN NULL,
    `documentsMentioned` JSON NULL,
    `mediaCount` INTEGER NOT NULL DEFAULT 0,
    `source` VARCHAR(60) NULL,
    `firstMessageAt` TIMESTAMP NULL,
    `lastMessageAt` TIMESTAMP NULL,
    `lastClientMessageAt` TIMESTAMP NULL,
    `lastHumanReplyAt` TIMESTAMP NULL,
    `awaitingHumanSince` TIMESTAMP NULL,
    `lastExtractedAt` TIMESTAMP NULL,
    `extractedFromCount` INTEGER NOT NULL DEFAULT 0,
    `notifiedAt` TIMESTAMP NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    INDEX `Lead_instanceId_status_updatedAt_idx`(`instanceId`, `status`, `updatedAt`),
    UNIQUE INDEX `Lead_instanceId_remoteJid_key`(`instanceId`, `remoteJid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadSettings` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `areas` JSON NULL,
    `extractionModel` VARCHAR(100) NULL,
    `notifyEnabled` BOOLEAN NOT NULL DEFAULT false,
    `notifyNumbers` JSON NULL,
    `notifyOn` VARCHAR(12) NOT NULL DEFAULT 'ambos',
    `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `LeadSettings_instanceId_key`(`instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadSettings` ADD CONSTRAINT `LeadSettings_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


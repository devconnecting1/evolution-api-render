-- CreateTable
CREATE TABLE `Process` (
    `id` VARCHAR(191) NOT NULL,
    `numeroCnj` VARCHAR(25) NOT NULL,
    `numeroDigits` VARCHAR(20) NOT NULL,
    `tribunalAlias` VARCHAR(20) NOT NULL,
    `apelido` VARCHAR(120) NULL,
    `clientName` VARCHAR(120) NULL,
    `remoteJid` VARCHAR(100) NULL,
    `classe` VARCHAR(200) NULL,
    `assuntos` VARCHAR(300) NULL,
    `orgaoJulgador` VARCHAR(200) NULL,
    `dataAjuizamento` TIMESTAMP NULL,
    `lastMovementAt` TIMESTAMP NULL,
    `lastCheckedAt` TIMESTAMP NULL,
    `lastSyncedAt` TIMESTAMP NULL,
    `lastError` VARCHAR(300) NULL,
    `errorCount` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `notifyTeam` BOOLEAN NOT NULL DEFAULT true,
    `notifyClient` BOOLEAN NOT NULL DEFAULT false,
    `allowAiAnswer` BOOLEAN NOT NULL DEFAULT false,
    `segredoJustica` BOOLEAN NOT NULL DEFAULT false,
    `initialized` BOOLEAN NOT NULL DEFAULT false,
    `lastClientNotice` TIMESTAMP NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    INDEX `Process_instanceId_active_lastCheckedAt_idx`(`instanceId`, `active`, `lastCheckedAt`),
    UNIQUE INDEX `Process_instanceId_numeroDigits_key`(`instanceId`, `numeroDigits`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProcessMovement` (
    `id` VARCHAR(191) NOT NULL,
    `occurredAt` TIMESTAMP NOT NULL,
    `code` INTEGER NULL,
    `name` VARCHAR(300) NOT NULL,
    `complement` VARCHAR(500) NULL,
    `hash` VARCHAR(64) NOT NULL,
    `seenAt` TIMESTAMP NULL,
    `notifyStatus` VARCHAR(10) NOT NULL DEFAULT 'none',
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `processId` VARCHAR(191) NOT NULL,

    INDEX `ProcessMovement_processId_occurredAt_idx`(`processId`, `occurredAt`),
    INDEX `ProcessMovement_notifyStatus_idx`(`notifyStatus`),
    UNIQUE INDEX `ProcessMovement_processId_hash_key`(`processId`, `hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OabWatch` (
    `id` VARCHAR(191) NOT NULL,
    `numeroOab` VARCHAR(20) NOT NULL,
    `ufOab` VARCHAR(2) NOT NULL,
    `label` VARCHAR(120) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `initialized` BOOLEAN NOT NULL DEFAULT false,
    `lastCheckedAt` TIMESTAMP NULL,
    `lastError` VARCHAR(300) NULL,
    `errorCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `OabWatch_instanceId_numeroOab_ufOab_key`(`instanceId`, `numeroOab`, `ufOab`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Publication` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(64) NOT NULL,
    `processNumber` VARCHAR(25) NULL,
    `processDigits` VARCHAR(20) NULL,
    `siglaTribunal` VARCHAR(20) NULL,
    `tipo` VARCHAR(80) NULL,
    `orgao` VARCHAR(200) NULL,
    `disponibilizadaEm` TIMESTAMP NULL,
    `texto` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `seenAt` TIMESTAMP NULL,
    `notifyStatus` VARCHAR(10) NOT NULL DEFAULT 'none',
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `instanceId` VARCHAR(191) NOT NULL,
    `oabWatchId` VARCHAR(191) NULL,
    `linkedProcessId` VARCHAR(191) NULL,

    INDEX `Publication_instanceId_seenAt_idx`(`instanceId`, `seenAt`),
    INDEX `Publication_notifyStatus_idx`(`notifyStatus`),
    UNIQUE INDEX `Publication_instanceId_externalId_key`(`instanceId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProcessSettings` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `checkEveryHours` INTEGER NOT NULL DEFAULT 6,
    `djenDays` INTEGER NOT NULL DEFAULT 7,
    `notifyNumbers` JSON NULL,
    `quietHours` JSON NULL,
    `clientMessageTemplate` TEXT NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ProcessSettings_instanceId_key`(`instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Process` ADD CONSTRAINT `Process_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProcessMovement` ADD CONSTRAINT `ProcessMovement_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OabWatch` ADD CONSTRAINT `OabWatch_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Publication` ADD CONSTRAINT `Publication_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Publication` ADD CONSTRAINT `Publication_oabWatchId_fkey` FOREIGN KEY (`oabWatchId`) REFERENCES `OabWatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Publication` ADD CONSTRAINT `Publication_linkedProcessId_fkey` FOREIGN KEY (`linkedProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProcessSettings` ADD CONSTRAINT `ProcessSettings_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


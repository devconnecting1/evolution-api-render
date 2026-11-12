-- AlterTable: papel e instâncias da pessoa (login Google com os mesmos papéis, etapa 3)
ALTER TABLE `User` ADD COLUMN `role` VARCHAR(16) NOT NULL DEFAULT 'dono',
ADD COLUMN `instances` JSON NULL;

-- CreateTable
CREATE TABLE `TeamKey` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `instances` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `keyHash` VARCHAR(64) NOT NULL,
    `keyHint` VARCHAR(12) NOT NULL,
    `lastUsedAt` TIMESTAMP NULL,
    `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,

    UNIQUE INDEX `TeamKey_keyHash_key`(`keyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `actor` VARCHAR(120) NOT NULL,
    `actorKind` VARCHAR(16) NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `action` VARCHAR(120) NOT NULL,
    `instanceName` VARCHAR(120) NULL,
    `target` VARCHAR(160) NULL,
    `method` VARCHAR(8) NOT NULL,
    `path` VARCHAR(200) NOT NULL,
    `status` INTEGER NOT NULL,
    `ip` VARCHAR(64) NULL,

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_instanceName_createdAt_idx`(`instanceName`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

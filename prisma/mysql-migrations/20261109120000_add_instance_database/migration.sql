-- CreateTable
CREATE TABLE `InstanceDatabase` (
    `id` VARCHAR(191) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(20) NOT NULL DEFAULT 'neon',
    `externalProjectId` VARCHAR(100) NULL,
    `region` VARCHAR(50) NULL,
    `connectionUri` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'provisioning',
    `lastError` TEXT NULL,
    `migratedAt` TIMESTAMP NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,

    UNIQUE INDEX `InstanceDatabase_instanceId_key`(`instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientAccess` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `modules` JSON NOT NULL,
    `keyHash` VARCHAR(64) NOT NULL,
    `keyHint` VARCHAR(12) NOT NULL,
    `lastUsedAt` TIMESTAMP NULL,
    `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ClientAccess_keyHash_key`(`keyHash`),
    UNIQUE INDEX `ClientAccess_instanceId_key`(`instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClientAccess` ADD CONSTRAINT `ClientAccess_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

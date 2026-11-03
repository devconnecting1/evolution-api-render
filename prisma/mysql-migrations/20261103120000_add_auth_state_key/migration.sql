-- CreateTable
CREATE TABLE `AuthStateKey` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(255) NOT NULL,
    `value` LONGTEXT NOT NULL,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `AuthStateKey_sessionId_key_key`(`sessionId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthStateKey` ADD CONSTRAINT `AuthStateKey_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

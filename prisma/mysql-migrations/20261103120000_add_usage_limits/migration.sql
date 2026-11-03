-- CreateTable
CREATE TABLE `InstanceLimits` (
    `id` VARCHAR(191) NOT NULL,
    `planName` VARCHAR(30) NULL,
    `monthlyResponses` INTEGER NULL,
    `dailyResponses` INTEGER NULL,
    `perContactDailyResponses` INTEGER NULL,
    `overLimitAction` VARCHAR(10) NOT NULL DEFAULT 'continue',
    `overLimitMessage` TEXT NULL,
    `alertPercent` INTEGER NOT NULL DEFAULT 80,
    `businessHours` JSON NULL,
    `outsideHoursMessage` TEXT NULL,
    `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `InstanceLimits_instanceId_key`(`instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UsageCounter` (
    `instanceId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `period` VARCHAR(10) NOT NULL,
    `remoteJid` VARCHAR(100) NOT NULL DEFAULT '',
    `responses` INTEGER NOT NULL DEFAULT 0,
    `limitNotice` BOOLEAN NOT NULL DEFAULT false,
    `hoursNotice` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` TIMESTAMP NOT NULL,

    PRIMARY KEY (`instanceId`, `type`, `period`, `remoteJid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `InstanceLimits` ADD CONSTRAINT `InstanceLimits_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UsageCounter` ADD CONSTRAINT `UsageCounter_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

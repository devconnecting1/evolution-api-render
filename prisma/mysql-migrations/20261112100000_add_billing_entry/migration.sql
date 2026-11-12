-- CreateTable
CREATE TABLE `BillingEntry` (
    `id` VARCHAR(191) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `method` VARCHAR(20) NULL,
    `paidAt` TIMESTAMP NULL,
    `note` VARCHAR(280) NULL,
    `receiptNumber` INTEGER NULL,
    `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `BillingEntry_receiptNumber_key`(`receiptNumber`),
    INDEX `BillingEntry_instanceId_period_idx`(`instanceId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BillingEntry` ADD CONSTRAINT `BillingEntry_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

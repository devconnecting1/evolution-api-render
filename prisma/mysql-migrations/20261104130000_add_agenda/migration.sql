-- CreateTable
CREATE TABLE `AgendaSettings` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    `provider` VARCHAR(20) NOT NULL DEFAULT 'internal',
    `slotMinutes` INTEGER NOT NULL DEFAULT 30,
    `bufferMinutes` INTEGER NOT NULL DEFAULT 0,
    `minNoticeHours` INTEGER NOT NULL DEFAULT 2,
    `maxDaysAhead` INTEGER NOT NULL DEFAULT 30,
    `availability` JSON NULL,
    `blocks` JSON NULL,
    `appointmentTypes` JSON NULL,
    `reminders` JSON NULL,
    `confirmation` JSON NULL,
    `aiPermissions` JSON NULL,
    `notifyNumbers` JSON NULL,
    `icsToken` VARCHAR(64) NULL,
    `bookingSeq` INTEGER NOT NULL DEFAULT 0,
    `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `AgendaSettings_icsToken_key`(`icsToken`),
    UNIQUE INDEX `AgendaSettings_instanceId_key`(`instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Appointment` (
    `id` VARCHAR(191) NOT NULL,
    `remoteJid` VARCHAR(100) NOT NULL,
    `contactName` VARCHAR(120) NULL,
    `typeName` VARCHAR(80) NOT NULL,
    `mode` VARCHAR(12) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'agendado',
    `notes` TEXT NULL,
    `source` VARCHAR(8) NOT NULL DEFAULT 'manual',
    `remindersSent` JSON NULL,
    `awaitingReplyAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    INDEX `Appointment_instanceId_startsAt_idx`(`instanceId`, `startsAt`),
    INDEX `Appointment_instanceId_remoteJid_startsAt_idx`(`instanceId`, `remoteJid`, `startsAt`),
    INDEX `Appointment_status_startsAt_idx`(`status`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AgendaSettings` ADD CONSTRAINT `AgendaSettings_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE `Lead` ADD COLUMN     `contactKind` VARCHAR(20) NULL,
ADD COLUMN     `attentionPoints` JSON NULL;

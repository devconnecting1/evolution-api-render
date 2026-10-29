-- AlterTable
ALTER TABLE `OpenaiBot` ADD COLUMN     `tokenParam` VARCHAR(30) NULL,
ADD COLUMN     `humanResumeMinutes` INTEGER NULL;

-- AlterTable
ALTER TABLE `OpenaiSetting` ADD COLUMN     `tokenParam` VARCHAR(30) NULL DEFAULT 'auto',
ADD COLUMN     `humanResumeMinutes` INTEGER NULL DEFAULT 0;

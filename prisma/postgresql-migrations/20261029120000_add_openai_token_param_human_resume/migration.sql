-- AlterTable
ALTER TABLE "OpenaiBot" ADD COLUMN     "tokenParam" VARCHAR(30),
ADD COLUMN     "humanResumeMinutes" INTEGER;

-- AlterTable
ALTER TABLE "OpenaiSetting" ADD COLUMN     "tokenParam" VARCHAR(30) DEFAULT 'auto',
ADD COLUMN     "humanResumeMinutes" INTEGER DEFAULT 0;

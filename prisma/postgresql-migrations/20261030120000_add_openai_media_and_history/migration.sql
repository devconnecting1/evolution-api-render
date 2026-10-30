-- AlterTable
ALTER TABLE "OpenaiBot" ADD COLUMN     "historyMessages" INTEGER,
ADD COLUMN     "maxAudioSeconds" INTEGER,
ADD COLUMN     "maxDocumentMB" INTEGER,
ADD COLUMN     "readDocuments" BOOLEAN,
ADD COLUMN     "readImages" BOOLEAN,
ADD COLUMN     "transcribeAudio" BOOLEAN,
ADD COLUMN     "transcriptionModel" VARCHAR(100);

-- AlterTable
ALTER TABLE "OpenaiSetting" ADD COLUMN     "historyMessages" INTEGER DEFAULT 10,
ADD COLUMN     "maxAudioSeconds" INTEGER DEFAULT 300,
ADD COLUMN     "maxDocumentMB" INTEGER DEFAULT 10,
ADD COLUMN     "readDocuments" BOOLEAN DEFAULT true,
ADD COLUMN     "readImages" BOOLEAN DEFAULT true,
ADD COLUMN     "transcribeAudio" BOOLEAN DEFAULT true,
ADD COLUMN     "transcriptionModel" VARCHAR(100) DEFAULT 'gpt-transcribe';


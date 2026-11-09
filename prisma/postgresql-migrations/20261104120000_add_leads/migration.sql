-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "remoteJid" VARCHAR(100) NOT NULL,
    "pushName" VARCHAR(100),
    "name" VARCHAR(120),
    "area" VARCHAR(60),
    "city" VARCHAR(80),
    "summary" VARCHAR(600),
    "status" VARCHAR(20) NOT NULL DEFAULT 'novo',
    "statusSource" VARCHAR(10) NOT NULL DEFAULT 'ai',
    "manualFields" JSONB,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'normal',
    "priorityRank" INTEGER NOT NULL DEFAULT 1,
    "priorityReason" VARCHAR(160),
    "missingInfo" JSONB,
    "nextStep" VARCHAR(200),
    "opposingParty" VARCHAR(120),
    "hasLawyer" BOOLEAN,
    "documentsMentioned" JSONB,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(60),
    "firstMessageAt" TIMESTAMP,
    "lastMessageAt" TIMESTAMP,
    "lastClientMessageAt" TIMESTAMP,
    "lastHumanReplyAt" TIMESTAMP,
    "awaitingHumanSince" TIMESTAMP,
    "lastExtractedAt" TIMESTAMP,
    "extractedFromCount" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "areas" JSONB,
    "extractionModel" VARCHAR(100),
    "notifyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyNumbers" JSONB,
    "notifyOn" VARCHAR(12) NOT NULL DEFAULT 'ambos',
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "LeadSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_instanceId_status_updatedAt_idx" ON "Lead"("instanceId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_instanceId_remoteJid_key" ON "Lead"("instanceId", "remoteJid");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSettings_instanceId_key" ON "LeadSettings"("instanceId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSettings" ADD CONSTRAINT "LeadSettings_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;


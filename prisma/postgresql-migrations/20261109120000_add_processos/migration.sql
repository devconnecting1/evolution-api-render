-- CreateTable
CREATE TABLE "Process" (
    "id" TEXT NOT NULL,
    "numeroCnj" VARCHAR(25) NOT NULL,
    "numeroDigits" VARCHAR(20) NOT NULL,
    "tribunalAlias" VARCHAR(20) NOT NULL,
    "apelido" VARCHAR(120),
    "clientName" VARCHAR(120),
    "remoteJid" VARCHAR(100),
    "classe" VARCHAR(200),
    "assuntos" VARCHAR(300),
    "orgaoJulgador" VARCHAR(200),
    "dataAjuizamento" TIMESTAMP,
    "lastMovementAt" TIMESTAMP,
    "lastCheckedAt" TIMESTAMP,
    "lastSyncedAt" TIMESTAMP,
    "lastError" VARCHAR(300),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notifyTeam" BOOLEAN NOT NULL DEFAULT true,
    "notifyClient" BOOLEAN NOT NULL DEFAULT false,
    "allowAiAnswer" BOOLEAN NOT NULL DEFAULT false,
    "segredoJustica" BOOLEAN NOT NULL DEFAULT false,
    "initialized" BOOLEAN NOT NULL DEFAULT false,
    "lastClientNotice" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "Process_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessMovement" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP NOT NULL,
    "code" INTEGER,
    "name" VARCHAR(300) NOT NULL,
    "complement" VARCHAR(500),
    "hash" VARCHAR(64) NOT NULL,
    "seenAt" TIMESTAMP,
    "notifyStatus" VARCHAR(10) NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processId" TEXT NOT NULL,

    CONSTRAINT "ProcessMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OabWatch" (
    "id" TEXT NOT NULL,
    "numeroOab" VARCHAR(20) NOT NULL,
    "ufOab" VARCHAR(2) NOT NULL,
    "label" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "initialized" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP,
    "lastError" VARCHAR(300),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "OabWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "processNumber" VARCHAR(25),
    "processDigits" VARCHAR(20),
    "siglaTribunal" VARCHAR(20),
    "tipo" VARCHAR(80),
    "orgao" VARCHAR(200),
    "disponibilizadaEm" TIMESTAMP,
    "texto" TEXT,
    "link" VARCHAR(500),
    "seenAt" TIMESTAMP,
    "notifyStatus" VARCHAR(10) NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "instanceId" TEXT NOT NULL,
    "oabWatchId" TEXT,
    "linkedProcessId" TEXT,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "checkEveryHours" INTEGER NOT NULL DEFAULT 6,
    "djenDays" INTEGER NOT NULL DEFAULT 7,
    "notifyNumbers" JSONB,
    "quietHours" JSONB,
    "clientMessageTemplate" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "ProcessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Process_instanceId_active_lastCheckedAt_idx" ON "Process"("instanceId", "active", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Process_instanceId_numeroDigits_key" ON "Process"("instanceId", "numeroDigits");

-- CreateIndex
CREATE INDEX "ProcessMovement_processId_occurredAt_idx" ON "ProcessMovement"("processId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProcessMovement_notifyStatus_idx" ON "ProcessMovement"("notifyStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessMovement_processId_hash_key" ON "ProcessMovement"("processId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "OabWatch_instanceId_numeroOab_ufOab_key" ON "OabWatch"("instanceId", "numeroOab", "ufOab");

-- CreateIndex
CREATE INDEX "Publication_instanceId_seenAt_idx" ON "Publication"("instanceId", "seenAt");

-- CreateIndex
CREATE INDEX "Publication_notifyStatus_idx" ON "Publication"("notifyStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_instanceId_externalId_key" ON "Publication"("instanceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessSettings_instanceId_key" ON "ProcessSettings"("instanceId");

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessMovement" ADD CONSTRAINT "ProcessMovement_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OabWatch" ADD CONSTRAINT "OabWatch_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_oabWatchId_fkey" FOREIGN KEY ("oabWatchId") REFERENCES "OabWatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_linkedProcessId_fkey" FOREIGN KEY ("linkedProcessId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessSettings" ADD CONSTRAINT "ProcessSettings_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable: papel e instâncias da pessoa (login Google com os mesmos papéis, etapa 3)
ALTER TABLE "User" ADD COLUMN "role" VARCHAR(16) NOT NULL DEFAULT 'dono',
ADD COLUMN "instances" JSONB;

-- CreateTable
CREATE TABLE "TeamKey" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "instances" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyHint" VARCHAR(12) NOT NULL,
    "lastUsedAt" TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "TeamKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" VARCHAR(120) NOT NULL,
    "actorKind" VARCHAR(16) NOT NULL,
    "type" VARCHAR(24) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "instanceName" VARCHAR(120),
    "target" VARCHAR(160),
    "method" VARCHAR(8) NOT NULL,
    "path" VARCHAR(200) NOT NULL,
    "status" INTEGER NOT NULL,
    "ip" VARCHAR(64),

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamKey_keyHash_key" ON "TeamKey"("keyHash");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_instanceName_createdAt_idx" ON "AuditLog"("instanceName", "createdAt");

-- CreateTable
CREATE TABLE "InstanceDatabase" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'neon',
    "externalProjectId" VARCHAR(100),
    "region" VARCHAR(50),
    "connectionUri" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'provisioning',
    "lastError" TEXT,
    "migratedAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "InstanceDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstanceDatabase_instanceId_key" ON "InstanceDatabase"("instanceId");

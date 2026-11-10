-- CreateTable
CREATE TABLE "ClientAccess" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "modules" JSONB NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyHint" VARCHAR(12) NOT NULL,
    "lastUsedAt" TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "ClientAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccess_keyHash_key" ON "ClientAccess"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccess_instanceId_key" ON "ClientAccess"("instanceId");

-- AddForeignKey
ALTER TABLE "ClientAccess" ADD CONSTRAINT "ClientAccess_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

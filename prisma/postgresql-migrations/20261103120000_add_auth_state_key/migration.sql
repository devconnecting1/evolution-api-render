-- CreateTable
CREATE TABLE "AuthStateKey" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthStateKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthStateKey_sessionId_key_key" ON "AuthStateKey"("sessionId", "key");

-- AddForeignKey
ALTER TABLE "AuthStateKey" ADD CONSTRAINT "AuthStateKey_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

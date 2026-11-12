-- CreateTable
CREATE TABLE "BillingEntry" (
    "id" TEXT NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "method" VARCHAR(20),
    "paidAt" TIMESTAMP,
    "note" VARCHAR(280),
    "receiptNumber" INTEGER,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "BillingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingEntry_receiptNumber_key" ON "BillingEntry"("receiptNumber");

-- CreateIndex
CREATE INDEX "BillingEntry_instanceId_period_idx" ON "BillingEntry"("instanceId", "period");

-- AddForeignKey
ALTER TABLE "BillingEntry" ADD CONSTRAINT "BillingEntry_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

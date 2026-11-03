-- CreateTable
CREATE TABLE "InstanceLimits" (
    "id" TEXT NOT NULL,
    "planName" VARCHAR(30),
    "monthlyResponses" INTEGER,
    "dailyResponses" INTEGER,
    "perContactDailyResponses" INTEGER,
    "overLimitAction" VARCHAR(10) NOT NULL DEFAULT 'continue',
    "overLimitMessage" TEXT,
    "alertPercent" INTEGER NOT NULL DEFAULT 80,
    "businessHours" JSONB,
    "outsideHoursMessage" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "InstanceLimits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "instanceId" TEXT NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "remoteJid" VARCHAR(100) NOT NULL DEFAULT '',
    "responses" INTEGER NOT NULL DEFAULT 0,
    "limitNotice" BOOLEAN NOT NULL DEFAULT false,
    "hoursNotice" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("instanceId","type","period","remoteJid")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstanceLimits_instanceId_key" ON "InstanceLimits"("instanceId");

-- AddForeignKey
ALTER TABLE "InstanceLimits" ADD CONSTRAINT "InstanceLimits_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

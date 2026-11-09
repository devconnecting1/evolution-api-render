-- CreateTable
CREATE TABLE "AgendaSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 2,
    "maxDaysAhead" INTEGER NOT NULL DEFAULT 30,
    "availability" JSONB,
    "blocks" JSONB,
    "appointmentTypes" JSONB,
    "reminders" JSONB,
    "confirmation" JSONB,
    "aiPermissions" JSONB,
    "notifyNumbers" JSONB,
    "icsToken" VARCHAR(64),
    "bookingSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "AgendaSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "remoteJid" VARCHAR(100) NOT NULL,
    "contactName" VARCHAR(120),
    "typeName" VARCHAR(80) NOT NULL,
    "mode" VARCHAR(12),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'agendado',
    "notes" TEXT,
    "source" VARCHAR(8) NOT NULL DEFAULT 'manual',
    "remindersSent" JSONB,
    "awaitingReplyAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgendaSettings_icsToken_key" ON "AgendaSettings"("icsToken");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaSettings_instanceId_key" ON "AgendaSettings"("instanceId");

-- CreateIndex
CREATE INDEX "Appointment_instanceId_startsAt_idx" ON "Appointment"("instanceId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_instanceId_remoteJid_startsAt_idx" ON "Appointment"("instanceId", "remoteJid", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_status_startsAt_idx" ON "Appointment"("status", "startsAt");

-- AddForeignKey
ALTER TABLE "AgendaSettings" ADD CONSTRAINT "AgendaSettings_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;


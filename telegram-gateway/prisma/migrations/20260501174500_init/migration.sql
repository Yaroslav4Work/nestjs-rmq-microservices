CREATE TYPE "ProcessedEventStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');

CREATE TABLE "TelegramChat" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "firstName" TEXT,
  "username" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TelegramChat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessedEvent" (
  "id" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "status" "ProcessedEventStatus" NOT NULL DEFAULT 'PROCESSING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramChat_chatId_key" ON "TelegramChat"("chatId");
CREATE UNIQUE INDEX "ProcessedEvent_correlationId_key" ON "ProcessedEvent"("correlationId");
CREATE INDEX "ProcessedEvent_status_createdAt_idx" ON "ProcessedEvent"("status", "createdAt");

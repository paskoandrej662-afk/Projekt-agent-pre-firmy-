-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('AI_UNSURE', 'PRICE_GUARD', 'AI_ERROR');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "externalChatId" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "draftReply" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_barberId_idx" ON "Notification"("barberId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

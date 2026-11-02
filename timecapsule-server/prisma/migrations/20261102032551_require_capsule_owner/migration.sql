/*
  Warnings:

  - Made the column `ownerId` on table `Capsule` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Capsule" DROP CONSTRAINT "Capsule_ownerId_fkey";

-- AlterTable
ALTER TABLE "Capsule" ALTER COLUMN "ownerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Capsule_ownerId_unlockDate_idx" ON "Capsule"("ownerId", "unlockDate");

-- CreateIndex
CREATE INDEX "Capsule_notified_unlockDate_idx" ON "Capsule"("notified", "unlockDate");

-- AddForeignKey
ALTER TABLE "Capsule" ADD CONSTRAINT "Capsule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `VerificationCleanup` ADD COLUMN `ownerUserId` INTEGER NULL;
UPDATE `VerificationCleanup` AS c JOIN `TutorProfile` AS t ON t.id = c.tutorId SET c.ownerUserId = t.userId;
ALTER TABLE `VerificationCleanup` DROP FOREIGN KEY `VerificationCleanup_tutorId_fkey`;
ALTER TABLE `VerificationCleanup` MODIFY `tutorId` INTEGER NULL, MODIFY `ownerUserId` INTEGER NOT NULL;
ALTER TABLE `VerificationCleanup` ADD CONSTRAINT `VerificationCleanup_tutorId_fkey` FOREIGN KEY (`tutorId`) REFERENCES `TutorProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

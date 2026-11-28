ALTER TABLE `Quiz` ADD COLUMN `isHidden` BOOLEAN NOT NULL DEFAULT false, ADD COLUMN `moderationReason` VARCHAR(500) NULL, ADD COLUMN `moderatedAt` DATETIME(3) NULL, ADD COLUMN `moderatedById` INTEGER NULL;
ALTER TABLE `Complaint` ADD COLUMN `quizId` INTEGER NULL;
CREATE INDEX `Complaint_quizId_idx` ON `Complaint`(`quizId`);
ALTER TABLE `Complaint` ADD CONSTRAINT `Complaint_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `Quiz`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE `QuizModerationEntry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `quizId` INTEGER NOT NULL,
  `adminId` INTEGER NOT NULL,
  `adminName` VARCHAR(191) NOT NULL,
  `isHidden` BOOLEAN NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `QuizModerationEntry_quizId_createdAt_idx`(`quizId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

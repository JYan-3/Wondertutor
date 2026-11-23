CREATE TABLE `VerificationCleanup` (
  `publicId` VARCHAR(191) NOT NULL,
  `tutorId` INTEGER NOT NULL,
  `documentUrl` VARCHAR(500) NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `VerificationCleanup_nextAttemptAt_idx`(`nextAttemptAt`),
  PRIMARY KEY (`publicId`),
  CONSTRAINT `VerificationCleanup_tutorId_fkey` FOREIGN KEY (`tutorId`) REFERENCES `TutorProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

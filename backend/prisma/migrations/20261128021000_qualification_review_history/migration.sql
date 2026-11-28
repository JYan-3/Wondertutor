CREATE TABLE `QualificationReview` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `qualificationId` INTEGER NOT NULL,
  `tutorId` INTEGER NOT NULL,
  `documentTitle` VARCHAR(191) NOT NULL,
  `previousStatus` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `note` VARCHAR(300) NULL,
  `adminId` INTEGER NOT NULL,
  `adminName` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `QualificationReview_qualificationId_createdAt_idx` (`qualificationId`, `createdAt`),
  INDEX `QualificationReview_tutorId_createdAt_idx` (`tutorId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

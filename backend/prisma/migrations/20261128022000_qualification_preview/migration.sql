CREATE TABLE `QualificationPreview` (
  `qualificationId` INTEGER NOT NULL,
  `adminId` INTEGER NOT NULL,
  `documentHash` CHAR(64) NOT NULL,
  `viewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`qualificationId`, `adminId`),
  CONSTRAINT `QualificationPreview_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `Qualification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

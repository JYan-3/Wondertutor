CREATE TABLE `SystemSettingHistory` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(191) NOT NULL,
  `oldValue` VARCHAR(191) NOT NULL,
  `newValue` VARCHAR(191) NOT NULL,
  `adminId` INTEGER NOT NULL,
  `adminName` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `SystemSettingHistory_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HousekeepingStatus` (
  `name` VARCHAR(100) NOT NULL,
  `lastAttemptAt` DATETIME(3) NOT NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  `lastFailureAt` DATETIME(3) NULL,

  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

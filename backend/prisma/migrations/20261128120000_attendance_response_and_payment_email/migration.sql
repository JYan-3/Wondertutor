ALTER TABLE `Complaint` ADD COLUMN `parentResponseDueAt` DATETIME(3) NULL, ADD COLUMN `tutorResponseDueAt` DATETIME(3) NULL;

UPDATE `Complaint` SET `parentResponseDueAt` = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 48 HOUR)
WHERE `category` = 'Missed check-in' AND `status` IN ('OPEN', 'IN_PROGRESS') AND `parentAnswer` IS NULL;

UPDATE `Complaint` SET `tutorResponseDueAt` = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 48 HOUR)
WHERE `category` = 'Missed check-in' AND `status` IN ('OPEN', 'IN_PROGRESS') AND `tutorReplyPending` = true;

CREATE TABLE `PaymentEmailDelivery` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `paymentId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `link` VARCHAR(191) NULL,
  `sentAt` DATETIME(3) NULL,
  `retryAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leaseUntil` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  UNIQUE INDEX `PaymentEmailDelivery_paymentId_key`(`paymentId`),
  INDEX `PaymentEmailDelivery_sentAt_retryAt_idx`(`sentAt`, `retryAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PaymentEmailDelivery_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

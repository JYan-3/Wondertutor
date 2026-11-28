ALTER TABLE `Complaint` ADD COLUMN `sourceComplaintId` INTEGER NULL;
CREATE UNIQUE INDEX `Complaint_sourceComplaintId_key` ON `Complaint`(`sourceComplaintId`);
ALTER TABLE `Complaint` ADD CONSTRAINT `Complaint_sourceComplaintId_fkey` FOREIGN KEY (`sourceComplaintId`) REFERENCES `Complaint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX `PaymentEmailDelivery_paymentId_userId_key` ON `PaymentEmailDelivery`(`paymentId`, `userId`);
ALTER TABLE `PaymentEmailDelivery` DROP INDEX `PaymentEmailDelivery_paymentId_key`;

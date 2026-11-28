ALTER TABLE `Complaint` ADD COLUMN `appealUntil` DATETIME(3) NULL, ADD COLUMN `appealUsed` BOOLEAN NOT NULL DEFAULT false;

UPDATE `Complaint` c SET c.`appealUsed` = true
WHERE c.`category` = 'Missed check-in' AND EXISTS (
  SELECT 1 FROM `AttendanceReviewEntry` e WHERE e.`complaintId` = c.`id` AND e.`action` = 'RECONSIDERATION'
);

UPDATE `Complaint` SET `appealUntil` = DATE_ADD(`updatedAt`, INTERVAL 14 DAY)
WHERE `category` = 'Missed check-in' AND `status` = 'DISMISSED' AND `appealUsed` = false;

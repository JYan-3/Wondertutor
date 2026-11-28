ALTER TABLE `Booking`
  ADD COLUMN `cancellationChoiceStatus` VARCHAR(24) NULL,
  ADD COLUMN `cancellationChoiceUntil` DATETIME(3) NULL;

CREATE INDEX `Booking_cancellationChoiceStatus_cancellationChoiceUntil_idx`
  ON `Booking`(`cancellationChoiceStatus`, `cancellationChoiceUntil`);

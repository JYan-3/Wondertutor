ALTER TABLE `Withdrawal`
  ADD COLUMN `paidAt` DATETIME(3) NULL,
  ADD COLUMN `paidById` INTEGER NULL,
  ADD COLUMN `transferRef` VARCHAR(100) NULL,
  ADD COLUMN `receiptUrl` TEXT NULL,
  ADD COLUMN `legacyPaid` BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX `Withdrawal_transferRef_key` ON `Withdrawal`(`transferRef`);
-- Existing approvals were already deducted as paid; preserve their historical balance.
UPDATE `Withdrawal` SET `legacyPaid` = true WHERE `status` = 'APPROVED';

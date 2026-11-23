ALTER TABLE `Withdrawal`
  ADD COLUMN `approvalBasis` CHAR(64) NULL,
  ADD COLUMN `transferStartedAt` DATETIME(3) NULL,
  ADD COLUMN `transferStartedById` INTEGER NULL;

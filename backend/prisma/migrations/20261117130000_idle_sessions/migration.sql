-- Existing sessions receive an already-due idle deadline and must sign in again.
-- No user, booking or payment data is changed. New sessions set this explicitly.
ALTER TABLE `AuthSession`
    ADD COLUMN `idleExpiresAt` DATETIME(3) NULL;

-- Use UTC explicitly: the database host's local time zone may differ from Prisma.
UPDATE `AuthSession` SET `idleExpiresAt` = LEAST(`expiresAt`, UTC_TIMESTAMP(3));

ALTER TABLE `AuthSession`
    MODIFY COLUMN `idleExpiresAt` DATETIME(3) NOT NULL,
    ADD INDEX `AuthSession_idleExpiresAt_idx` (`idleExpiresAt`);

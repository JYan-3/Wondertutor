CREATE TABLE `PushSubscription` (
    `deviceHash` CHAR(64) NOT NULL,
    `userId` INTEGER NOT NULL,
    `endpointHash` CHAR(64) NOT NULL,
    `endpoint` TEXT NOT NULL,
    `p256dh` VARCHAR(87) NOT NULL,
    `auth` VARCHAR(22) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`deviceHash`),
    UNIQUE INDEX `PushSubscription_endpointHash_key` (`endpointHash`),
    INDEX `PushSubscription_userId_expiresAt_idx` (`userId`, `expiresAt`),
    CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

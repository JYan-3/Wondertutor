ALTER TABLE `QuizAttempt` ADD COLUMN `requestId` CHAR(36) NULL;
CREATE UNIQUE INDEX `QuizAttempt_requestId_key` ON `QuizAttempt`(`requestId`);

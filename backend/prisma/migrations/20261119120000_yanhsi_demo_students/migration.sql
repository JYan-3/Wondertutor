-- Optional demo records for one tutor. Missing accounts are left untouched.
-- Zero-value lessons never create withdrawable earnings or call a payment gateway.
CREATE TEMPORARY TABLE `_yanhsi_demo_students` (
  `n` INT PRIMARY KEY, `name` VARCHAR(100), `status` VARCHAR(30), `scenario` VARCHAR(200)
);
INSERT INTO `_yanhsi_demo_students` VALUES
(1, 'Alya', 'PENDING', 'Parent request awaiting tutor reply'),
(2, 'Ben', 'COUNTER_OFFERED', 'Tutor counter-offer awaiting parent reply'),
(3, 'Chloe', 'AWAITING_PAYMENT', 'Accepted request awaiting payment'),
(4, 'Daniel', 'CONFIRMED', 'Upcoming lesson without a class link'),
(5, 'Emma', 'CONFIRMED', 'Upcoming lesson with a placeholder class link'),
(6, 'Farhan', 'CONFIRMED', 'Checked out and awaiting lesson report'),
(7, 'Grace', 'REJECTED', 'Request declined by tutor'),
(8, 'Haziq', 'CANCELLED', 'Lesson cancelled by parent'),
(9, 'Iris', 'CONFIRMED', 'Parent time-change request awaiting tutor reply'),
(10, 'Jayden', 'CONFIRMED', 'Time-change request escalated for admin review');

START TRANSACTION;
SET @demo_tutor = (SELECT t.id FROM TutorProfile t JOIN User u ON u.id = t.userId
  WHERE u.email = 'yapyh-wp23@student.tarc.edu.my' AND u.role = 'TUTOR' AND u.deletedAt IS NULL);
SET @demo_now = UTC_TIMESTAMP(3);
SET @demo_today = DATE(DATE_ADD(@demo_now, INTERVAL 8 HOUR));
SET @demo_subject_id = (SELECT id FROM TutorSubject WHERE tutorId = @demo_tutor ORDER BY id LIMIT 1);
SET @demo_subject = COALESCE((SELECT subject FROM TutorSubject WHERE id = @demo_subject_id), 'Mathematics');
SET @demo_level = COALESCE((SELECT educationLevel FROM TutorSubject WHERE id = @demo_subject_id), 'PRIMARY');
SET @demo_grade = COALESCE((SELECT minGrade FROM TutorSubject WHERE id = @demo_subject_id), 4);
SET @demo_mode = (SELECT IF(offersOnline, 'ONLINE', 'PHYSICAL') FROM TutorProfile WHERE id = @demo_tutor);

-- The reserved parent cannot sign in and has email reminders disabled.
INSERT INTO User (email, role, fullName, isEmailVerified, emailReminders, createdAt, updatedAt)
SELECT 'yanhsi-demo-20261119@example.invalid', 'PARENT', '[DEMO] Yan Hsi Test Parent', false, false, @demo_now, @demo_now
WHERE @demo_tutor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM User WHERE email = 'yanhsi-demo-20261119@example.invalid');
SET @demo_user = (SELECT id FROM User WHERE email = 'yanhsi-demo-20261119@example.invalid'
  AND fullName = '[DEMO] Yan Hsi Test Parent' AND role = 'PARENT' AND passwordHash IS NULL AND googleId IS NULL AND emailReminders = false);
INSERT INTO ParentProfile (userId)
SELECT @demo_user WHERE @demo_tutor IS NOT NULL AND @demo_user IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ParentProfile WHERE userId = @demo_user);
SET @demo_parent = (SELECT id FROM ParentProfile WHERE userId = @demo_user);

INSERT INTO Child (publicId, parentId, name, educationLevel, grade, gradeYear, subject, subjects, preferredLanguage, goals, notes)
SELECT CONCAT('d1910000-0000-4000-8000-', LPAD(d.n, 12, '0')), @demo_parent, CONCAT('[DEMO] ', d.name),
  @demo_level, @demo_grade, YEAR(@demo_today), @demo_subject, JSON_ARRAY(@demo_subject), 'English',
  'Practice lesson reports and student progress', CONCAT('Fictional test student. ', d.scenario)
FROM `_yanhsi_demo_students` d
WHERE @demo_tutor IS NOT NULL AND @demo_parent IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM Child WHERE publicId = CONCAT('d1910000-0000-4000-8000-', LPAD(d.n, 12, '0')));

-- One completed lesson per child makes all ten visible in My Students.
INSERT INTO Booking (publicId, parentId, childId, tutorId, subject, startAt, endAt, teachingMode,
  proposedPrice, agreedPrice, status, messageToTutor, createdAt, updatedAt)
SELECT CONCAT('d1910001-0000-4000-8000-', LPAD(d.n, 12, '0')), @demo_parent, c.id, @demo_tutor, @demo_subject,
  TIMESTAMPADD(DAY, d.n - 60, TIMESTAMP(@demo_today, '08:00:00')),
  TIMESTAMPADD(DAY, d.n - 60, TIMESTAMP(@demo_today, '09:00:00')), @demo_mode,
  0, 0, 'COMPLETED', '[DEMO] Completed practice lesson. No money was collected.', @demo_now, @demo_now
FROM `_yanhsi_demo_students` d JOIN Child c ON c.publicId = CONCAT('d1910000-0000-4000-8000-', LPAD(d.n, 12, '0')) AND c.parentId = @demo_parent
WHERE @demo_tutor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Booking WHERE publicId = CONCAT('d1910001-0000-4000-8000-', LPAD(d.n, 12, '0')));

-- Existing reservations win if a proposed demonstration time is already occupied.
INSERT INTO Booking (publicId, parentId, childId, tutorId, subject, startAt, endAt, teachingMode,
  proposedPrice, counterPrice, agreedPrice, status, payBy, meetingLink, messageToTutor,
  rejectionReason, cancelReason, cancelledById, createdAt, updatedAt)
SELECT CONCAT('d1910002-0000-4000-8000-', LPAD(d.n, 12, '0')), @demo_parent, c.id, @demo_tutor, @demo_subject,
  TIMESTAMPADD(DAY, IF(d.n = 6, -1, d.n + 7), TIMESTAMP(@demo_today, '08:00:00')),
  TIMESTAMPADD(DAY, IF(d.n = 6, -1, d.n + 7), TIMESTAMP(@demo_today, '09:00:00')), @demo_mode,
  0, IF(d.n = 2, 0, NULL), IF(d.status IN ('CONFIRMED', 'AWAITING_PAYMENT', 'CANCELLED'), 0, NULL), d.status,
  IF(d.n = 3, DATE_ADD(@demo_now, INTERVAL 24 HOUR), NULL),
  IF(d.n = 5 AND @demo_mode = 'ONLINE', 'https://example.invalid/demo-class', NULL),
  CONCAT('[DEMO] ', d.scenario, '. RM0 test record. No actual payment or lesson.'),
  IF(d.n = 7, '[DEMO] Tutor unavailable at the requested time', NULL),
  IF(d.n = 8, '[DEMO] Parent no longer needs this lesson', NULL), IF(d.n = 8, @demo_user, NULL), @demo_now, @demo_now
FROM `_yanhsi_demo_students` d JOIN Child c ON c.publicId = CONCAT('d1910000-0000-4000-8000-', LPAD(d.n, 12, '0')) AND c.parentId = @demo_parent
WHERE @demo_tutor IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM Booking WHERE publicId = CONCAT('d1910002-0000-4000-8000-', LPAD(d.n, 12, '0')))
  AND NOT EXISTS (SELECT 1 FROM Booking b WHERE b.tutorId = @demo_tutor
    AND b.status IN ('CONFIRMED', 'AWAITING_PAYMENT')
    AND b.startAt < TIMESTAMPADD(DAY, IF(d.n = 6, -1, d.n + 7), TIMESTAMP(@demo_today, '09:00:00'))
    AND b.endAt > TIMESTAMPADD(DAY, IF(d.n = 6, -1, d.n + 7), TIMESTAMP(@demo_today, '08:00:00')));

INSERT INTO Payment (publicId, bookingId, amount, commissionRate, commissionAmount, method, status, paidAt)
SELECT REPLACE(b.publicId, 'd191000', 'd191100'), b.id, 0, 0, 0, 'DEMO', 'PAID', b.createdAt
FROM Booking b WHERE b.tutorId = @demo_tutor AND b.parentId = @demo_parent
  AND (b.publicId LIKE 'd1910001-0000-4000-8000-%' OR b.publicId LIKE 'd1910002-0000-4000-8000-%')
  AND b.status IN ('COMPLETED', 'CONFIRMED') AND NOT EXISTS (SELECT 1 FROM Payment WHERE bookingId = b.id);
INSERT INTO Attendance (bookingId, checkInAt, checkOutAt)
SELECT b.id, b.startAt, b.endAt FROM Booking b
WHERE b.tutorId = @demo_tutor AND b.parentId = @demo_parent
  AND (b.publicId LIKE 'd1910001-0000-4000-8000-%' OR b.publicId = 'd1910002-0000-4000-8000-000000000006')
  AND NOT EXISTS (SELECT 1 FROM Attendance WHERE bookingId = b.id);
INSERT INTO SessionSummary (bookingId, content, progressNote, topics, homework, recommendations)
SELECT b.id, '[DEMO] Revised the previous topic and practised five questions.',
  'Can explain the method independently. Needs more practice checking answers.', b.subject,
  'Complete five revision questions before the next lesson.', 'Begin the next lesson with a short recap.'
FROM Booking b WHERE b.tutorId = @demo_tutor AND b.parentId = @demo_parent
  AND b.publicId LIKE 'd1910001-0000-4000-8000-%'
  AND NOT EXISTS (SELECT 1 FROM SessionSummary WHERE bookingId = b.id);
INSERT INTO RescheduleRequest (bookingId, requestedById, newStartAt, newEndAt, reason, status)
SELECT b.id, @demo_user, DATE_ADD(b.startAt, INTERVAL 2 HOUR), DATE_ADD(b.endAt, INTERVAL 2 HOUR),
  '[DEMO] School activity clashes with the original time.',
  IF(b.publicId = 'd1910002-0000-4000-8000-000000000010', 'ESCALATED', 'PENDING')
FROM Booking b WHERE b.tutorId = @demo_tutor AND b.parentId = @demo_parent
  AND b.publicId IN ('d1910002-0000-4000-8000-000000000009', 'd1910002-0000-4000-8000-000000000010')
  AND NOT EXISTS (SELECT 1 FROM RescheduleRequest WHERE bookingId = b.id);
COMMIT;
DROP TEMPORARY TABLE `_yanhsi_demo_students`;

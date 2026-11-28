import { AppError } from '../utils/AppError.js'
import { mytParts } from '../utils/time.js'

// New requests close at midnight at the start of the lesson day in Malaysia.
export const canRequestLessonDate = (date, now = new Date()) => date > mytParts(now).date
export function assertRequestLessonDate(date, now = new Date()) {
  if (!canRequestLessonDate(date, now)) throw new AppError(400, 'Book by 11:59 pm Malaysia time on the day before the lesson.')
}

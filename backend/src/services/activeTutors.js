import { prisma } from '../config/prisma.js'
import { browseTutorWhere, tutorInclude } from './tutor.service.js'

// Keep subject, level and grade on the same subject row when filtering tutors.
export function activeTutors(criteria, db = prisma) {
  return db.tutorProfile.findMany({
    where: browseTutorWhere(criteria),
    include: tutorInclude,
  })
}

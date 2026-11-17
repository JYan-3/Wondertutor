// Exercise the shared guided-chat/wizard matching service with controlled reads.
import { jest } from '@jest/globals'
import { prisma } from '../config/prisma.js'
import { tutorRecommendationsForParent } from '../services/matchingApp.service.js'

const criteria = { subject: 'Tamil', level: 'PRIMARY', grade: 1, days: [4], timeStart: '18:00', timeEnd: '20:00',
  location: 'Klang, Selangor', mode: 'EITHER', budgetMin: 40, budgetMax: 60 }
const ipohTutor = {
  id: 30, user: { fullName: 'Kavitha Devi', profilePhotoUrl: null },
  subjects: [{ subject: 'Tamil', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }],
  location: 'Ipoh, Perak', latitude: 4.5975, longitude: 101.0901,
  offersPhysical: true, offersOnline: true, hourlyRate: 55, ratingAvg: 4.8, ratingCount: 10,
  isVerified: true, yearsExperience: 6, characteristics: [], languages: ['Tamil'], qualifications: [],
  availability: [{ dayOfWeek: 4, startTime: '18:00', endTime: '20:00', mode: 'BOTH' }],
}
let tutors, favourites
beforeEach(() => {
  tutors = jest.spyOn(prisma.tutorProfile, 'findMany').mockResolvedValue([ipohTutor])
  favourites = jest.spyOn(prisma.favouriteTutor, 'findMany').mockResolvedValue([])
})
afterEach(() => jest.restoreAllMocks())
afterAll(() => prisma.$disconnect())

test.each(['EITHER', 'PHYSICAL'])('%s in Klang never presents an Ipoh tutor as a local physical match', async mode => {
  const result = await tutorRecommendationsForParent({ ...criteria, mode }, 91)
  expect(result).toMatchObject({ total: 0, tutors: [], searchScope: { mode: 'PHYSICAL', location: 'Klang, Selangor', radiusKm: 30 },
    onlineAlternatives: { total: 1, tutors: [{ id: 30, location: 'Ipoh, Perak', searchMode: 'ONLINE', match: { distanceKm: null } }] },
  })
  expect(result.onlineAlternatives.tutors[0].match.reasons).toContain('Offers online lessons')
  expect(result.onlineAlternatives.tutors[0].match.reasons.join(' ')).not.toMatch(/your area|km away/)
  expect(favourites).toHaveBeenCalledWith({ where: { parentId: 91 }, select: { tutorId: true } })
})

test('online lessons can use the Ipoh tutor without applying the physical Klang radius', async () => {
  const result = await tutorRecommendationsForParent({ ...criteria, mode: 'ONLINE', maxDistance: 5 }, 91)
  expect(result).toMatchObject({ total: 1, tutors: [{ id: 30, searchMode: 'ONLINE', match: { distanceKm: null } }],
    searchScope: { mode: 'ONLINE', radiusKm: null }, onlineAlternatives: { total: 0, tutors: [] },
  })
})

test('a nearby physical tutor is eligible while the remote tutor remains in the separate online group', async () => {
  tutors.mockResolvedValue([ipohTutor, { ...ipohTutor, id: 31, location: 'Klang, Selangor', latitude: 3.0449, longitude: 101.4455 }])
  const result = await tutorRecommendationsForParent(criteria, 91)
  expect(result.total).toBe(1)
  expect(result.tutors[0]).toMatchObject({ id: 31, searchMode: 'PHYSICAL', match: { distanceKm: 0 } })
  expect(result.onlineAlternatives.tutors.find(tutor => tutor.id === 30).searchMode).toBe('ONLINE')
})

test('remote physical-only and wrong-subject tutors cannot become online alternatives', async () => {
  tutors.mockResolvedValue([{ ...ipohTutor, offersOnline: false }, { ...ipohTutor, id: 31,
    subjects: [{ subject: 'English', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }],
  }])
  const result = await tutorRecommendationsForParent(criteria, 91)
  expect(result.total).toBe(0)
  expect(result.onlineAlternatives).toEqual({ total: 0, tutors: [] })
})

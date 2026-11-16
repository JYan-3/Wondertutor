// Controller regressions use controlled query results without changing a database.
import { jest } from '@jest/globals'
import { prisma } from '../config/prisma.js'
import { browseTutors } from '../controllers/parent/tutors.controller.js'

const teacher = (id, extra = {}) => ({
  id, user: { fullName: `Tutor ${id}`, profilePhotoUrl: null },
  subjects: [{ subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }],
  latitude: 3.2087, longitude: 101.6366, location: 'Kepong, Kuala Lumpur',
  hourlyRate: 60, ratingAvg: 4.8, ratingCount: 10, yearsExperience: 6,
  isVerified: true, offersPhysical: true, offersOnline: true,
  gender: 'FEMALE', characteristics: [], languages: [], availability: [], qualifications: [],
  ...extra,
})
const near = teacher(1)
const far = teacher(2, { latitude: 5.2885, longitude: 103.1227, hourlyRate: 50, ratingAvg: 4.7 })
const online = teacher(3, { offersPhysical: false, hourlyRate: 40, ratingAvg: 4.6 })
let queryTutors, favourites

beforeEach(() => {
  queryTutors = jest.spyOn(prisma.tutorProfile, 'findMany').mockResolvedValue([near, far, online])
  favourites = jest.spyOn(prisma.favouriteTutor, 'findMany').mockResolvedValue([{ tutorId: 2 }])
})
afterEach(() => jest.restoreAllMocks())
afterAll(() => prisma.$disconnect())

async function browse(query = {}) {
  let data
  await browseTutors({ query, parent: { id: 91, address: 'Kepong, Kuala Lumpur', latitude: 3.2087, longitude: 101.6366, preferences: { gender: 'MALE', mode: 'ONLINE' } } }, { json(value) { data = value } })
  return data
}

test('empty filters include nationwide tutors without hidden home-area limits or invented match scores', async () => {
  const result = await browse()
  expect(result).toMatchObject({ total: 3, page: 1, personalised: false, searchScope: { mode: 'ANY', location: null } })
  expect(result.tutors.map(t => t.id)).toEqual([1, 2, 3])
  expect(result.tutors.every(t => t.match === null && t.distanceKm === null)).toBe(true)
  expect(result.tutors.find(t => t.id === 2).isFavourite).toBe(true)
  expect(result.rankedBy).toEqual([])
  expect(queryTutors).toHaveBeenCalledWith(expect.objectContaining({ where: {
    user: { status: 'ACTIVE', deletedAt: null }, hourlyRate: { gt: 0 }, subjects: { some: {} },
  } }))
  expect(favourites).toHaveBeenCalledWith({ where: { parentId: 91 }, select: { tutorId: true } })
})

test('subject-only discovery constrains the teaching row without adding a level or match score', async () => {
  const result = await browse({ subject: 'Mathematics' })
  expect(result.total).toBe(3)
  expect(result.personalised).toBe(false)
  expect(queryTutors.mock.calls[0][0].where.subjects.some).toEqual({ subject: 'Mathematics' })
  expect(result.tutors.every(t => t.match === null)).toBe(true)
})

test('level and grade can be searched without a subject and are applied to the same teaching row', async () => {
  const result = await browse({ level: 'PRIMARY', grade: '1' })
  expect(result.total).toBe(3)
  expect(queryTutors.mock.calls[0][0].where.subjects.some).toEqual({ educationLevel: 'PRIMARY', minGrade: { lte: 1 }, maxGrade: { gte: 1 } })
  expect(result.tutors.every(t => t.match === null)).toBe(true)
})

test('a level-only result shows a relevant subject even when its first teaching row is for another level', async () => {
  queryTutors.mockResolvedValue([teacher(4, { subjects: [
    { subject: 'Chemistry', educationLevel: 'SECONDARY', minGrade: 4, maxGrade: 5 },
    { subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 },
  ] })])
  const result = await browse({ level: 'PRIMARY', grade: '1' })
  expect(result.tutors[0].mainSubject).toBe('Mathematics')
})

test('complete teaching criteria still calculate real match scores without making the saved area a hard filter', async () => {
  const result = await browse({ subject: 'Mathematics', level: 'PRIMARY', grade: '5' })
  expect(result).toMatchObject({ total: 3, personalised: true, searchScope: { mode: 'ANY' } })
  expect(result.tutors.map(t => t.id)).toEqual(expect.arrayContaining([near.id, far.id, online.id]))
  expect(result.tutors.every(t => t.match.score > 0 && t.match.score <= 100)).toBe(true)
  expect(result.rankedBy).toContain('your saved preferences')
})

test('an explicit location still restricts physical results to nearby tutors', async () => {
  const result = await browse({ location: 'Kepong, Kuala Lumpur' })
  expect(result.searchScope.mode).toBe('PHYSICAL')
  expect(result.tutors.map(t => t.id)).toEqual([near.id])
  expect(result.tutors[0].match).toBeNull()
})

test('a distant area gives separately labelled online alternatives without requiring teaching criteria', async () => {
  queryTutors.mockResolvedValue([near, online])
  const result = await browse({ location: 'Kuala Terengganu, Terengganu' })
  expect(result.total).toBe(0)
  expect(result.onlineAlternatives.total).toBe(2)
  expect(result.onlineAlternatives.tutors.every(t => t.searchMode === 'ONLINE' && t.distanceKm === null && t.match === null)).toBe(true)
})

test('price and online filters still work without subject or level', async () => {
  const result = await browse({ maxPrice: '49', mode: 'ONLINE' })
  expect(result.tutors.map(t => t.id)).toEqual([online.id])
  expect(result.searchScope.mode).toBe('ONLINE')
})

test('unfiltered results remain paginated and clamp out-of-range pages', async () => {
  const result = await browse({ pageSize: '2', page: '99', sort: 'price_asc' })
  expect(result).toMatchObject({ total: 3, totalPages: 2, page: 2, pageSize: 2 })
  expect(result.tutors.map(t => t.id)).toEqual([near.id])
})

test.each([
  { grade: '5' }, { level: 'PRIMARY', grade: '7' },
  { subject: 'Chemistry', level: 'PRIMARY' }, { level: 'UNKNOWN' },
  { subject: 'Unknown subject' }, { minPrice: '80', maxPrice: '40' },
  { date: '2027-01-01' }, { time: '09:00' },
])('invalid partial criteria still fail validation: %o', async query => {
  await expect(browse(query)).rejects.toMatchObject({ name: 'ZodError' })
  expect(queryTutors).not.toHaveBeenCalled()
})

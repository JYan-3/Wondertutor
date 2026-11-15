import { prisma } from '../config/prisma.js'
import { api, makeAdmin, makeParent, resetDb, startServer, stopServer } from './helpers.js'

let admin, parent
beforeAll(async () => {
  await resetDb()
  await startServer()
  admin = await makeAdmin()
  parent = await makeParent()
  await prisma.complaint.createMany({ data: Array.from({ length: 28 }, (_, i) => ({
    filedById: parent.user.id, category: 'Other', description: 'Complaint pagination fixture ' + i,
    status: i < 25 ? 'OPEN' : 'RESOLVED', createdAt: new Date('2026-11-01T00:00:00Z'),
  })) })
})
afterAll(stopServer)

test('bounded pages keep counts and stable ordering even when dates are identical', async () => {
  const first = await api(admin.token).get('/admin/complaints?status=OPEN&page=1&pageSize=20')
  const next = await api(admin.token).get('/admin/complaints?status=OPEN&page=2&pageSize=20')
  expect(first.status).toBe(200)
  expect(first.pagination).toEqual({ page: 1, pageSize: 20, total: 25, totalPages: 2 })
  expect(first.counts).toEqual({ OPEN: 25, IN_PROGRESS: 0, RESOLVED: 3, DISMISSED: 0 })
  expect(first.complaints).toHaveLength(20)
  expect(next.complaints).toHaveLength(5)
  const ids = [...first.complaints, ...next.complaints].map(c => c.id)
  expect(new Set(ids).size).toBe(25)
  expect(ids).toEqual([...ids].sort((a, b) => b - a))
  expect(next.complaints.every(c => c.status === 'OPEN')).toBe(true)
})

test('removed or filtered-out final pages clamp to a usable page', async () => {
  const result = await api(admin.token).get('/admin/complaints?status=RESOLVED&page=999')
  expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 })
  expect(result.complaints).toHaveLength(3)
  const empty = await api(admin.token).get('/admin/complaints?status=DISMISSED&page=999')
  expect(empty.pagination).toMatchObject({ page: 1, total: 0, totalPages: 1 })
  expect(empty.complaints).toEqual([])
})

test('invalid or excessive page requests are rejected', async () => {
  for (const query of ['page=-1', 'page=1.5', 'pageSize=500', 'pageSize=0', 'status=INVALID'])
    expect((await api(admin.token).get('/admin/complaints?' + query)).status).toBe(400)
})

test('pagination never makes the admin complaint data public', async () => {
  expect((await api().get('/admin/complaints?page=2')).status).toBe(401)
  expect((await api(parent.token).get('/admin/complaints?page=2')).status).toBe(403)
})

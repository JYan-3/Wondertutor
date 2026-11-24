import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import ChildProgress from '../pages/parent/ChildProgress'
import MyChildren from '../pages/parent/MyChildren'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => ({ catalog: { subjects: ['Mathematics'], subjectLevels: { Mathematics: ['PRIMARY'] } }, refreshChildren: async () => {}, applyChild: () => {} }) }))
vi.mock('../components/PhotoPicker', () => ({ default: () => null }))

const child = { id: 7, publicId: 'a7c30849-4579-4d96-a355-c9e2c07fc6a3', name: 'Alya', educationLevel: 'PRIMARY', grade: 5, subjects: ['Mathematics'], bookingCount: 0 }

beforeEach(() => vi.resetAllMocks())

test('child cards open quizzes for the selected child even when children share a name', async () => {
  api.get.mockResolvedValue({ data: { children: [child, { ...child, id: 8, publicId: '8df149b4-e341-436b-958a-c39ca64322bc' }] } })
  render(<MemoryRouter><MyChildren /></MemoryRouter>)
  const cards = await screen.findAllByRole('article')
  expect(within(cards[0]).getByRole('link', { name: 'Practise quizzes' })).toHaveAttribute('href', `/parent/quizzes?child=${child.publicId}`)
  expect(within(cards[1]).getByRole('link', { name: 'Practise quizzes' })).toHaveAttribute('href', '/parent/quizzes?child=8df149b4-e341-436b-958a-c39ca64322bc')
})

test.each([child, { ...child, publicId: undefined }])('learning progress keeps the child context when opening quizzes (%j)', async learner => {
  api.get.mockResolvedValue({ data: { child: learner, stats: { completedLessons: 0, totalHours: 0, summariesReceived: 0, physicalLessons: 0 }, subjects: [], timeline: [], nextLesson: null } })
  render(<MemoryRouter initialEntries={['/parent/children/7/progress']}><Routes><Route path="/parent/children/:id/progress" element={<ChildProgress />} /></Routes></MemoryRouter>)
  expect(await screen.findByRole('link', { name: 'Practise quizzes' })).toHaveAttribute('href', `/parent/quizzes?child=${learner.publicId || learner.id}`)
  expect(screen.getByRole('link', { name: 'Progress report' })).toHaveAttribute('href', `/parent/children/${learner.publicId || learner.id}/report`)
})

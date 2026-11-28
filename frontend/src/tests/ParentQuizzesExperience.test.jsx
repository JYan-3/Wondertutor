import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ParentQuizzes from '../pages/parent/Quizzes'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))

const quiz = { id: 1, versionId: 2, title: 'Fractions', subject: 'Mathematics', level: 'PRIMARY', grade: 5, tutor: 'Iris', description: 'Practice', questions: [
  { type: 'CHOICE', text: 'Which fraction?', points: 1, options: ['One', 'Two'] },
  { type: 'SHORT', text: 'Type a number', points: 1 },
  { type: 'LONG', text: 'Explain your answer', points: 2 },
] }
const setupApi = () => api.get.mockImplementation(path => {
  if (path.includes('/leaderboard')) return Promise.resolve({ data: { leaderboard: [{ rank: 1, nickname: 'Star', score: 3, maxScore: 4 }] } })
  if (path === '/parent/quizzes') return Promise.resolve({ data: { quizzes: [quiz] } })
  if (path === '/parent/children') return Promise.resolve({ data: { children: [{ id: 3, name: 'Alya' }] } })
  return Promise.resolve({ data: { attempts: [] } })
})

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

test('progress and question navigation keep answers without revealing correctness', async () => {
  setupApi()
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  const progress = screen.getByRole('progressbar', { name: 'Questions answered' })
  expect(progress).toHaveAttribute('aria-valuenow', '0')
  fireEvent.click(screen.getByLabelText('Two'))
  expect(progress).toHaveAttribute('aria-valuenow', '1')
  expect(screen.getByText('Selected')).toBeVisible()
  expect(screen.queryByText(/Correct answer:/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Question 3, not answered' }))
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'My explanation' } })
  expect(progress).toHaveAttribute('aria-valuenow', '2')
  fireEvent.click(screen.getByRole('button', { name: 'Question 1, answered' }))
  expect(screen.getByLabelText('Two')).toBeChecked()
})

test('a parent can explore the leaderboard and return to the quizzes', async () => {
  setupApi()
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Leaderboard' }))
  expect(await screen.findByRole('heading', { name: 'Fractions leaderboard' })).toBeVisible()
  expect(screen.getByText('Star')).toBeVisible()
  expect(screen.getByText('3 / 4')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Back to quizzes' }))
  expect(screen.getByRole('heading', { name: 'Fractions' })).toBeVisible()
})

test('a parent can report a quiz without leaving the page', async () => {
  setupApi()
  api.post.mockResolvedValue({ data: { id: 1 } })
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Report quiz' }))
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Please review this question.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
  expect(await screen.findByText('Your report was sent to admin for review.')).toBeVisible()
  expect(api.post).toHaveBeenCalledWith('/parent/quizzes/1/report', { reason: 'Please review this question.' })
})

test('the quiz shows the current leaderboard while answers stay in place', async () => {
  setupApi()
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  fireEvent.click(screen.getByLabelText('Two'))
  const leaderboard = screen.getByRole('complementary', { name: 'Leaderboard' })
  expect(await within(leaderboard).findByText('Star')).toBeVisible()
  expect(within(leaderboard).getByText('3 / 4')).toBeVisible()
  expect(screen.getByLabelText('Two')).toBeChecked()
  expect(api.get).toHaveBeenCalledWith('/parent/quizzes/1/leaderboard?version=2')
})

test('the leaderboard can be retried without losing an answer', async () => {
  setupApi()
  const get = api.get.getMockImplementation()
  let calls = 0
  api.get.mockImplementation(path => path.includes('/leaderboard') && calls++ === 0 ? Promise.reject(new Error('Offline')) : get(path))
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  fireEvent.click(screen.getByLabelText('Two'))
  const leaderboard = screen.getByRole('complementary', { name: 'Leaderboard' })
  expect(await within(leaderboard).findByText('Could not load the leaderboard.')).toBeVisible()
  fireEvent.click(within(leaderboard).getByRole('button', { name: 'Try again' }))
  expect(await within(leaderboard).findByText('Star')).toBeVisible()
  expect(screen.getByLabelText('Two')).toBeChecked()
})

test('loading does not show a false empty state', async () => {
  let finish
  api.get.mockImplementation(path => path === '/parent/quizzes' ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ data: path === '/parent/children' ? { children: [] } : { attempts: [] } }))
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  expect(screen.getByRole('status')).toHaveTextContent('Loading quizzes')
  expect(screen.queryByText('No quizzes found.')).not.toBeInTheDocument()
  finish({ data: { quizzes: [] } })
  expect(await screen.findByText('No quizzes found.')).toBeVisible()
})

test('a failed quiz load can be retried', async () => {
  setupApi()
  api.get.mockRejectedValueOnce(new Error('Could not load quizzes'))
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  expect(await screen.findByText('Could not load quizzes')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: 'Fractions' })).toBeVisible()
})

test('search and subject filters narrow the quiz cards', async () => {
  setupApi()
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Fractions' })
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Science' } })
  expect(screen.getByText('No quizzes found.')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Mathematics' } })
  expect(within(screen.getByRole('article')).getByRole('heading', { name: 'Fractions' })).toBeVisible()
})

test('leaving an answered quiz asks before discarding the answers', async () => {
  setupApi()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<MemoryRouter><ParentQuizzes /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  fireEvent.click(screen.getByLabelText('One'))
  fireEvent.click(screen.getByRole('button', { name: 'Back to quizzes' }))
  expect(confirm).toHaveBeenCalledWith('Discard your answers?')
  expect(screen.getByLabelText('One')).toBeChecked()
  await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Questions answered' })).toHaveAttribute('aria-valuenow', '1'))
})

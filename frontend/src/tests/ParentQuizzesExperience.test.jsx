import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
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

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); vi.spyOn(window, 'confirm').mockReturnValue(true) })
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

const learner = { id: 3, publicId: '3e5af39c-7fd1-4ae1-90c7-2ba375152229', name: 'Alya' }
const sibling = { id: 8, publicId: '4b86bdc3-d8cb-49ec-bf48-501b1b51940f', name: 'Ben' }
const singleQuiz = { ...quiz, questions: [quiz.questions[0]] }
const attempt = (id = 4, title = 'Published fractions') => ({
  id, child: learner, createdAt: '2026-11-24T08:30:00.000Z', status: 'MARKED', score: 1, maxScore: 1,
  answers: [{ answer: '1', score: 1 }],
  version: { quizId: 1, quiz: { title: 'Renamed draft' }, content: { title, questions: [{ ...singleQuiz.questions[0], correct: 1 }] } },
})
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const setupFlowApi = ({ kids = [learner, sibling], attempts = [], quizzes = [singleQuiz] } = {}) => {
  api.get.mockImplementation(path => {
    if (path === '/parent/quizzes') return Promise.resolve({ data: { quizzes } })
    if (path === '/parent/children') return Promise.resolve({ data: { children: kids } })
    if (path === '/parent/quiz-attempts') return Promise.resolve({ data: { attempts } })
    if (path.includes('/leaderboard')) return Promise.resolve({ data: { leaderboard: [] } })
    return Promise.resolve({ data: attempt(Number(path.split('/').at(-1))) })
  })
}
function NavigationControls() {
  const navigate = useNavigate(), location = useLocation()
  return <><button onClick={() => navigate(`/parent/quizzes?child=${learner.publicId}&attempt=4`)}>Open marked attempt</button><button onClick={() => navigate(`/parent/quizzes?child=${learner.publicId}&attempt=5`)}>Open another attempt</button><span data-testid="quiz-location">{location.search}</span></>
}
function renderFlow(search = '') {
  return render(<MemoryRouter initialEntries={[`/parent/quizzes${search}`]}><NavigationControls /><ParentQuizzes /></MemoryRouter>)
}

test('a child selected by link can submit privately without a leaderboard nickname', async () => {
  setupFlowApi()
  api.post.mockResolvedValue({ data: { id: 4 } })
  renderFlow(`?child=${learner.publicId}`)
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  fireEvent.click(screen.getByLabelText('Show this child’s result on the leaderboard'))
  expect(screen.queryByLabelText(/Leaderboard nickname/)).toBeNull()
  fireEvent.click(screen.getByLabelText('Two'))
  fireEvent.click(screen.getByRole('button', { name: 'Review answers' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm submission' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/parent/quizzes/1/attempts', expect.objectContaining({ childId: 3, nickname: '', showOnLeaderboard: false })))
})

test.each([learner.publicId, String(learner.id)])('a child link using %s preselects the learner and filters attempts', async reference => {
  setupFlowApi({ attempts: [attempt(), { ...attempt(5, 'Other exercise'), child: sibling }] })
  renderFlow(`?child=${reference}`)
  expect(await screen.findByLabelText('Attempts for')).toHaveValue('3')
  expect(screen.getByRole('button', { name: /Alya.*Published fractions/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: /Ben.*Other exercise/ })).not.toBeInTheDocument()
  expect(screen.getByText('Tue, 24 Nov 2026')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }))
  expect(screen.getByLabelText('Choose your child')).toHaveValue('3')
})

test('parents without children get an Add a child action before starting', async () => {
  setupFlowApi({ kids: [] })
  renderFlow()
  expect(await screen.findByRole('link', { name: 'Add a child' })).toHaveAttribute('href', '/parent/children?add=1')
  expect(screen.getByRole('button', { name: 'Start quiz' })).toBeDisabled()
})

test('back clears an attempt link and a late result cannot replace the catalogue', async () => {
  setupFlowApi()
  const get = api.get.getMockImplementation(), response = deferred()
  api.get.mockImplementation(path => path === '/parent/quiz-attempts/4' ? response.promise : get(path))
  renderFlow(`?child=${learner.publicId}&attempt=4`)
  expect(screen.getByRole('status')).toHaveTextContent('Loading quiz result')
  expect(screen.queryByRole('heading', { name: 'Quizzes to explore' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to quizzes' }))
  expect(screen.getByTestId('quiz-location')).toHaveTextContent(`?child=${learner.publicId}`)
  await act(async () => response.resolve({ data: attempt() }))
  expect(await screen.findByRole('button', { name: 'Start quiz' })).toBeVisible()
  expect(screen.queryByText('Final score: 1 / 1')).not.toBeInTheDocument()
})

test('a newer notification result wins when an older request finishes later', async () => {
  setupFlowApi()
  const get = api.get.getMockImplementation(), earlier = deferred(), later = deferred()
  api.get.mockImplementation(path => path === '/parent/quiz-attempts/4' ? earlier.promise : path === '/parent/quiz-attempts/5' ? later.promise : get(path))
  renderFlow('?attempt=4')
  fireEvent.click(screen.getByRole('button', { name: 'Open another attempt' }))
  await act(async () => later.resolve({ data: attempt(5, 'Latest published quiz') }))
  expect(screen.getByRole('heading', { name: 'Latest published quiz' })).toBeVisible()
  expect(screen.getByText('Tue, 24 Nov 2026').parentElement).toHaveTextContent('Alya')
  await act(async () => earlier.resolve({ data: attempt(4, 'Older quiz') }))
  expect(screen.queryByRole('heading', { name: 'Older quiz' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Latest published quiz' })).toBeVisible()
})

test('a result-ready notification refreshes the same open attempt and preserves the child and history', async () => {
  const pending = { ...attempt(), status: 'PENDING', score: 0 }
  setupFlowApi({ attempts: [pending, { ...attempt(5, 'Sibling exercise'), child: sibling }] })
  const get = api.get.getMockImplementation()
  let resultReads = 0
  api.get.mockImplementation(path => path === '/parent/quiz-attempts/4'
    ? Promise.resolve({ data: resultReads++ === 0 ? pending : { ...attempt(), advice: 'Well explained.' } })
    : get(path))
  renderFlow(`?child=${learner.publicId}&attempt=4`)
  expect(await screen.findByText('Awaiting tutor review · 0 / 1 points marked so far')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Open marked attempt' }))
  expect(await screen.findByText('Final score: 1 / 1')).toBeVisible()
  expect(screen.getByText('Well explained.', { exact: false })).toBeVisible()
  expect(resultReads).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: 'Back to quizzes' }))
  expect(screen.getByLabelText('Attempts for')).toHaveValue('3')
  expect(screen.getByRole('button', { name: /Alya.*Published fractions/ })).toHaveTextContent('1 / 1')
  expect(screen.queryByRole('button', { name: /Ben.*Sibling exercise/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('pending results can be refreshed and a failed refresh is retried without submitting again', async () => {
  const pending = { ...attempt(), status: 'PENDING', score: 0 }
  setupFlowApi({ attempts: [pending] })
  const get = api.get.getMockImplementation()
  let resultReads = 0
  api.get.mockImplementation(path => {
    if (path !== '/parent/quiz-attempts/4') return get(path)
    resultReads++
    if (resultReads === 2) return Promise.reject(new Error('Result temporarily unavailable'))
    return Promise.resolve({ data: resultReads === 1 ? pending : attempt() })
  })
  renderFlow(`?child=${learner.publicId}&attempt=4`)
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh result' }))
  expect(await screen.findByText('Result temporarily unavailable')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading result' }))
  expect(await screen.findByText('Final score: 1 / 1')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Refresh result' })).not.toBeInTheDocument()
  expect(screen.getByTestId('quiz-location')).toHaveTextContent(`?child=${learner.publicId}&attempt=4`)
  expect(api.post).not.toHaveBeenCalled()
})

test('a newer read of the same attempt wins when an older notification read finishes later', async () => {
  setupFlowApi()
  const get = api.get.getMockImplementation(), earlier = deferred(), later = deferred()
  let resultReads = 0
  api.get.mockImplementation(path => path === '/parent/quiz-attempts/4'
    ? resultReads++ === 0 ? earlier.promise : later.promise
    : get(path))
  renderFlow(`?child=${learner.publicId}&attempt=4`)
  fireEvent.click(screen.getByRole('button', { name: 'Open marked attempt' }))
  await act(async () => later.resolve({ data: attempt() }))
  expect(screen.getByText('Final score: 1 / 1')).toBeVisible()
  await act(async () => earlier.resolve({ data: { ...attempt(), status: 'PENDING', score: 0 } }))
  expect(screen.queryByText(/Awaiting tutor review/)).not.toBeInTheDocument()
  expect(screen.getByText('Final score: 1 / 1')).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

test('opening a marked attempt asks before replacing unfinished quiz answers', async () => {
  setupFlowApi()
  renderFlow(`?child=${learner.publicId}`)
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  fireEvent.click(screen.getByLabelText('Two'))
  window.confirm.mockReturnValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: 'Open marked attempt' }))
  expect(window.confirm).toHaveBeenCalledWith('Discard your answers and view this result?')
  expect(screen.getByLabelText('Two')).toBeChecked()
  expect(screen.getByTestId('quiz-location')).not.toHaveTextContent('attempt=')
  expect(api.get).not.toHaveBeenCalledWith('/parent/quiz-attempts/4')
  fireEvent.click(screen.getByRole('button', { name: 'Open marked attempt' }))
  expect(await screen.findByRole('heading', { name: 'Published fractions' })).toBeVisible()
  expect(screen.queryByLabelText('Two')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Renamed draft' })).not.toBeInTheDocument()
})

test('an accepted submission recovers failed result and history reads without submitting again', async () => {
  setupFlowApi()
  const get = api.get.getMockImplementation(), submission = deferred()
  let resultReads = 0, historyReads = 0
  api.get.mockImplementation(path => {
    if (path === '/parent/quiz-attempts/4' && resultReads++ === 0) return Promise.reject(new Error('Result temporarily unavailable'))
    if (path === '/parent/quiz-attempts' && historyReads++ === 1) return Promise.reject(new Error('History temporarily unavailable'))
    return get(path)
  })
  api.post.mockReturnValue(submission.promise)
  renderFlow(`?child=${learner.publicId}`)
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  fireEvent.change(screen.getByLabelText(/Leaderboard nickname/), { target: { value: 'Star' } })
  fireEvent.click(screen.getByLabelText('Two'))
  fireEvent.click(screen.getByRole('button', { name: 'Review answers' }))
  const form = screen.getByRole('button', { name: 'Confirm submission' }).closest('form')
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Choose your child')).toBeDisabled()
  expect(screen.getByLabelText(/Leaderboard nickname/)).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Continue editing' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Back to quizzes' })).toBeDisabled()
  await act(async () => submission.resolve({ data: { id: 4 } }))
  expect(await screen.findByRole('heading', { name: 'Quiz submitted' })).toBeVisible()
  expect(screen.getByText('Your quiz was submitted, but the attempt list could not refresh.')).toBeVisible()
  expect(screen.getByTestId('quiz-location')).toHaveTextContent('attempt=4')
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading result' }))
  expect(await screen.findByText('Final score: 1 / 1')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh attempts' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Refresh attempts' })).not.toBeInTheDocument())
  expect(api.post).toHaveBeenCalledTimes(1)
})

test('question navigation brings keyboard focus to the active question and review', async () => {
  setupApi()
  renderFlow()
  fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }))
  expect(screen.getByRole('heading', { name: 'Question 1 of 3' })).not.toHaveFocus()
  fireEvent.change(screen.getByLabelText('Choose your child'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText(/Leaderboard nickname/), { target: { value: 'Star' } })
  fireEvent.click(screen.getByLabelText('Two'))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Question 2 of 3' })).toHaveFocus()
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Explanation' } })
  fireEvent.click(screen.getByRole('button', { name: 'Review answers' }))
  expect(screen.getByLabelText('Review your answers')).toHaveFocus()
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit answer' })[0])
  expect(screen.getByRole('heading', { name: 'Question 1 of 3' })).toHaveFocus()
})

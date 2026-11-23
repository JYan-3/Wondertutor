import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const setUser = vi.fn()
let authUser
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: authUser, setUser }) }))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))
vi.mock('../components/PhotoPicker', async (importOriginal) => ({ ...await importOriginal(), uploadDocument: vi.fn() }))

import api from '../api/client'
import ProfileSetup from '../pages/tutor/ProfileSetup'
import { uploadDocument } from '../components/PhotoPicker'
import { checkStep } from '../lib/tutorSetup'

const CATALOG = {
  subjects: ['Mathematics', 'English'], locations: ['Petaling Jaya, Selangor', 'Kepong, Kuala Lumpur'],
  characteristics: ['Structured'], languages: ['English'], maxGrade: { KINDERGARTEN: 3, PRIMARY: 6, SECONDARY: 5 },
}
// A brand-new tutor straight after sign-up: only the account details exist
const NEW_TUTOR = {
  status: 'NOT_SUBMITTED', submittedAt: null, isVerified: false, fullName: 'Daniel Tan', email: 'daniel@example.com', isEmailVerified: true,
  phone: '+60123456789', profilePhotoUrl: null, gender: null, emergencyContactName: null, emergencyContactPhone: null, location: null,
  bio: null, teachingApproach: null, yearsExperience: 0, hourlyRate: 0, offersPhysical: true, offersOnline: false,
  languages: [], characteristics: [], subjects: [], documents: [], portfolio: [], missing: ['Gender'],
}
const COMPLETE = {
  ...NEW_TUTOR, gender: 'MALE', emergencyContactName: 'Lisa Tan', emergencyContactPhone: '+60120000000', location: 'Petaling Jaya, Selangor',
  bio: 'Mathematics tutor helping Form 1-5 students build confidence.', hourlyRate: 60, yearsExperience: 4,
  subjects: [{ subject: 'Mathematics', educationLevel: 'SECONDARY', minGrade: 1, maxGrade: 5 }],
  documents: [
    { id: 1, kind: 'IDENTITY', title: 'NRIC', status: 'PENDING', documentUrl: '/tutor/documents/1/file' },
    { id: 2, kind: 'QUALIFICATION', title: 'BSc Mathematics', status: 'PENDING', documentUrl: '/tutor/documents/2/file' },
  ],
  profilePhotoUrl: 'https://res.cloudinary.com/x/me.jpg', missing: [],
}

function setup(profile) {
  api.get.mockImplementation((url) => Promise.resolve({ data: url === '/tutor/catalog' ? CATALOG : profile }))
  api.put.mockImplementation((url, body) => Promise.resolve({ data: { ...profile, ...body } }))
  api.post.mockResolvedValue({ data: { ...profile, status: 'UNDER_REVIEW' } })
  return render(<MemoryRouter><ProfileSetup /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  authUser = { id: 12, role: 'TUTOR', tutorStatus: 'NOT_SUBMITTED' }
  setUser.mockImplementation((update) => { authUser = typeof update === 'function' ? update(authUser) : update })
})

describe('tutor profile setup', () => {
  test('Save and continue is blocked while a required field is missing, and nothing is saved', async () => {
    setup(NEW_TUTOR)
    await userEvent.click(await screen.findByRole('button', { name: 'Save and continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/emergency contact name|gender/i)
    expect(api.put).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Basic information' })).toBeInTheDocument()
  })

  test('a complete basic step is saved on its own and the wizard moves on', async () => {
    setup(NEW_TUTOR)
    await userEvent.click(await screen.findByRole('radio', { name: 'Male' }))
    await userEvent.type(screen.getByLabelText(/Emergency contact name/), 'Lisa Tan')
    await userEvent.type(screen.getByLabelText(/Emergency contact number/), '012-000 0000')
    await userEvent.selectOptions(screen.getByLabelText(/Home area/), 'Petaling Jaya, Selangor')
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(api.put).toHaveBeenCalledWith('/tutor/profile', {
      fullName: 'Daniel Tan', phone: '+60123456789', gender: 'MALE',
      emergencyContactName: 'Lisa Tan', emergencyContactPhone: '+60120000000', location: 'Petaling Jaya, Selangor',
    })
    expect(await screen.findByRole('heading', { name: 'Teaching information' })).toBeInTheDocument()
  })

  test('submit stays disabled until the confirmation box is ticked', async () => {
    setup(COMPLETE)
    await userEvent.click(await screen.findByRole('button', { name: /Review and submit/ }))
    const submit = screen.getByRole('button', { name: 'Submit for verification' })
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /I confirm the information is true/ }))
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    expect(api.post).toHaveBeenCalledWith('/tutor/submit-for-verification')
  })

  test('a tutor can keep default initials, finish the photo step and submit for verification', async () => {
    setup({ ...COMPLETE, profilePhotoUrl: null })
    expect(await screen.findByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuenow', '100')
    await userEvent.click(screen.getByRole('button', { name: /Photo and portfolio/ }))
    expect(screen.getByText(/Your name initials are shown by default/)).toBeInTheDocument()
    expect(screen.getByText('DT')).toHaveAttribute('aria-label', 'Daniel Tan')
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(await screen.findByText('Name initials (default)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /I confirm the information is true/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit for verification' }))
    expect(api.post).toHaveBeenCalledWith('/tutor/submit-for-verification')
  })
})

describe('verification on My Profile', () => {
  test('a tutor can skip qualifications and finish without submitting for verification', async () => {
    setup({ ...COMPLETE, documents: [] })
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await userEvent.click(screen.getByRole('button', { name: /Review and submit/ }))
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
    expect(api.post).not.toHaveBeenCalled()
  })
  test('a new tutor sees that nothing has been submitted', async () => {
    setup(NEW_TUTOR)
    expect(await screen.findByRole('heading', { name: 'Verification' })).toBeInTheDocument()
    expect(screen.getByText('Not submitted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload a new document' })).not.toBeInTheDocument()
  })

  test('a verified tutor sees the verified state', async () => {
    setup({ ...COMPLETE, status: 'VERIFIED', isVerified: true, submittedAt: '2026-10-20T10:00:00Z', documents: COMPLETE.documents.map((d) => ({ ...d, status: 'APPROVED' })) })
    expect(await screen.findByText('Verified', { selector: 'section span' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Preview my profile' })).toHaveAttribute('href', '/tutor/preview')
  })

  test("a rejected document shows Admin's reason and the button opens the Qualifications step", async () => {
    const documents = [{ ...COMPLETE.documents[0], status: 'REJECTED', reviewNote: 'Photo is blurry' }, COMPLETE.documents[1]]
    setup({ ...COMPLETE, status: 'CHANGES_REQUESTED', submittedAt: '2026-10-20T10:00:00Z', documents })
    expect(await screen.findByText('Changes requested')).toBeInTheDocument()
    expect(screen.getByText(/Photo is blurry/, { selector: 'li' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upload a new document' }))
    expect(await screen.findByRole('heading', { name: 'Qualifications' })).toBeInTheDocument()
  })

  test('a removed document is listed as missing', async () => {
    setup({ ...COMPLETE, status: 'CHANGES_REQUESTED', submittedAt: '2026-10-20T10:00:00Z', documents: [COMPLETE.documents[1]] })
    expect(await screen.findByText(/none uploaded/)).toHaveTextContent('Identity document')
  })
})

describe('tutor profile setup: editing and documents', () => {
  test('shows the server validation message and keeps existing documents when an upload is unreadable', async () => {
    const { container } = setup(COMPLETE)
    uploadDocument.mockResolvedValue('https://example.test/private.pdf')
    api.post.mockRejectedValue({ response: { status: 422, data: { message: 'The PDF must contain no more than 30 pages.' } } })
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    await userEvent.type(screen.getByLabelText('Document name'), 'Identity')
    await userEvent.upload(container.querySelector('input[type="file"]'), new File(['document'], 'identity.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The PDF must contain no more than 30 pages.')
    expect(screen.getByRole('link', { name: 'NRIC' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'BSc Mathematics' })).toBeVisible()
  })
  test('retries a cleanup failure using the same upload instead of uploading another file', async () => {
    const { container } = setup(COMPLETE)
    uploadDocument.mockResolvedValue('https://example.test/private.pdf')
    api.post.mockRejectedValueOnce({ response: { status: 503, data: { message: 'Could not remove the rejected upload. Please retry the same upload.' } } })
      .mockRejectedValueOnce({ response: { status: 422, data: { message: 'The PDF is invalid.' } } })
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    await userEvent.type(screen.getByLabelText('Document name'), 'Identity')
    await userEvent.upload(container.querySelector('input[type="file"]'), new File(['document'], 'identity.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry the same upload')
    expect(screen.getByRole('button', { name: 'Change file' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The PDF is invalid.')
    expect(uploadDocument).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Change file' })).toBeEnabled()
  })
  test('allows a new file when the queued cleanup already removed the earlier upload', async () => {
    const { container } = setup(COMPLETE)
    uploadDocument.mockResolvedValue('https://example.test/private.pdf')
    api.post.mockRejectedValueOnce({ response: { status: 503, data: { message: 'Please retry the same upload.' } } })
      .mockRejectedValueOnce({ response: { status: 404, data: { message: 'The uploaded document is no longer available. Please choose a file again.' } } })
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    await userEvent.type(screen.getByLabelText('Document name'), 'Identity')
    await userEvent.upload(container.querySelector('input[type="file"]'), new File(['document'], 'identity.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Retry upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose a file again.')
    expect(screen.getByRole('button', { name: 'Change file' })).toBeEnabled()
    expect(uploadDocument).toHaveBeenCalledTimes(1)
  })
  test('a tutor can open the private watermarked document before submitting', async () => {
    setup(COMPLETE)
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    expect(screen.getByRole('link', { name: 'NRIC' })).toHaveAttribute('href', '/api/tutor/documents/1/file')
    expect(screen.getAllByText('View watermarked copy')).toHaveLength(2)
    expect(screen.getByText(/PDFs can have up to 30 pages/)).toBeVisible()
  })
  test('explains when a removed document shares its file with another record', async () => {
    setup(COMPLETE)
    api.delete.mockResolvedValue({ data: { ok: true, fileRetained: true } })
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove NRIC' }))
    expect(await screen.findByRole('status')).toHaveTextContent('The file is still kept because another document uses it.')
  })
  test('keeps the document visible when removal fails', async () => {
    setup(COMPLETE)
    api.delete.mockRejectedValue(new Error('Could not remove the document. Please try again.'))
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove NRIC' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove the document. Please try again.')
    expect(screen.getByRole('link', { name: 'NRIC' })).toBeVisible()
  })
  test('explains when removal succeeded but refreshing the profile failed', async () => {
    setup(COMPLETE)
    api.delete.mockResolvedValue({ data: { ok: true, isVerified: false, fileRetained: false } })
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    api.get.mockRejectedValue(new Error('Offline'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove NRIC' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The document was removed, but your profile could not be refreshed.')
    expect(screen.queryByRole('link', { name: 'NRIC' })).toBeNull()
    expect(screen.getByRole('link', { name: 'BSc Mathematics' })).toBeVisible()
  })
  test('Back keeps what was typed in the step', async () => {
    setup(COMPLETE)
    await userEvent.clear(await screen.findByLabelText(/Emergency contact name/))
    await userEvent.type(screen.getByLabelText(/Emergency contact name/), 'Ahmad Faiz')
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    await screen.findByRole('heading', { name: 'Teaching information' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText(/Emergency contact name/)).toHaveValue('Ahmad Faiz')
  })

  test('a double click on submit sends one request', async () => {
    setup(COMPLETE)
    let release
    api.post.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: { ...COMPLETE, status: 'UNDER_REVIEW' } }) }))
    await userEvent.click(await screen.findByRole('button', { name: /Review and submit/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /I confirm the information is true/ }))
    await userEvent.dblClick(screen.getByRole('button', { name: 'Submit for verification' }))
    expect(api.post).toHaveBeenCalledTimes(1)
    release()
  })

  test('removing an approved document asks first and does nothing when cancelled', async () => {
    const approved = { ...COMPLETE, documents: COMPLETE.documents.map((d) => ({ ...d, status: 'APPROVED' })) }
    setup(approved)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await userEvent.click(await screen.findByRole('button', { name: /Qualifications/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove NRIC' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/verified badge is put on hold/))
    expect(api.delete).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})

describe('setup step checks (mirror the server)', () => {
  test.each([null, 'https://lh3.googleusercontent.com/a/photo', COMPLETE.profilePhotoUrl])('a profile photo is optional: %s', (profilePhotoUrl) => {
    expect(checkStep('photo', {}, { profilePhotoUrl })).toBe('')
  })

  const form = { fullName: 'Daniel Tan', phone: '0123456789', gender: 'MALE', emergencyContactName: 'Lisa Tan', emergencyContactPhone: '0123456789', location: 'Kepong, Kuala Lumpur' }
  test('the emergency contact must be someone else', () => {
    expect(checkStep('basic', form, NEW_TUTOR)).toMatch(/different from your own number/)
  })
  test('documents need an identity document and a qualification that are not rejected', () => {
    expect(checkStep('documents', {}, { documents: [{ kind: 'QUALIFICATION', status: 'PENDING' }] })).toMatch(/NRIC or passport/)
    expect(checkStep('documents', {}, { documents: [{ kind: 'IDENTITY', status: 'REJECTED' }, { kind: 'QUALIFICATION', status: 'APPROVED' }] })).toMatch(/NRIC or passport/)
    expect(checkStep('documents', {}, COMPLETE)).toBe('')
  })
  test('the hourly rate follows the same RM rule as the server', () => {
    const teaching = { subjects: COMPLETE.subjects, hourlyRate: '60.555', yearsExperience: '4', offersPhysical: true, offersOnline: false, bio: COMPLETE.bio, teachingApproach: '' }
    expect(checkStep('teaching', teaching, COMPLETE)).toMatch(/2 decimal places/)
    expect(checkStep('teaching', { ...teaching, hourlyRate: '60' }, COMPLETE)).toBe('')
  })
})

describe('profile responses belong to the signed-in tutor', () => {
  test.each([null, { id: 99, role: 'TUTOR', tutorStatus: 'NOT_SUBMITTED', fullName: 'Different tutor' }])('a late profile read cannot change the next session: %s', async (nextUser) => {
    let finish
    api.get.mockImplementation((url) => url === '/tutor/catalog'
      ? Promise.resolve({ data: CATALOG })
      : new Promise((resolve) => { finish = () => resolve({ data: { ...COMPLETE, status: 'VERIFIED' } }) }))
    const { unmount } = render(<MemoryRouter><ProfileSetup /></MemoryRouter>)
    unmount()
    authUser = nextUser
    await act(async () => finish())
    expect(authUser).toBe(nextUser)
    const update = setUser.mock.calls.at(-1)[0]
    expect(() => update(null)).not.toThrow()
    expect(update(null)).toBeNull()
  })

  test('a late save cannot restore the old tutor after logout', async () => {
    const { unmount } = setup(COMPLETE)
    let finish
    api.put.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ data: COMPLETE }) }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save and continue' }))
    unmount()
    authUser = null
    await act(async () => finish())
    expect(authUser).toBeNull()
  })
})

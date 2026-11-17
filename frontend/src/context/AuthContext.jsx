import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import api, { clearCsrfToken, errorMessage, isCurrentSessionRequest, setCsrfToken } from '../api/client'
import SessionIdleGuard from '../components/SessionIdleGuard'

const AuthContext = createContext(null)

// Login-related calls answer 401 for a wrong password; that is not an expired session
const AUTH_CALL = /\/auth\/(login|google|register|verify-otp|resend-otp|forgot-password|reset-password)/

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [sessionTiming, setSessionTiming] = useState(null)
  const timingRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')
  // An explicit logout starts the next account at its dashboard. A forced
  // reauthentication may resume a page only for the account that was using it.
  const [sessionEnd, setSessionEnd] = useState(null)
  const userRef = useRef(null)
  const request = useRef(0)
  // Why the user was sent back to Log In (expired session, deactivated account); shown once on the login page
  const [notice, setNotice] = useState('')

  // If the server stops accepting the saved login (it expired, or Admin deactivated the account while it was open),
  // end the session everywhere at once. The protected pages then send the user to Log In with the reason,
  // instead of every page showing its own error while the app still looks logged in.
  useEffect(() => {
    const id = api.interceptors.response.use(undefined, (err) => {
      const status = err?.response?.status
      const message = err?.response?.data?.message || ''
      const ended = status === 401 || (status === 403 && /deactivated/i.test(message))
      if (userRef.current && ended && isCurrentSessionRequest(err.config) && !['/auth/me', '/auth/activity'].includes(err.config?.url) && !AUTH_CALL.test(err.config?.url || '')) {
        setSessionEnd({ reason: 'expired', userId: userRef.current.id })
        clearCsrfToken()
        userRef.current = null
        setUser(null)
        timingRef.current = null
        setSessionTiming(null)
        setSessionError('')
        setNotice(status === 401 ? 'Your session has expired. Please log in again.' : message)
      }
      return Promise.reject(err)
    })
    return () => api.interceptors.response.eject(id)
  }, [])

  // Cookies are intentionally unreadable, so ask the server on every reload.
  // A temporary outage is not evidence that the person has been logged out.
  const refreshSession = useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    setSessionError('')
    try {
      const res = await api.get('/auth/me')
      if (current !== request.current) return
      userRef.current = res.data.user
      setUser(res.data.user)
      timingRef.current = res.data.session || null
      setSessionTiming(timingRef.current)
      if (res.data.csrfToken) setCsrfToken(res.data.csrfToken)
    } catch (err) {
      if (current !== request.current) return
      if (err.response?.status === 401 || (err.response?.status === 403 && /deactivated/i.test(err.response.data?.message || ''))) {
        if (userRef.current) setSessionEnd({ reason: 'expired', userId: userRef.current.id })
        userRef.current = null
        setUser(null)
        timingRef.current = null
        setSessionTiming(null)
        clearCsrfToken()
        if (err.response.status === 403) setNotice(err.response.data.message)
      } else setSessionError(errorMessage(err))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Remove credentials left by versions of the app predating cookie sessions.
    try { localStorage.removeItem('wt_token'); sessionStorage.removeItem('wt_token') } catch { /* Storage may be disabled; cookies still work. */ }
    refreshSession()
    return () => { ++request.current }
  }, [refreshSession])

  function saveSession(user, csrfToken, session = null) {
    ++request.current
    userRef.current = user
    setUser(user)
    timingRef.current = session
    setSessionTiming(session)
    setSessionError('')
    setSessionEnd(null)
    setLoading(false)
    if (csrfToken) setCsrfToken(csrfToken)
  }

  async function login(email, password, remember, recaptchaToken, portal) {
    setNotice('')
    const res = await api.post('/auth/login', { email, password, remember: Boolean(remember), recaptchaToken: recaptchaToken || undefined, ...(portal === 'ADMIN' && { portal }) })
    saveSession(res.data.user, res.data.csrfToken, res.data.session)
    return res.data.user
  }

  // acceptedPrivacy is only sent by screens that show the Privacy Notice next to the button (new accounts need it)
  async function googleLogin(credential, role, acceptedPrivacy = false) {
    setNotice('')
    const res = await api.post('/auth/google', { credential, role, ...(acceptedPrivacy && { acceptedPrivacy: true }) })
    saveSession(res.data.user, res.data.csrfToken, res.data.session)
    return res.data.user
  }

  const logout = useCallback(async (message) => {
    await api.post('/auth/logout')
    ++request.current
    setSessionEnd({ reason: 'logout', userId: userRef.current?.id })
    userRef.current = null
    setUser(null)
    timingRef.current = null
    setSessionTiming(null)
    setSessionError('')
    setLoading(false)
    setNotice(typeof message === 'string' ? message : '')
  }, [])

  const updateTiming = useCallback((session, expectedKey) => {
    if (timingRef.current?.key !== expectedKey || session?.key !== expectedKey) return
    timingRef.current = session
    setSessionTiming(session)
  }, [])

  const expireIdleSession = useCallback((expectedKey, message) => {
    if (timingRef.current?.key !== expectedKey) return
    ++request.current
    setSessionEnd({ reason: 'expired', userId: userRef.current?.id })
    clearCsrfToken()
    userRef.current = null
    timingRef.current = null
    setSessionTiming(null)
    setUser(null)
    setSessionError('')
    setLoading(false)
    setNotice(message)
  }, [])

  return (
    <AuthContext.Provider value={{ user, setUser, loading, sessionError, sessionEnd, refreshSession, login, googleLogin, logout, saveSession, notice }}>
      {children}
      <SessionIdleGuard key={sessionTiming?.key || 'anonymous'} session={sessionTiming} onTiming={updateTiming} onExpired={expireIdleSession} onLogout={logout} />
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

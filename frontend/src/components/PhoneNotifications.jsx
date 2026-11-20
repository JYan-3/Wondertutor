import { useEffect, useRef, useState } from 'react'
import { browserPushSupport, disablePhoneNotifications, enablePhoneNotifications, readPhoneNotifications } from '../lib/phoneNotifications'

const supportHelp = {
  insecure: 'Open WonderTutor over HTTPS to turn on phone notifications.',
  install: 'On iPhone or iPad with iOS 16.4 or later, use Share → Add to Home Screen. Open WonderTutor from that icon to turn on alerts.',
  unsupported: 'This browser does not support phone notifications. You can still read updates here.',
}

export default function PhoneNotifications() {
  const support = browserPushSupport()
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [attempt, setAttempt] = useState(0)
  const request = useRef(null)

  useEffect(() => {
    if (support !== 'supported') return
    const controller = new AbortController()
    request.current = controller
    readPhoneNotifications(controller.signal).then(value => {
      if (!controller.signal.aborted) setSettings(value)
    }).catch(() => {
      if (!controller.signal.aborted) setError('We couldn’t check your phone notification settings.')
    })
    return () => controller.abort()
  }, [support, attempt])

  const blocked = support === 'supported' && Notification.permission === 'denied'
  const enabled = settings?.enabled && !blocked
  const canEnable = settings?.publicKey && !blocked && !enabled
  const canDisable = settings?.registered
  async function change(turnOn) {
    const signal = request.current.signal
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      if (turnOn) {
        const permission = await enablePhoneNotifications(settings, signal)
        if (signal.aborted) return
        if (permission === 'granted') setSettings({ ...settings, registered: true, enabled: true })
        else if (permission === 'default') setFeedback('Permission was dismissed. You can try again when you’re ready.')
      } else {
        await disablePhoneNotifications(signal)
        if (!signal.aborted) setSettings({ ...settings, registered: false, enabled: false })
      }
    } catch {
      if (!signal.aborted) setError('We couldn’t update your phone notifications. Check your connection and try again.')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }

  let message = supportHelp[support]
  if (support === 'supported') {
    if (!settings) message = error ? '' : 'Checking this device…'
    else if (blocked) message = 'Notifications are blocked. Allow them in your browser or device settings, then reopen this menu.'
    else if (!settings.publicKey) message = 'Phone notifications are currently unavailable. Your updates still appear here.'
    else if (enabled) message = 'On for this device. Your phone’s notification settings control the sound.'
    else if (settings.registered) message = 'Reconnect this browser to receive booking and lesson updates again.'
    else message = 'Get booking and lesson updates on this device, even when WonderTutor is closed.'
  }
  const buttonStyle = 'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60'
  return (
    <section aria-label="Phone notifications" className="border-t border-brand-100 bg-brand-25 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h3 className="text-sm font-bold text-navy">Phone notifications</h3>
        <div className="flex flex-wrap gap-1">
          {canEnable && <button type="button" className={buttonStyle} onClick={() => change(true)} disabled={busy}>{canDisable ? 'Reconnect' : 'Turn on'}</button>}
          {canDisable && <button type="button" className={buttonStyle} onClick={() => change(false)} disabled={busy}>Turn off</button>}
          {!settings && error && <button type="button" className={buttonStyle} onClick={() => { setError(''); setAttempt(value => value + 1) }}>Retry</button>}
        </div>
      </div>
      <p role="status" className="text-xs leading-relaxed text-slate-600">{busy ? 'Updating this device…' : feedback || message}</p>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </section>
  )
}

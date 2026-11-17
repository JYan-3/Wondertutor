import { useId } from 'react'
import { checkRinggit } from '../lib/validation'

// Both booking entry points use the same money rules and inline feedback.
export default function ProposedPriceField({ value, onChange }) {
  const id = useId()
  const error = checkRinggit(value, 'Proposed price')
  return <div>
    <label htmlFor={id} className="mb-1 block text-sm font-bold text-navy">Proposed Price (RM per hour) <span className="text-red-500">*</span></label>
    <div className="relative">
      <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">RM</span>
      <input id={id} type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" required
        aria-invalid={Boolean(error)} aria-describedby={`${id}-feedback`} className={`input h-11 min-w-0 pl-11 ${error ? 'border-red-500' : ''}`}
        value={value} onChange={e => onChange(e.target.value)} />
    </div>
    <p id={`${id}-feedback`} aria-live="polite" className={`mt-1.5 text-xs ${error ? 'text-red-600' : 'text-slate-500'}`}>
      {error || 'RM0.01–RM1,000 per hour. Up to 2 decimal places.'}
    </p>
  </div>
}

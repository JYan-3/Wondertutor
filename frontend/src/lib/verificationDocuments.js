import api from '../api/client'

export function verificationDocumentUrl(path) {
  if (!/^\/(?:tutor\/documents|admin\/qualifications)\/\d+\/file$/.test(path || '')) return null
  return `${(api.defaults?.baseURL || '/api').replace(/\/$/, '')}${path}`
}

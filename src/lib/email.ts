// SERVER-ONLY. Send email from this app through MonstarX's email service; nothing to configure.
// Messages go out from this app's own address on MonstarX's mail domain, with a per-app limit,
// in previews and in published apps alike. Call sendEmail() inside server function handlers.
export interface EmailMessage {
  to: string | string[]
  subject: string
  text?: string
  html?: string
  /** Where replies should go (for example the signed-in user's address). */
  replyTo?: string
  /** Display name for the sender; defaults to the app's name. */
  fromName?: string
}

export interface SentEmail {
  id: string
  from: string
  /**
   * Recipients on test domains that can never receive mail (example.com, example.org, example.net and names ending in
   * .test, .example, .invalid or .localhost). They are left out and listed here instead of failing the call.
   */
  skipped?: string[]
}

export async function sendEmail(message: EmailMessage): Promise<SentEmail> {
  const url = process.env.MONSTARX_MAIL_URL
  const token = process.env.MONSTARX_DATA_TOKEN
  if (!url || !token) {
    throw new Error('Email is only available while this app runs inside MonstarX (previews and published apps); set MONSTARX_MAIL_URL and MONSTARX_DATA_TOKEN elsewhere.')
  }
  const response = await fetch(`${url}/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  })
  const data = (await response.json().catch(() => ({}))) as { id?: string; from?: string; skipped?: string[]; error?: string }
  if (!response.ok) throw new Error(data.error ?? `Email request failed (${response.status})`)
  return { id: data.id ?? '', from: data.from ?? '', ...(data.skipped?.length ? { skipped: data.skipped } : {}) }
}

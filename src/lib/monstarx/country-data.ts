// SERVER-ONLY. Live public data of a country — weather, transport, places, business registries, prices, holidays and
// more — from the country data servers MonstarX hosts. No account and no API key: the owner switches a country on in
// MonstarX (Backend → Country data) and the app calls its tools here, inside server function handlers or server
// routes. The tools differ per country; `countryData.tools(country)` lists them with their arguments.

/** The countries MonstarX hosts data for: Singapore, Japan, Malaysia, India, Indonesia, the UAE and the Philippines. */
export type Country = 'sg' | 'jp' | 'my' | 'in' | 'id' | 'uae' | 'ph'

export interface CountryDataTool {
  name: string
  description?: string
  /** JSON Schema of the tool's arguments. */
  inputSchema: Record<string, unknown>
}

/**
 * Thrown when a call does not return data. `status` says whose it is: 403 the country is not switched on for this app,
 * 422 the tool refused the arguments (the message is the data service's own), 429 the app's daily calls are spent,
 * 502 the data service could not be reached.
 */
export class CountryDataError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CountryDataError'
    this.status = status
  }
}

function endpoint(country: Country): { url: string; token: string } {
  const base = process.env.MONSTARX_COUNTRY_DATA_URL
  const token = process.env.MONSTARX_DATA_TOKEN
  if (!base || !token) {
    throw new CountryDataError('Country data is only available while this app runs inside MonstarX (previews and published apps); set MONSTARX_COUNTRY_DATA_URL and MONSTARX_DATA_TOKEN elsewhere.', 503)
  }
  return { url: `${base.replace(/\/+$/, '')}/${encodeURIComponent(country)}`, token }
}

async function answer<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new CountryDataError(data.error ?? `Country data request failed (${response.status})`, response.status)
  return data
}

export const countryData = {
  /**
   * Call one tool, e.g. `await countryData.call('sg', 'sg_weather_2h')` or
   * `await countryData.call('jp', 'jp_postal_code', { code: '1000001' })`. Returns what the tool answered: for the
   * country servers that is JSON with the data and where it came from — `{ source, retrieved_at, license, data }` —
   * so read the real shape once before relying on it.
   */
  async call<T = any>(country: Country, tool: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const { url, token } = endpoint(country)
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tool, arguments: args }),
    })
    return (await answer<{ result: T }>(response)).result
  },

  /** Every tool of a country with the JSON Schema of its arguments. */
  async tools(country: Country, signal?: AbortSignal): Promise<CountryDataTool[]> {
    const { url, token } = endpoint(country)
    const response = await fetch(url, { signal, headers: { authorization: `Bearer ${token}` } })
    return (await answer<{ tools: CountryDataTool[] }>(response)).tools
  },
}

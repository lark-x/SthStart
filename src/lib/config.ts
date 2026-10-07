// Public configuration for the browser: connector values marked public (Google Maps key, Mapbox
// token, Stripe publishable key, GA measurement id, …) are exposed as PUBLIC_* environment
// variables. Load them in a route loader: `const env = await getPublicEnv()`.
import { createServerFn } from '@tanstack/react-start'

export const getPublicEnv = createServerFn({ method: 'GET' }).handler(async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (key.startsWith('PUBLIC_') && typeof value === 'string') out[key] = value
  return out
})

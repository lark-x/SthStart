// SERVER-ONLY. AI for this app through MonstarX's AI service: text generation (with automatic model
// fallback), JSON answers, streaming for chat UIs, images, speech and transcription. No API keys to manage;
// call these inside server function handlers or server routes. Per-app daily limits apply.
import { z, type ZodType } from 'zod'

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface TextOptions {
  /** A single user prompt, or… */
  prompt?: string
  /** …a full conversation (for chat UIs). */
  messages?: AiMessage[]
  system?: string
  temperature?: number
  maxTokens?: number
}

export interface TextResult {
  text: string
  model: string
  usage: { promptTokens: number; completionTokens: number }
  /** `length` means the model ran out of output tokens. */
  finishReason?: string
}

export interface SearchSource {
  title: string
  url: string
  snippet: string
}

export interface SearchResult {
  /** A concise answer grounded in the results, with citations. */
  answer: string
  sources: SearchSource[]
  model: string
}

export interface ImageResult {
  /** A permanent URL (stored in this app's files under public/ai/) or a data: URL. */
  url: string
  key: string | null
  model: string
}

export interface SpeechOptions {
  /** Plain text, 1–4000 characters. */
  text: string
  /** Two-letter code. Defaults to en (Flux); other languages use Fish. */
  language?: string
  /** Pinning a model or voice disables automatic fallback. */
  model?: 'deepgram/flux-tts:free' | 'fish-audio/s2.1-pro-free:free'
  /** Flux voice, e.g. flux-paige-en. Omit for Fish's default voice. */
  voice?: string
}

export interface TranscriptionOptions {
  /** Recorded audio, at most 10 MiB. Blob.type or File.name must identify the format. */
  audio: Blob
  /** Two-letter language hint; omitted means auto-detect. */
  language?: string
  model?: 'meta/muse-voice-transcribe-1.0' | 'fish-audio/transcribe-1' | 'openai/whisper-1'
}

export interface TranscriptionResult {
  text: string
  model: string
  /** Provider USD before MonstarX credit markup; estimated only if cost was absent. */
  usage: { seconds: number | null; costUsd: number; costEstimated: boolean }
}

function endpoint(): { base: string; token: string } {
  const base = process.env.MONSTARX_AI_URL
  const token = process.env.MONSTARX_DATA_TOKEN
  if (!base || !token) throw new Error('AI is only available while this app runs inside MonstarX (previews and published apps); set MONSTARX_AI_URL and MONSTARX_DATA_TOKEN elsewhere.')
  return { base: base.replace(/\/+$/, ''), token }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const { base, token } = endpoint()
  const multipart = body instanceof FormData
  const response = await fetch(`${base}/${path}`, { method: 'POST', signal, headers: { authorization: `Bearer ${token}`, ...(multipart ? {} : { 'content-type': 'application/json' }) }, body: multipart ? body : JSON.stringify(body) })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `AI request failed (${response.status})`)
  }
  return response
}

export const ai = {
  /** Returns an MP3 Response. In a server route: return await ai.generateSpeech({ text }). */
  async generateSpeech(options: SpeechOptions, signal?: AbortSignal): Promise<Response> {
    return post('speech', options, signal)
  },

  /** Short audio → text. Compatible PCM WAV: Muse first; WebM: Whisper; other formats: Fish with compatible Whisper fallback. */
  async transcribe(options: TranscriptionOptions, signal?: AbortSignal): Promise<TranscriptionResult> {
    if (!(options.audio instanceof Blob) || !options.audio.size || options.audio.size > 10 * 1024 * 1024) throw new Error('Provide an audio Blob/File between 1 byte and 10 MiB.')
    const form = new FormData()
    form.set('file', options.audio)
    if (options.language) form.set('language', options.language)
    if (options.model) form.set('model', options.model)
    return (await post('transcribe', form, signal)).json() as Promise<TranscriptionResult>
  },

  /** Generate text. */
  async generateText(options: TextOptions): Promise<TextResult> {
    return (await post('text', options)).json() as Promise<TextResult>
  },

  /** Structured output with a provider schema, local validation, and one repair attempt. */
  async generateJson<T = unknown>(options: TextOptions & { schema?: ZodType<T>; validate?: (value: unknown) => T; repair?: boolean }): Promise<T> {
    const { schema, validate, repair = true, ...request } = options
    let jsonSchema: Record<string, unknown> | undefined
    if (schema) {
      try {
        jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
      } catch (error) {
        throw new Error('The AI response schema could not be converted to JSON Schema.', { cause: error })
      }
      if (jsonSchema.type !== 'object') throw new Error('AI response schemas must describe a JSON object. Wrap arrays in an object field.')
      delete jsonSchema.$schema
    }
    let correction = ''
    for (let attempt = 0; attempt < (repair ? 2 : 1); attempt++) {
      // Network/auth/quota errors are not malformed output: do not retry those here.
      const result = (await (await post('text', { ...request, json: true, ...(jsonSchema ? { jsonSchema: { name: 'app_response', schema: jsonSchema } } : {}), ...(correction ? { system: `${request.system ?? ''}\n${correction}` } : {}) })).json()) as TextResult
      try {
        const text = result.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')
        const value: unknown = JSON.parse(text)
        const parsed = schema ? schema.parse(value) : value
        return validate ? validate(parsed) : parsed as T
      } catch (error) {
        if (attempt === 1 || !repair) {
          const problem = error instanceof z.ZodError
            ? error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.code}`).slice(0, 10).join(', ')
            : error instanceof SyntaxError ? 'invalid JSON' : 'custom validation failed'
          console.warn('[monstarx] structured AI response rejected', { model: result.model, finishReason: result.finishReason ?? 'unknown', problem })
          const message = result.finishReason === 'length'
            ? 'The AI response was cut off before it finished. Try a smaller request.'
            : 'The AI returned data that did not match the requested format. Please try again.'
          throw new Error(message, { cause: error })
        }
        const reason = error instanceof Error ? error.message.slice(0, 1000) : 'Invalid JSON shape'
        correction = result.finishReason === 'length'
          ? 'The previous response was cut off. Return a shorter but complete JSON object with every required field.'
          : `The previous response could not be used: ${reason}. Generate the complete JSON again, matching the requested schema exactly. Return only JSON, no markdown. Do not omit required fields.`
      }
    }
    throw new Error('The AI could not produce valid structured data')
  },

  /**
   * Stream text as it is generated. Returns a stream of text chunks; in a server route, return
   * `new Response(await ai.streamText(...))` and read it on the client with a ReadableStream reader.
   */
  async streamText(options: TextOptions): Promise<ReadableStream<string>> {
    const response = await post('text', { ...options, stream: true })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    return new ReadableStream<string>({
      async pull(controller) {
        const { value, done } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean }
            if (event.delta) controller.enqueue(event.delta)
          } catch {
            // ignore
          }
        }
      },
      cancel() {
        void reader.cancel()
      },
    })
  },

  /** Search the web and get an answer with cited sources (live results). */
  async search(options: { query: string; maxResults?: number }): Promise<SearchResult> {
    return (await post('search', options)).json() as Promise<SearchResult>
  },

  /** Generate an image from a prompt; the result is stored with this app's files. */
  async generateImage(options: { prompt: string; size?: string }): Promise<ImageResult> {
    return (await post('image', options)).json() as Promise<ImageResult>
  },
}

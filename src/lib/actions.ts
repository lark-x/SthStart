// Buttons that answer the moment they are pressed.
//
// The obvious way to write a button is wrong:
//   onClick={async () => { await vote({ data: { id } }); await router.invalidate() }}
// Nothing changes on screen until the server has answered AND every loader on the page has refetched — half a
// second or more — so the button feels dead, and the clicks people make in the meantime are lost. Disabling it
// while it runs makes that worse: it swallows the clicks silently.
//
// These two hooks are the answer, and every button in the app that calls a server function goes through one:
//   useAction           — the click is acknowledged instantly (`pending`), the call is guarded against double
//                         submits, failures become a message instead of a silent nothing.
//   useOptimisticAction — the same, plus the new value is on screen before the request leaves the browser, and
//                         rolls back by itself if the server refuses.
//
// Both refetch the route's loaders on success, so nothing else has to call `router.invalidate()`.

import { useOptimistic, useRef, useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'

type AuthFailure = 'credentials' | 'exists' | 'email' | 'short' | 'tooMany' | 'generic'

/**
 * Better Auth's errors in the app's own language, by `<html lang>` (MonstarX stamps every app with the language it is made
 * in): a Tamil, Swahili or Bangla app answered a sign-up with "User already exists. Use another email." in English.
 * `script` is the app's writing system: a message without it (the provider's English) gives way to the general line; a
 * language written in Latin letters keeps a message it cannot tell from its own, unless it is a provider error code.
 */
const AUTH_MESSAGES: Record<string, { script?: RegExp } & Record<AuthFailure, string>> = {
  ja: { script: /[\u3040-\u30ff\u3400-\u9fff]/u, credentials: 'メールアドレスまたはパスワードが正しくありません。', exists: 'このメールアドレスはすでに登録されています。', email: 'メールアドレスを確認してください。', short: 'パスワードが短すぎます。', tooMany: '操作が多すぎます。少し待ってからもう一度お試しください。', generic: '問題が発生しました。もう一度お試しください。' },
  zh: { script: /[\u3400-\u9fff]/u, credentials: '邮箱或密码不正确。', exists: '该邮箱已注册。', email: '请检查邮箱地址。', short: '密码太短。', tooMany: '操作过于频繁，请稍后再试。', generic: '出了点问题，请重试。' },
  ko: { script: /[\uac00-\ud7a3]/u, credentials: '이메일 또는 비밀번호가 올바르지 않습니다.', exists: '이미 가입된 이메일입니다.', email: '이메일 주소를 확인해 주세요.', short: '비밀번호가 너무 짧습니다.', tooMany: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', generic: '문제가 발생했습니다. 다시 시도해 주세요.' },
  pt: { credentials: 'E-mail ou senha incorretos.', exists: 'Este e-mail já está cadastrado.', email: 'Confira o endereço de e-mail.', short: 'A senha é curta demais.', tooMany: 'Muitas tentativas. Aguarde um pouco e tente de novo.', generic: 'Algo deu errado. Tente de novo.' },
  ms: { credentials: 'E-mel atau kata laluan tidak betul.', exists: 'E-mel ini sudah didaftarkan.', email: 'Sila semak alamat e-mel.', short: 'Kata laluan terlalu pendek.', tooMany: 'Terlalu banyak cubaan. Tunggu sebentar dan cuba lagi.', generic: 'Ada masalah. Sila cuba lagi.' },
  id: { credentials: 'Email atau kata sandi salah.', exists: 'Email ini sudah terdaftar.', email: 'Periksa alamat email Anda.', short: 'Kata sandi terlalu pendek.', tooMany: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.', generic: 'Terjadi masalah. Silakan coba lagi.' },
  vi: { credentials: 'Email hoặc mật khẩu không đúng.', exists: 'Email này đã được đăng ký.', email: 'Vui lòng kiểm tra địa chỉ email.', short: 'Mật khẩu quá ngắn.', tooMany: 'Thao tác quá nhiều lần. Vui lòng đợi một chút rồi thử lại.', generic: 'Đã xảy ra lỗi. Vui lòng thử lại.' },
  th: { script: /\p{Script=Thai}/u, credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', exists: 'อีเมลนี้ลงทะเบียนแล้ว', email: 'โปรดตรวจสอบที่อยู่อีเมล', short: 'รหัสผ่านสั้นเกินไป', tooMany: 'ทำรายการบ่อยเกินไป โปรดรอสักครู่แล้วลองอีกครั้ง', generic: 'เกิดข้อผิดพลาด โปรดลองอีกครั้ง' },
  hi: { script: /\p{Script=Devanagari}/u, credentials: 'ईमेल या पासवर्ड सही नहीं है।', exists: 'यह ईमेल पहले से पंजीकृत है।', email: 'कृपया ईमेल पता जाँचें।', short: 'पासवर्ड बहुत छोटा है।', tooMany: 'बहुत अधिक प्रयास हुए। थोड़ी देर बाद फिर कोशिश करें।', generic: 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।' },
  ru: { script: /\p{Script=Cyrillic}/u, credentials: 'Неверный адрес почты или пароль.', exists: 'Этот адрес почты уже зарегистрирован.', email: 'Проверьте адрес электронной почты.', short: 'Пароль слишком короткий.', tooMany: 'Слишком много попыток. Подождите немного и попробуйте снова.', generic: 'Что-то пошло не так. Попробуйте ещё раз.' },
  ar: { script: /\p{Script=Arabic}/u, credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', exists: 'هذا البريد الإلكتروني مسجّل بالفعل.', email: 'تحقّق من عنوان البريد الإلكتروني.', short: 'كلمة المرور قصيرة جدًا.', tooMany: 'محاولات كثيرة جدًا. انتظر قليلًا ثم حاول مرة أخرى.', generic: 'حدث خطأ ما. حاول مرة أخرى.' },
  sw: { credentials: 'Barua pepe au nenosiri si sahihi.', exists: 'Barua pepe hii tayari imesajiliwa.', email: 'Tafadhali kagua anwani ya barua pepe.', short: 'Nenosiri ni fupi mno.', tooMany: 'Majaribio mengi mno. Subiri kidogo kisha ujaribu tena.', generic: 'Hitilafu imetokea. Tafadhali jaribu tena.' },
  ha: { credentials: 'Imel ko kalmar sirri ba daidai ba ne.', exists: 'An riga an yi rajista da wannan imel.', email: 'Da fatan za a duba adireshin imel.', short: 'Kalmar sirri ta yi gajeru sosai.', tooMany: 'Ƙoƙari ya yi yawa. Jira kaɗan sannan a sake gwadawa.', generic: 'An sami matsala. Da fatan za a sake gwadawa.' },
  ta: { script: /\p{Script=Tamil}/u, credentials: 'மின்னஞ்சல் அல்லது கடவுச்சொல் தவறு.', exists: 'இந்த மின்னஞ்சல் ஏற்கெனவே பதிவுசெய்யப்பட்டுள்ளது.', email: 'மின்னஞ்சல் முகவரியைச் சரிபார்க்கவும்.', short: 'கடவுச்சொல் மிகவும் சிறியது.', tooMany: 'அதிக முயற்சிகள். சிறிது நேரம் கழித்து மீண்டும் முயலவும்.', generic: 'ஏதோ தவறு நடந்தது. மீண்டும் முயலவும்.' },
  bn: { script: /\p{Script=Bengali}/u, credentials: 'ইমেইল বা পাসওয়ার্ড ঠিক নয়।', exists: 'এই ইমেইলটি আগেই নিবন্ধিত।', email: 'ইমেইল ঠিকানাটি যাচাই করুন।', short: 'পাসওয়ার্ড খুব ছোট।', tooMany: 'অনেকবার চেষ্টা করা হয়েছে। একটু অপেক্ষা করে আবার চেষ্টা করুন।', generic: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।' },
}

/** Which of Better Auth's failures this is, by its code or its English words. */
function authFailure(code: string, message: string): AuthFailure | null {
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || /(?:invalid|incorrect|wrong) (?:email or password|password)/i.test(message)) return 'credentials'
  if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || /user already exists/i.test(message)) return 'exists'
  if (code === 'INVALID_EMAIL' || /invalid email/i.test(message)) return 'email'
  if (code === 'PASSWORD_TOO_SHORT' || /password.*(?:too short|at least)/i.test(message)) return 'short'
  if (code === 'TOO_MANY_REQUESTS' || /too many requests/i.test(message)) return 'tooMany'
  return null
}

export function messageOf(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object'
          ? String((error as { message?: unknown }).message ?? (error as { statusText?: unknown }).statusText ?? '')
          : ''
  const message = text.trim()
  // Better Auth supplies its own English messages. The app's <html lang> is the source of truth: an English app keeps the
  // provider's wording, any other language its own.
  const lang = typeof document !== 'undefined' ? document.documentElement.lang.toLowerCase().split('-')[0] ?? '' : ''
  const words = AUTH_MESSAGES[lang]
  if (words) {
    const failure = authFailure(code, message)
    if (failure) return words[failure]
    if (!message || (words.script ? !words.script.test(message) : /^[A-Z][A-Z_]+$/.test(code))) return words.generic
  }
  return message || 'Something went wrong. Please try again.'
}

/**
 * Some calls report a failure in what they return instead of throwing: `authClient.signIn.email()` resolves to
 * `{ data: null, error: { message } }` for a wrong password, and a server function may return `{ error: 'That time was
 * just taken' }`. Either counts as a failure, so `onSuccess` never runs for it and `error` shows its message.
 */
function failureIn(result: unknown): string | null {
  if (!result || typeof result !== 'object' || !('error' in result)) return null
  const error = (result as { error: unknown }).error
  return error ? messageOf(error) : null
}

export interface ActionOptions<Result = unknown> {
  /** Refetch the route's loaders after the action succeeds. Default true; turn it off when nothing on the page changes. */
  refresh?: boolean
  /**
   * Runs after the action succeeded and the loaders have refetched, with what the action returned — open the record it
   * created, close a dialog, clear a form.
   */
  onSuccess?: (result: Result) => void
  /** Handle the failure yourself (a toast, say) instead of reading `error`. */
  onError?: (message: string) => void
}

export interface Action<Args extends unknown[]> {
  /** Start the action. Call it straight from onClick/onSubmit — it never returns a promise to await. */
  run: (...args: Args) => void
  /** True from the click until the server answered and the loaders refetched. Use it for the label, not for `disabled`. */
  pending: boolean
  /** The message from the last failure, or null. Render it near the button. */
  error: string | null
  /** Clear `error` (for example when the user edits the form again). */
  clearError: () => void
}

/**
 * An action with no value of its own on screen: sign out, send, delete-and-navigate, submit a form.
 *
 *   const save = useAction(addTask, { onSuccess: () => setTitle('') })
 *   <button onClick={() => save.run({ data: { title } })}>{save.pending ? 'Adding…' : 'Add task'}</button>
 *   {save.error ? <p className="text-sm text-red-600">{save.error}</p> : null}
 *
 * `onSuccess` gets what the action returned, so a form can open the record it just created:
 *
 *   const book = useAction(createBooking, { onSuccess: (booking) => navigate({ to: '/bookings/$id', params: { id: booking.id } }) })
 *
 * Clicks that arrive while it is running are ignored, so a form cannot be submitted twice — but `pending` is
 * already showing by then, so the person sees why. Never put `disabled={save.pending}` on the button as the only
 * feedback: a disabled button that looks unchanged is exactly what feels broken.
 */
export function useAction<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>, options: ActionOptions<Result> = {}): Action<Args> {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  // Read at call time so a run started from an old render still uses this render's action and options.
  const latest = useRef({ action, options })
  latest.current = { action, options }

  function run(...args: Args) {
    if (running.current) return
    running.current = true
    setError(null)
    startTransition(async () => {
      const { action: fn, options: opts } = latest.current
      try {
        const result = await fn(...args)
        const failed = failureIn(result)
        if (failed !== null) throw new Error(failed)
        if (opts.refresh !== false) await router.invalidate()
        opts.onSuccess?.(result)
      } catch (failure) {
        const message = messageOf(failure)
        if (opts.onError) opts.onError(message)
        else setError(message)
      } finally {
        running.current = false
      }
    })
  }

  return { run, pending, error, clearError: () => setError(null) }
}

export interface OptimisticActionOptions<Value, Args extends unknown[], Result = unknown> extends ActionOptions<Result> {
  /** The value as the server knows it: read it from the route loader every render, never copy it into useState. */
  value: Value
  /** The value to show the instant the button is pressed, from the value showing now and the run's arguments. */
  update: (current: Value, ...args: Args) => Value
  /** The server function to call. */
  action: (...args: Args) => Promise<Result>
}

export interface OptimisticAction<Value, Args extends unknown[]> extends Action<Args> {
  /** What to render: the optimistic value while the action runs, the server's own value once it has landed. */
  value: Value
}

/**
 * An action whose result is visible on this page — a vote, a like, a checkbox, a status, a quantity. The new value
 * appears immediately and is replaced by the server's own value when the loaders refetch; if the call fails, React
 * puts the old value back and `error` explains why.
 *
 *   const vote = useOptimisticAction({
 *     value: { count: post.votes, voted: post.voted },
 *     update: (current) => ({ count: current.count + (current.voted ? -1 : 1), voted: !current.voted }),
 *     action: () => toggleUpvote({ data: { postId: post.id } }),
 *   })
 *   <button onClick={() => vote.run()} aria-pressed={vote.value.voted}>▲ {vote.value.count}</button>
 *
 * One of these per row: give each item its own hook inside its own component (a <PostCard>, a <TodoItem>), never
 * one shared `busy` flag for a whole list — that is what makes every other row go dead while one of them saves.
 * Clicks are never ignored here: each one updates the screen at once, and the calls reach the server in the order
 * they were made, so a double-tapped toggle ends where the person left it.
 */
export function useOptimisticAction<Value, Args extends unknown[], Result>(options: OptimisticActionOptions<Value, Args, Result>): OptimisticAction<Value, Args> {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(options)
  latest.current = options
  const [value, applyOptimistic] = useOptimistic(options.value, (current: Value, args: Args) => latest.current.update(current, ...args))
  // Runs are chained rather than fired in parallel: two quick taps on a toggle must reach the server in order,
  // or the second can be answered first and the row settles on the wrong state.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  function run(...args: Args) {
    setError(null)
    startTransition(async () => {
      applyOptimistic(args)
      const mine = queue.current.catch(() => undefined).then(() => latest.current.action(...args))
      queue.current = mine
      try {
        const result = await mine
        const failed = failureIn(result)
        if (failed !== null) throw new Error(failed)
        // Inside the transition on purpose: React holds the optimistic value until this whole block is done, so
        // the real value is already on screen when it lets go and the row never flickers back.
        if (latest.current.refresh !== false) await router.invalidate()
        latest.current.onSuccess?.(result)
      } catch (failure) {
        const message = messageOf(failure)
        if (latest.current.onError) latest.current.onError(message)
        else setError(message)
      }
    })
  }

  return { value, run, pending, error, clearError: () => setError(null) }
}

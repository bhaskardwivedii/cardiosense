import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Logo } from '../components/Layout'
import { ErrorNote, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { user, login, register } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={(location.state as { from?: string })?.from ?? '/assess'} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'signin') await login(email, password)
      else await register(name, email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="ecg-grid relative hidden overflow-hidden lg:block">
        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <Logo />
          <div className="max-w-md">
            <p className="text-4xl font-extrabold leading-tight tracking-tight text-ink">
              Cardiovascular risk in seconds, with the reasons behind it.
            </p>
            <p className="mt-4 text-[17px] leading-relaxed text-ink/75">
              Enter routine examination values and get a risk estimate, the factors that drove it, and a report you can file.
              Trained and tested on 68,576 patient records.
            </p>
          </div>
          <p className="text-sm text-ink/60">For use by qualified clinicians as a decision-support aid.</p>
        </div>
        <svg viewBox="0 0 800 120" preserveAspectRatio="none" className="absolute inset-x-0 bottom-24 h-28 w-full opacity-80" aria-hidden="true">
          <path d="M0 70 h120 c8 0 10 -14 18 -14 s10 14 18 14 h20 l8 10 l12 -70 l12 80 l8 -20 h26 c10 0 14 -22 26 -22 s16 22 26 22 h160 c8 0 10 -14 18 -14 s10 14 18 14 h20 l8 10 l12 -70 l12 80 l8 -20 h26 c10 0 14 -22 26 -22 s16 22 26 22 h220"
            fill="none" stroke="#B42318" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden"><Logo /></div>
          <h1 className="mt-8 text-2xl font-bold lg:mt-0">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
          <p className="mt-1 text-sm text-slate">
            {mode === 'signin' ? 'Use your clinic account to continue.' : 'New accounts get clinician access.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <div>
                <label className="label" htmlFor="name">Full name</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
              {mode === 'register' && <p className="hint">At least 8 characters.</p>}
            </div>
            {error && <ErrorNote>{error}</ErrorNote>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy && <Spinner />}{mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <p className="mt-6 text-sm text-slate">
            {mode === 'signin' ? 'No account yet? ' : 'Already registered? '}
            <button className="font-semibold text-brand hover:underline" onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError('') }}>
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </div>
      </section>
    </div>
  )
}

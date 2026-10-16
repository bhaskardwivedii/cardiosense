import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const NAV = [
  { to: '/assess', label: 'New assessment', icon: 'M12 5v14M5 12h14' },
  { to: '/', label: 'Overview', icon: 'M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z', end: true },
  { to: '/history', label: 'Patient history', icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z' },
  { to: '/batch', label: 'Batch scoring', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/models', label: 'Model performance', icon: 'M3 17l5-5 4 4 8-9' },
]

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill={light ? '#ffffff' : '#0E5A73'} />
        <path d="M4 17h7l2.5-6 4 12 3-9 1.5 3H28" fill="none" stroke={light ? '#0E5A73' : '#fff'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-lg font-bold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>CardioSense</span>
    </span>
  )
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Users', icon: 'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' }] : NAV
  return (
    <nav className="space-y-1" aria-label="Main">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : false} onClick={onNavigate}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors ${
            isActive ? 'bg-brand-soft text-brand' : 'text-slate hover:bg-paper hover:text-ink'}`}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={n.icon} />
          </svg>
          {n.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-white px-4 py-5 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div className="px-2"><Logo /></div>
        <div className="mt-8 flex-1"><NavItems /></div>
        <div className="border-t border-line px-2 pt-4">
          <p className="truncate text-sm font-semibold">{user?.full_name}</p>
          <p className="truncate text-xs text-slate">{user?.email}{user?.role === 'admin' ? ' (admin)' : ''}</p>
          <button onClick={logout} className="mt-3 text-sm font-medium text-brand hover:underline">Sign out</button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white px-4 py-3 lg:hidden">
        <Logo />
        <button className="btn-quiet px-3 py-2" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>
      {open && (
        <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
          <NavItems onNavigate={() => setOpen(false)} />
          <button onClick={logout} className="mt-3 px-3 text-sm font-medium text-brand">Sign out</button>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl"><Outlet /></div>
        <footer className="mx-auto mt-12 max-w-6xl border-t border-line pt-4 text-xs text-slate">
          CardioSense is a decision-support tool. Estimates come from a model with about 73% test accuracy and must be read alongside clinical judgement.
        </footer>
      </main>
    </div>
  )
}

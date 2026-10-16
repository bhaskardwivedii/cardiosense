import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Empty, ErrorNote, PageHeader, RiskBadge, Segmented, Spinner, Stat } from '../components/ui'
import { api, BANDS, type Stats } from '../lib/api'
import { useAuth } from '../lib/auth'
import { BAND_STYLE, formatDate, pct } from '../lib/format'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setStats(null)
    api.stats(scope).then(setStats).catch((e) => setError(e.message))
  }, [scope])

  const maxDay = stats ? Math.max(1, ...stats.per_day.map((d) => d.count)) : 1
  const firstName = user?.full_name.split(' ')[0]

  return (
    <>
      <PageHeader title={`Welcome back, ${firstName}`} description="Your recent assessments and how risk is distributed across them."
        actions={<>
          {user?.role === 'admin' && <Segmented name="Scope" value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'Whole clinic' }]} />}
          <Link to="/assess" className="btn-primary">New assessment</Link>
        </>} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!stats && !error && <div className="flex justify-center py-20 text-slate"><Spinner className="h-6 w-6" /></div>}
      {stats && stats.total === 0 && (
        <div className="panel"><Empty title="No assessments yet">
          Start with a <Link to="/assess" className="font-semibold text-brand">single patient</Link> or <Link to="/batch" className="font-semibold text-brand">upload a CSV</Link> to score a whole list.
        </Empty></div>
      )}
      {stats && stats.total > 0 && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Assessments" value={stats.total.toLocaleString()} />
            <Stat label="High or very high risk" value={stats.high_risk.toLocaleString()} note={`${pct(stats.high_risk / stats.total)} of assessments`} />
            <Stat label="Average estimated risk" value={stats.mean_probability !== null ? pct(stats.mean_probability) : '–'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="panel p-5">
              <h2 className="font-semibold">Risk distribution</h2>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-paper">
                {BANDS.map((b) => stats.by_band[b] > 0 && (
                  <div key={b} className={BAND_STYLE[b].bg} style={{ width: `${(stats.by_band[b] / stats.total) * 100}%` }} title={`${b}: ${stats.by_band[b]}`} />
                ))}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {BANDS.map((b) => (
                  <div key={b}>
                    <dt><RiskBadge band={b} /></dt>
                    <dd className="mt-0.5 text-xl font-bold">{stats.by_band[b]}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="panel p-5">
              <h2 className="font-semibold">Assessments in the last 14 days</h2>
              <div className="mt-4 flex h-28 items-end gap-1.5" role="img" aria-label="Daily assessment counts">
                {stats.per_day.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${d.count}`}>
                    <span className="text-[10px] text-slate">{d.count || ''}</span>
                    <div className="w-full rounded-t bg-brand/80" style={{ height: `${(d.count / maxDay) * 80}px`, minHeight: d.count ? 3 : 1, opacity: d.count ? 1 : 0.25 }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate">
                <span>{formatDate(stats.per_day[0].date, false)}</span><span>Today</span>
              </div>
            </section>
          </div>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 className="font-semibold">Latest assessments</h2>
              <Link to="/history" className="text-sm font-medium text-brand hover:underline">View all</Link>
            </div>
            <table className="mt-2 w-full">
              <thead><tr><th className="th">Patient</th><th className="th">Risk</th><th className="th hidden sm:table-cell">Age / sex</th><th className="th hidden md:table-cell">BP</th><th className="th text-right">When</th></tr></thead>
              <tbody>
                {stats.latest.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-paper" onClick={() => navigate(`/history/${p.id}`)}>
                    <td className="td font-medium">{p.patient_ref ?? <span className="text-slate">#{p.id}</span>}</td>
                    <td className="td"><RiskBadge band={p.risk_band} probability={p.probability} /></td>
                    <td className="td hidden sm:table-cell">{Math.round(p.inputs.age)}, {p.inputs.gender === 'male' ? 'M' : 'F'}</td>
                    <td className="td hidden md:table-cell tabular-nums">{p.inputs.ap_hi}/{p.inputs.ap_lo}</td>
                    <td className="td text-right text-slate">{formatDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  )
}

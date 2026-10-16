import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Empty, ErrorNote, PageHeader, RiskBadge, Spinner } from '../components/ui'
import { api, BANDS, type PredictionSummary } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDate, MODEL_SHORT } from '../lib/format'

const PAGE = 20

export default function History() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const band = params.get('band') ?? ''
  const q = params.get('q') ?? ''
  const page = Number(params.get('page') ?? 0)
  const scope = params.get('scope') === 'all' ? 'all' : 'mine'
  const [data, setData] = useState<{ items: PredictionSummary[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState(q)

  useEffect(() => {
    setData(null)
    api.predictions({ limit: PAGE, offset: page * PAGE, risk_band: band || undefined, q: q || undefined, scope })
      .then(setData).catch((e) => setError(e.message))
  }, [band, q, page, scope])

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('page' in patch)) next.delete('page')
    setParams(next)
  }
  const pages = data ? Math.ceil(data.total / PAGE) : 0

  return (
    <>
      <PageHeader title="Patient history" description="Every assessment you have run, newest first. Open one to see its explanation or download its report." />
      <div className="mb-4 flex flex-wrap gap-3">
        <form onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }) }} className="flex gap-2">
          <input className="input w-64" placeholder="Search patient reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search patient reference" />
          <button className="btn-quiet">Search</button>
        </form>
        <select className="input w-44" value={band} onChange={(e) => update({ band: e.target.value })} aria-label="Filter by risk">
          <option value="">All risk levels</option>
          {BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {user?.role === 'admin' && (
          <select className="input w-44" value={scope} onChange={(e) => update({ scope: e.target.value === 'all' ? 'all' : '' })} aria-label="Whose assessments">
            <option value="mine">My assessments</option>
            <option value="all">Whole clinic</option>
          </select>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="panel overflow-x-auto">
        {!data && !error && <div className="flex justify-center py-16 text-slate"><Spinner className="h-6 w-6" /></div>}
        {data && data.items.length === 0 && (
          <Empty title={q || band ? 'No assessments match these filters' : 'No assessments yet'}>
            {q || band ? 'Clear the search or choose another risk level.' : 'Run a new assessment to start the history.'}
          </Empty>
        )}
        {data && data.items.length > 0 && (
          <table className="w-full min-w-[640px]">
            <thead><tr>
              <th className="th">Patient</th><th className="th">Risk</th><th className="th">Age / sex</th><th className="th">BP</th>
              <th className="th">Model</th><th className="th">Source</th><th className="th text-right">When</th>
            </tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-paper" onClick={() => navigate(`/history/${p.id}`)}>
                  <td className="td font-medium">{p.patient_ref ?? <span className="text-slate">#{p.id}</span>}</td>
                  <td className="td"><RiskBadge band={p.risk_band} probability={p.probability} /></td>
                  <td className="td">{Math.round(p.inputs.age)}, {p.inputs.gender === 'male' ? 'M' : 'F'}</td>
                  <td className="td tabular-nums">{p.inputs.ap_hi}/{p.inputs.ap_lo}</td>
                  <td className="td text-slate">{MODEL_SHORT[p.model_key] ?? p.model_key}</td>
                  <td className="td text-slate">{p.batch_id ? `Batch #${p.batch_id}` : 'Single'}</td>
                  <td className="td text-right text-slate">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate">{data?.total.toLocaleString()} assessments · page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <button className="btn-quiet" disabled={page === 0} onClick={() => update({ page: String(page - 1) })}>Previous</button>
            <button className="btn-quiet" disabled={page + 1 >= pages} onClick={() => update({ page: String(page + 1) })}>Next</button>
          </div>
        </div>
      )}
    </>
  )
}

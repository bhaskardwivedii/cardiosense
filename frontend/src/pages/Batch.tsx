import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorNote, PageHeader, RiskBadge, Spinner, WarningNote } from '../components/ui'
import { api, BANDS, download, type BatchResult, type ModelInfo } from '../lib/api'
import { BAND_STYLE, formatDate, MODEL_SHORT, pct } from '../lib/format'

export default function Batch() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('dnn')
  const [result, setResult] = useState<BatchResult | null>(null)
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.batches>>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = () => api.batches().then(setHistory).catch(() => {})
  useEffect(() => {
    api.models().then((m) => { setModels(m.models); setModel(m.default) }).catch(() => {})
    loadHistory()
  }, [])

  function pick(f: File | undefined) {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.csv')) { setError('Choose a .csv file'); return }
    setError(''); setFile(f)
  }

  async function run() {
    if (!file) return
    setBusy(true); setError('')
    try { setResult(await api.batch(file, model)); loadHistory() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]) }
  const scored = result ? result.n_rows - result.n_errors : 0

  return (
    <>
      <PageHeader title="Batch scoring" description="Upload a CSV with one patient per row to score a whole clinic list at once. Results are saved to the history and can be downloaded."
        actions={<button className="btn-quiet" onClick={() => download('/api/batch/template', 'cardiosense_template.csv')}>Download CSV template</button>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="panel p-6">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${drag ? 'border-brand bg-brand-soft' : 'border-line'}`}>
            <p className="font-semibold">{file ? file.name : 'Drop a CSV file here'}</p>
            <p className="mt-1 text-sm text-slate">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'or choose one from your computer (up to 10,000 rows)'}</p>
            <button type="button" className="btn-quiet mt-4" onClick={() => input.current?.click()}>{file ? 'Choose a different file' : 'Choose file'}</button>
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label className="label" htmlFor="bmodel">Model</label>
              <select id="bmodel" className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => <option key={m.key} value={m.key}>{m.name}{m.default ? ' (recommended)' : ''}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={!file || busy} onClick={run}>{busy && <Spinner />}Score patients</button>
          </div>
          {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-medium text-brand">Which columns are needed?</summary>
            <p className="mt-2 text-slate">
              <code>age, gender, height, weight, ap_hi, ap_lo, cholesterol, gluc, smoke, alco, active</code>, plus an optional <code>patient_ref</code>.
              Gender accepts male/female (or the Kaggle coding 1 = female, 2 = male). Cholesterol and glucose use 1–3. Yes/no columns accept 1/0, yes/no or true/false.
              Files in the original Kaggle format, with age in days and ';' separators, are also accepted.
            </p>
          </details>
        </section>

        <aside className="panel self-start p-5">
          <h2 className="font-semibold">Previous uploads</h2>
          {history.length === 0 && <p className="mt-2 text-sm text-slate">Nothing uploaded yet.</p>}
          <ul className="mt-2 divide-y divide-line">
            {history.slice(0, 8).map((b) => (
              <li key={b.id}>
                <button className="w-full py-2.5 text-left hover:text-brand" onClick={() => api.batchResult(b.id).then(setResult)}>
                  <span className="block truncate text-sm font-medium">{b.filename}</span>
                  <span className="text-xs text-slate">{b.n_rows - b.n_errors} scored · {formatDate(b.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {result && (
        <section className="mt-6 space-y-4">
          <div className="panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">{result.filename}</h2>
                <p className="text-sm text-slate">{scored} of {result.n_rows} patients scored with {MODEL_SHORT[result.model_key]}{result.mean_probability !== null && ` · average risk ${pct(result.mean_probability)}`}</p>
              </div>
              <button className="btn-primary" onClick={() => download(`/api/batch/${result.id}/download`, result.filename.replace(/\.csv$/i, '') + '_scored.csv')}>Download results CSV</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BANDS.map((b) => (
                <div key={b} className="rounded-lg bg-paper px-4 py-3">
                  <RiskBadge band={b} />
                  <p className={`mt-1 text-2xl font-bold ${BAND_STYLE[b].text}`}>{result.band_counts[b]}</p>
                </div>
              ))}
            </div>
            {result.n_errors > 0 && (
              <div className="mt-4"><WarningNote>
                <p className="font-semibold">{result.n_errors} row{result.n_errors > 1 ? 's were' : ' was'} not scored</p>
                <ul className="mt-1 space-y-0.5">{result.errors.slice(0, 6).map((e) => <li key={e.row}>Row {e.row}{e.patient_ref ? ` (${e.patient_ref})` : ''}: {e.error}</li>)}</ul>
                {result.n_errors > 6 && <p className="mt-1">The downloaded CSV lists every skipped row.</p>}
              </WarningNote></div>
            )}
          </div>
          <div className="panel overflow-x-auto">
            <p className="px-5 pt-4 font-semibold">Highest-risk patients first</p>
            <table className="mt-2 w-full min-w-[560px]">
              <thead><tr><th className="th">Patient</th><th className="th">Risk</th><th className="th">Age / sex</th><th className="th">BP</th><th className="th">Cholesterol</th></tr></thead>
              <tbody>
                {result.preview.slice(0, 25).map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-paper" onClick={() => navigate(`/history/${p.id}`)}>
                    <td className="td font-medium">{p.patient_ref ?? `#${p.id}`}</td>
                    <td className="td"><RiskBadge band={p.risk_band} probability={p.probability} /></td>
                    <td className="td">{Math.round(p.inputs.age)}, {p.inputs.gender === 'male' ? 'M' : 'F'}</td>
                    <td className="td tabular-nums">{p.inputs.ap_hi}/{p.inputs.ap_lo}</td>
                    <td className="td">{['Normal', 'Above normal', 'Well above'][p.inputs.cholesterol - 1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 py-3 text-xs text-slate">Open a patient to see the factors behind their estimate.</p>
          </div>
        </section>
      )}
    </>
  )
}

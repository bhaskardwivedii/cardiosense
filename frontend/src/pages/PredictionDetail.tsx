import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import RiskResult from '../components/RiskResult'
import { ErrorNote, Spinner } from '../components/ui'
import { api, download, type Prediction } from '../lib/api'
import { LEVEL } from '../lib/format'

export default function PredictionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [p, setP] = useState<Prediction | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => { api.prediction(Number(id)).then(setP).catch((e) => setError(e.message)) }, [id])

  if (error) return <ErrorNote>{error}. <Link to="/history" className="font-semibold underline">Back to history</Link></ErrorNote>
  if (!p) return <div className="flex justify-center py-20 text-slate"><Spinner className="h-6 w-6" /></div>

  const i = p.inputs
  const rows: [string, string][] = [
    ['Age', `${Math.round(i.age)} years`], ['Sex', i.gender === 'male' ? 'Male' : 'Female'],
    ['Height', `${i.height} cm`], ['Weight', `${i.weight} kg`], ['BMI', `${p.derived.bmi} kg/m²`],
    ['Blood pressure', `${i.ap_hi}/${i.ap_lo} mmHg`], ['Pulse pressure', `${p.derived.pulse_pressure} mmHg`],
    ['Cholesterol', LEVEL[i.cholesterol - 1]], ['Glucose', LEVEL[i.gluc - 1]],
    ['Smokes', i.smoke ? 'Yes' : 'No'], ['Alcohol intake', i.alco ? 'Yes' : 'No'], ['Physically active', i.active ? 'Yes' : 'No'],
  ]

  async function remove() {
    if (!confirm('Delete this assessment permanently?')) return
    setBusy('delete')
    try { await api.deletePrediction(p!.id); navigate('/history') } catch (e) { setError((e as Error).message); setBusy('') }
  }

  return (
    <>
      <Link to="/history" className="text-sm font-medium text-brand hover:underline">Patient history</Link>
      <h1 className="mt-2 text-2xl font-bold">{p.patient_ref ? `Patient ${p.patient_ref}` : `Assessment #${p.id}`}</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section className="panel self-start p-5">
          <h2 className="font-semibold">Examination values</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between py-2"><dt className="text-slate">{k}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
        </section>
        <RiskResult prediction={p} actions={<>
          <button className="btn-danger" onClick={remove} disabled={!!busy}>Delete</button>
          <button className="btn-primary" disabled={!!busy} onClick={async () => {
            setBusy('pdf')
            try { await download(`/api/predictions/${p.id}/report`, `cardiosense_report_${p.id}.pdf`) } catch (e) { setError((e as Error).message) } finally { setBusy('') }
          }}>{busy === 'pdf' && <Spinner />}Download PDF report</button>
        </>} />
      </div>
    </>
  )
}

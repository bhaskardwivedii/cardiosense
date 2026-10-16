import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import RiskResult from '../components/RiskResult'
import { ErrorNote, PageHeader, RiskBadge, Segmented, Spinner, Toggle } from '../components/ui'
import { api, download, type CompareRow, type ModelInfo, type PatientInput, type Prediction } from '../lib/api'
import { pct } from '../lib/format'

type Form = { [K in keyof PatientInput]: K extends 'gender' | 'cholesterol' | 'gluc' | 'smoke' | 'alco' | 'active' ? PatientInput[K] : string }

const EMPTY: Form = { age: '', gender: 'female', height: '', weight: '', ap_hi: '', ap_lo: '', cholesterol: 1, gluc: 1, smoke: false, alco: false, active: true }
const EXAMPLE: Form = { age: '58', gender: 'male', height: '174', weight: '91', ap_hi: '148', ap_lo: '94', cholesterol: 2, gluc: 1, smoke: true, alco: false, active: false }

const LIMITS: Record<'age' | 'height' | 'weight' | 'ap_hi' | 'ap_lo', [number, number, string]> = {
  age: [18, 100, 'years'], height: [120, 220, 'cm'], weight: [30, 200, 'kg'], ap_hi: [80, 220, 'mmHg'], ap_lo: [40, 160, 'mmHg'],
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <legend className="mb-3 text-[15px] font-bold">{title}</legend>
      {children}
    </fieldset>
  )
}

function NumberField({ id, label, value, onChange, error }: { id: keyof typeof LIMITS; label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [min, max, unit] = LIMITS[id]
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input id={id} inputMode="decimal" className={`input pr-14 ${error ? 'border-risk-vhigh' : ''}`} value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={`${min}–${max}`} aria-invalid={!!error} aria-describedby={`${id}-err`} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate">{unit}</span>
      </div>
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-risk-vhigh">{error}</p>}
    </div>
  )
}

function validate(f: Form): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const [min, max, unit] = LIMITS[k]
    const v = Number(f[k])
    if (f[k] === '' || Number.isNaN(v)) errs[k] = 'Required'
    else if (v < min || v > max) errs[k] = `Enter ${min}–${max} ${unit}`
  }
  if (!errs.ap_hi && !errs.ap_lo && Number(f.ap_hi) <= Number(f.ap_lo)) errs.ap_lo = 'Must be lower than systolic'
  return errs
}

export default function Assess() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [patientRef, setPatientRef] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('dnn')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Prediction | null>(null)
  const [compare, setCompare] = useState<CompareRow[] | null>(null)
  const [busy, setBusy] = useState<'' | 'predict' | 'compare' | 'pdf'>('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.models().then((m) => { setModels(m.models); setModel(m.default) }).catch(() => {})
  }, [])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const payload = (): PatientInput => ({
    ...form, age: Number(form.age), height: Number(form.height), weight: Number(form.weight),
    ap_hi: Math.round(Number(form.ap_hi)), ap_lo: Math.round(Number(form.ap_lo)),
  })
  const bmi = Number(form.height) > 0 && Number(form.weight) > 0 ? Number(form.weight) / (Number(form.height) / 100) ** 2 : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy('predict'); setError(''); setCompare(null)
    try {
      setResult(await api.predict({ ...payload(), model, patient_ref: patientRef.trim() || undefined }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prediction failed')
    } finally { setBusy('') }
  }

  async function runCompare() {
    setBusy('compare')
    try { setCompare(await api.compare(payload())) } catch (err) { setError(err instanceof Error ? err.message : 'Comparison failed') } finally { setBusy('') }
  }

  async function pdf() {
    if (!result) return
    setBusy('pdf')
    try { await download(`/api/predictions/${result.id}/report`, `cardiosense_report_${result.id}.pdf`) }
    catch (err) { setError(err instanceof Error ? err.message : 'Download failed') } finally { setBusy('') }
  }

  return (
    <>
      <PageHeader title="New assessment" description="Enter values from the patient's latest examination. The estimate and its explanation are saved to the patient history."
        actions={<button type="button" className="btn-quiet" onClick={() => { setForm(EXAMPLE); setErrors({}) }}>Fill example patient</button>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <form onSubmit={submit} className="panel space-y-5 p-6" noValidate>
          <Group title="Patient">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="ref">Patient reference <span className="font-normal text-slate">(optional)</span></label>
                <input id="ref" className="input" value={patientRef} onChange={(e) => setPatientRef(e.target.value)} maxLength={80} placeholder="e.g. OPD-2026-0412" />
              </div>
              <NumberField id="age" label="Age" value={form.age} onChange={(v) => set('age', v)} error={errors.age} />
              <div>
                <span className="label">Sex</span>
                <Segmented name="Sex" value={form.gender} onChange={(v) => set('gender', v)} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} />
              </div>
              <NumberField id="height" label="Height" value={form.height} onChange={(v) => set('height', v)} error={errors.height} />
              <NumberField id="weight" label="Weight" value={form.weight} onChange={(v) => set('weight', v)} error={errors.weight} />
            </div>
            {bmi && bmi > 10 && bmi < 80 && <p className="hint mt-2">BMI {bmi.toFixed(1)} kg/m²</p>}
          </Group>

          <Group title="Blood pressure">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField id="ap_hi" label="Systolic" value={form.ap_hi} onChange={(v) => set('ap_hi', v)} error={errors.ap_hi} />
              <NumberField id="ap_lo" label="Diastolic" value={form.ap_lo} onChange={(v) => set('ap_lo', v)} error={errors.ap_lo} />
            </div>
          </Group>

          <Group title="Lab results">
            <div className="space-y-4">
              {(['cholesterol', 'gluc'] as const).map((k) => (
                <div key={k}>
                  <span className="label">{k === 'cholesterol' ? 'Cholesterol' : 'Glucose'}</span>
                  <Segmented name={k} value={form[k]} onChange={(v) => set(k, v)}
                    options={[{ value: 1, label: 'Normal' }, { value: 2, label: 'Above normal' }, { value: 3, label: 'Well above' }]} />
                </div>
              ))}
            </div>
          </Group>

          <Group title="Lifestyle">
            <div className="divide-y divide-line">
              <Toggle label="Smokes" checked={form.smoke} onChange={(v) => set('smoke', v)} />
              <Toggle label="Regular alcohol intake" checked={form.alco} onChange={(v) => set('alco', v)} />
              <Toggle label="Physically active" hint="Regular exercise most weeks" checked={form.active} onChange={(v) => set('active', v)} />
            </div>
          </Group>

          <div className="border-t border-line pt-5">
            <label className="label" htmlFor="model">Model</label>
            <select id="model" className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.key} value={m.key}>{m.name} — {pct(m.metrics.accuracy, 1)} test accuracy{m.default ? ' (recommended)' : ''}</option>
              ))}
            </select>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <button className="btn-primary w-full py-3 text-base" disabled={!!busy}>
            {busy === 'predict' && <Spinner />}Estimate risk
          </button>
        </form>

        <div className="lg:sticky lg:top-6 lg:self-start">
          {result ? (
            <div className="space-y-4">
              <RiskResult prediction={result} actions={<>
                <button className="btn-quiet" onClick={runCompare} disabled={!!busy}>{busy === 'compare' && <Spinner />}Compare all models</button>
                <button className="btn-primary" onClick={pdf} disabled={!!busy}>{busy === 'pdf' && <Spinner />}Download PDF report</button>
              </>} />
              {compare && (
                <div className="panel overflow-hidden">
                  <p className="px-5 pt-4 font-semibold">Same patient, every model</p>
                  <table className="mt-2 w-full">
                    <thead><tr><th className="th">Model</th><th className="th">Estimate</th><th className="th text-right">Test AUC</th></tr></thead>
                    <tbody>
                      {compare.map((c) => (
                        <tr key={c.model_key}>
                          <td className="td">{c.model_name}{c.default && <span className="ml-2 text-xs text-brand">recommended</span>}</td>
                          <td className="td"><RiskBadge band={c.risk_band} probability={c.probability} /></td>
                          <td className="td text-right tabular-nums">{c.test_auc.toFixed(3)}</td>
                        </tr>))}
                    </tbody>
                  </table>
                  <p className="px-5 py-3 text-xs text-slate">Comparison only; nothing extra is saved. <Link to="/models" className="text-brand hover:underline">See how the models were evaluated</Link>.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <div className="ecg-grid h-40" />
              <div className="p-6">
                <p className="font-semibold">The estimate appears here</p>
                <p className="mt-1 text-sm text-slate">Fill in the examination values and choose Estimate risk. You will see the probability, the factors that pushed it up or down, and follow-up suggestions.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

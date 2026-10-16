import { useEffect, useState } from 'react'
import RocChart from '../components/RocChart'
import { ErrorNote, PageHeader, Spinner } from '../components/ui'
import { api, type ModelsResponse } from '../lib/api'
import { pct } from '../lib/format'

const LABELS: Record<string, string> = {
  ap_hi: 'Systolic BP', age: 'Age', ap_lo: 'Diastolic BP', bmi: 'BMI', pulse_pressure: 'Pulse pressure', weight: 'Weight',
  height: 'Height', cholesterol: 'Cholesterol', gluc: 'Glucose', active: 'Physical activity', gender: 'Sex', smoke: 'Smoking', alco: 'Alcohol',
}

export default function Models() {
  const [data, setData] = useState<ModelsResponse | null>(null)
  const [sel, setSel] = useState('dnn')
  const [error, setError] = useState('')
  useEffect(() => { api.models().then((d) => { setData(d); setSel(d.default) }).catch((e) => setError(e.message)) }, [])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return <div className="flex justify-center py-20 text-slate"><Spinner className="h-6 w-6" /></div>

  const m = data.models.find((x) => x.key === sel) ?? data.models[0]
  const best = (k: 'accuracy' | 'precision' | 'recall' | 'specificity' | 'f1' | 'auc') => Math.max(...data.models.map((x) => x.metrics[k]))
  const forest = data.models.find((x) => x.feature_importance)
  const c = m.metrics.confusion
  const ds = data.dataset

  return (
    <>
      <PageHeader title="Model performance"
        description={`All seven models from the study, evaluated once on the same held-out test set of ${ds.test.toLocaleString()} patients. The DNN is used by default because it has the best accuracy, F1-score and AUC.`} />

      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead><tr>
            <th className="th">Model</th><th className="th text-right">Accuracy</th><th className="th text-right">Precision</th>
            <th className="th text-right">Recall</th><th className="th text-right">Specificity</th><th className="th text-right">F1</th>
            <th className="th text-right">AUC</th><th className="th text-right">Missed cases</th>
          </tr></thead>
          <tbody>
            {data.models.map((x) => {
              const cell = (k: 'accuracy' | 'precision' | 'recall' | 'specificity' | 'f1') =>
                <td className={`td text-right tabular-nums ${x.metrics[k] === best(k) ? 'font-bold text-brand' : ''}`}>{pct(x.metrics[k], 2)}</td>
              return (
                <tr key={x.key} onClick={() => setSel(x.key)} className={`cursor-pointer ${x.key === sel ? 'bg-brand-soft' : 'hover:bg-paper'}`}>
                  <td className="td">
                    <span className="font-medium">{x.name}</span>{x.default && <span className="ml-2 text-xs text-brand">default</span>}
                    <span className="block text-xs text-slate">{x.family}</span>
                  </td>
                  {cell('accuracy')}{cell('precision')}{cell('recall')}{cell('specificity')}{cell('f1')}
                  <td className={`td text-right tabular-nums ${x.metrics.auc === best('auc') ? 'font-bold text-brand' : ''}`}>{x.metrics.auc.toFixed(4)}</td>
                  <td className="td text-right tabular-nums">{x.metrics.confusion.fn.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-slate">Best value in each column in bold. Select a row to inspect that model below.</p>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-semibold">ROC curves</h2>
          <p className="text-sm text-slate">{m.name} highlighted, AUC {m.metrics.auc.toFixed(3)}. The curves almost overlap: every model reaches a similar ceiling on this data.</p>
          <div className="mt-3"><RocChart models={data.models} highlight={m.key} /></div>
        </section>
        <section className="panel p-5">
          <h2 className="font-semibold">{m.name}</h2>
          <p className="text-sm text-slate">{m.description}</p>
          <h3 className="mt-4 text-sm font-semibold">Confusion matrix on the test set</h3>
          <table className="mt-2 w-full max-w-sm text-sm">
            <thead><tr><th /><th className="th text-center">Predicted CVD</th><th className="th text-center">Predicted no CVD</th></tr></thead>
            <tbody>
              <tr><th className="th">Has CVD</th><td className="td text-center font-semibold text-risk-low">{c.tp.toLocaleString()}</td><td className="td text-center font-semibold text-risk-vhigh">{c.fn.toLocaleString()}</td></tr>
              <tr><th className="th">No CVD</th><td className="td text-center text-risk-high">{c.fp.toLocaleString()}</td><td className="td text-center">{c.tn.toLocaleString()}</td></tr>
            </tbody>
          </table>
          <h3 className="mt-5 text-sm font-semibold">Settings</h3>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 text-sm">
            {Object.entries(m.params).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-line py-1.5"><dt className="text-slate">{k}</dt><dd className="font-medium">{Array.isArray(v) ? v.join('-') : typeof v === 'number' && v < 0.01 ? v.toExponential(1) : String(v)}</dd></div>
            ))}
            <div className="flex justify-between border-b border-line py-1.5"><dt className="text-slate">training time</dt><dd className="font-medium">{m.fit_seconds}s</dd></div>
          </dl>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {forest?.feature_importance && (
          <section className="panel p-5">
            <h2 className="font-semibold">What the Random Forest relies on</h2>
            <p className="text-sm text-slate">Share of total importance (mean decrease in impurity).</p>
            <ul className="mt-3 space-y-1.5">
              {forest.feature_importance.map((f) => (
                <li key={f.feature} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
                  <span>{LABELS[f.feature] ?? f.feature}</span>
                  <span className="h-3 rounded-sm bg-paper"><span className={`block h-3 rounded-sm ${['ap_hi', 'ap_lo', 'pulse_pressure'].includes(f.feature) ? 'bg-brand' : 'bg-slate-light/60'}`} style={{ width: `${(f.importance / forest.feature_importance![0].importance) * 100}%` }} /></span>
                  <span className="text-right tabular-nums text-slate">{pct(f.importance, 1)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate">Blood-pressure features shown in blue.</p>
          </section>
        )}
        <section className="panel p-5">
          <h2 className="font-semibold">How the models were built</h2>
          <dl className="mt-2 divide-y divide-line text-sm">
            <div className="flex justify-between py-2"><dt className="text-slate">Raw records</dt><dd>{ds.raw_rows.toLocaleString()}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate">Removed (implausible BP, height, weight)</dt><dd>{(ds.removed_bp + ds.removed_body).toLocaleString()}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate">Removed duplicates</dt><dd>{ds.removed_duplicates}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate">Train / validation / test</dt><dd>{ds.train.toLocaleString()} / {ds.validation.toLocaleString()} / {ds.test.toLocaleString()}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate">Patients with CVD</dt><dd>{pct(ds.positive_rate, 1)}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate">PSO configurations</dt><dd>{data.pso.source === 'paper' ? 'From the study\'s PSO search' : 'Re-searched'}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate">The hybrid autoencoder + PSO model did not beat the plain DNN (McNemar p = 0.005), which is why the DNN is the default. All seven remain available for comparison.</p>
        </section>
      </div>
    </>
  )
}

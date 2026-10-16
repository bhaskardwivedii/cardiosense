import { useMemo, useState } from 'react'
import type { Prediction } from '../lib/api'
import { BAND_CUTS, BAND_STYLE, formatDate, pct } from '../lib/format'
import { WarningNote } from './ui'

// One PQRST complex, 160 units wide, baseline at y=60.
const BEAT = 'l18 0 c4 0 6 -8 10 -8 s6 8 10 8 l10 0 l4 6 l7 -46 l7 52 l5 -12 l14 0 c6 0 9 -14 16 -14 s10 14 16 14 l43 0'

function EcgTrace({ color, width = 640 }: { color: string; width?: number }) {
  const beats = Math.ceil(width / 160) + 1
  const d = `M0 60 ${Array.from({ length: beats }, () => BEAT).join(' ')}`
  return (
    <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-1 h-[76px] w-full" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" className="trace-draw"
        style={{ ['--len' as string]: beats * 260 } as React.CSSProperties} />
    </svg>
  )
}

export function RiskScale({ probability }: { probability: number }) {
  return (
    <div>
      <div className="relative flex h-2.5 overflow-hidden rounded-full">
        {BAND_CUTS.map((c) => (
          <div key={c.band} className={`${BAND_STYLE[c.band].bg} opacity-25`} style={{ width: `${(c.to - c.from) * 100}%` }} />
        ))}
      </div>
      <div className="relative h-4">
        <div className="absolute -top-4 h-6 w-1 -translate-x-1/2 rounded bg-ink" style={{ left: `${probability * 100}%` }} />
      </div>
      <div className="relative h-4 text-xs text-slate">
        {[0, 30, 50, 70, 100].map((t) => (
          <span key={t} className="absolute" style={t === 0 ? { left: 0 } : t === 100 ? { right: 0 } : { left: `${t}%`, transform: 'translateX(-50%)' }}>{t}%</span>
        ))}
      </div>
    </div>
  )
}

export function ShapBars({ prediction, limit = 7 }: { prediction: Prediction; limit?: number }) {
  const [all, setAll] = useState(false)
  const ex = prediction.explanation
  const rows = useMemo(() => (ex ? (all ? ex.contributions : ex.contributions.slice(0, limit)) : []), [ex, all, limit])
  if (!ex) return null
  const max = Math.max(...ex.contributions.map((c) => Math.abs(c.shap)), 0.01)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-semibold">What moved this estimate</h3>
        <p className="text-xs text-slate">Starting point {pct(ex.base_value)} (average patient)</p>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((c) => {
          const w = (Math.abs(c.shap) / max) * 50
          const up = c.shap >= 0
          return (
            <li key={c.feature} className="grid grid-cols-[minmax(0,10rem)_1fr_4.5rem] items-center gap-3 text-sm">
              <span className="truncate"><span className="font-medium">{c.label}</span> <span className="text-slate">{c.display_value}</span></span>
              <span className="relative h-4">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <span className={`absolute inset-y-0.5 rounded-sm ${up ? 'bg-risk-high' : 'bg-brand'}`}
                  style={up ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
              </span>
              <span className={`text-right tabular-nums ${up ? 'text-risk-high' : 'text-brand'}`}>
                {up ? '+' : '−'}{Math.abs(c.shap * 100).toFixed(1)} pts
              </span>
            </li>
          )
        })}
      </ul>
      {ex.contributions.length > limit && (
        <button className="mt-3 text-sm font-medium text-brand hover:underline" onClick={() => setAll(!all)}>
          {all ? 'Show top factors only' : `Show all ${ex.contributions.length} factors`}
        </button>
      )}
      <p className="mt-2 text-xs text-slate">Orange raises risk, blue lowers it. Values are Kernel SHAP contributions in percentage points.</p>
    </div>
  )
}

export default function RiskResult({ prediction, actions }: { prediction: Prediction; actions?: React.ReactNode }) {
  const style = BAND_STYLE[prediction.risk_band]
  return (
    <div className="panel overflow-hidden">
      <div className="ecg-grid relative h-[248px] px-6 pt-5" key={prediction.id}>
        <p className="text-sm font-medium text-ink/70">
          {prediction.patient_ref ? `Patient ${prediction.patient_ref}` : 'Estimated risk of cardiovascular disease'}
        </p>
        <p className={`mt-1 text-7xl font-extrabold leading-none tracking-tight ${style.text}`}>{pct(prediction.probability)}</p>
        <p className={`mt-2 text-lg font-bold ${style.text}`}>{prediction.risk_band} risk</p>
        <EcgTrace color={style.hex} />
      </div>
      <div className="space-y-6 px-6 py-5">
        <RiskScale probability={prediction.probability} />
        {prediction.warnings.length > 0 && (
          <WarningNote>{prediction.warnings.map((w) => <p key={w}>{w}</p>)}</WarningNote>
        )}
        <ShapBars prediction={prediction} />
        <div>
          <h3 className="font-semibold">Suggested follow-up</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {prediction.recommendations.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-slate">
            {prediction.model_name} · BMI {prediction.derived.bmi} · {formatDate(prediction.created_at)}
          </p>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  )
}

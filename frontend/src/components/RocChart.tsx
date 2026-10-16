import type { ModelInfo } from '../lib/api'

const S = 300
const PAD = { l: 44, b: 40, t: 12, r: 12 }

export default function RocChart({ models, highlight }: { models: ModelInfo[]; highlight: string }) {
  const x = (v: number) => PAD.l + v * S
  const y = (v: number) => PAD.t + S - v * S
  const ordered = [...models].sort((a) => (a.key === highlight ? 1 : -1))
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <svg viewBox={`0 0 ${PAD.l + S + PAD.r} ${PAD.t + S + PAD.b}`} className="w-full max-w-md" role="img"
      aria-label="ROC curves of all models on the test set">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} stroke="#EEF1F4" />
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="#EEF1F4" />
          <text x={x(t)} y={y(0) + 16} fontSize="11" textAnchor="middle" fill="#5A6A77">{t}</text>
          <text x={x(0) - 8} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#5A6A77">{t}</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#B9C3CC" strokeDasharray="4 4" />
      {ordered.map((m) => {
        const hl = m.key === highlight
        const d = m.metrics.roc.map((p, i) => `${i ? 'L' : 'M'}${x(p.fpr).toFixed(1)} ${y(p.tpr).toFixed(1)}`).join('')
        return <path key={m.key} d={d} fill="none" stroke={hl ? '#0E5A73' : '#C7D0D8'} strokeWidth={hl ? 2.5 : 1.2}>
          <title>{`${m.name}: AUC ${m.metrics.auc.toFixed(3)}`}</title>
        </path>
      })}
      <text x={x(0.5)} y={y(0) + 34} fontSize="12" textAnchor="middle" fill="#13212C">False positive rate</text>
      <text transform={`translate(12 ${y(0.5)}) rotate(-90)`} fontSize="12" textAnchor="middle" fill="#13212C">True positive rate</text>
    </svg>
  )
}

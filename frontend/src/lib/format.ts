import type { RiskBand } from './api'

export const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`

export const BAND_STYLE: Record<RiskBand, { text: string; bg: string; hex: string }> = {
  Low: { text: 'text-risk-low', bg: 'bg-risk-low', hex: '#2E7D5B' },
  Moderate: { text: 'text-risk-moderate', bg: 'bg-risk-moderate', hex: '#A86A12' },
  High: { text: 'text-risk-high', bg: 'bg-risk-high', hex: '#C2410C' },
  'Very high': { text: 'text-risk-vhigh', bg: 'bg-risk-vhigh', hex: '#B42318' },
}

export const BAND_CUTS: { band: RiskBand; from: number; to: number }[] = [
  { band: 'Low', from: 0, to: 0.3 },
  { band: 'Moderate', from: 0.3, to: 0.5 },
  { band: 'High', from: 0.5, to: 0.7 },
  { band: 'Very high', from: 0.7, to: 1 },
]

export function formatDate(iso: string, withTime = true) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

export const LEVEL = ['Normal', 'Above normal', 'Well above normal']

export const MODEL_SHORT: Record<string, string> = {
  logreg: 'Logistic Regression',
  tree: 'Decision Tree',
  forest: 'Random Forest',
  dnn: 'DNN',
  ae_dnn: 'Autoencoder + DNN',
  dnn_pso: 'DNN + PSO',
  hybrid: 'Hybrid (AE + DNN + PSO)',
}

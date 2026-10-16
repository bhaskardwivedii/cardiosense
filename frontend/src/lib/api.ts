// Typed client for the CardioSense REST API.

export type RiskBand = 'Low' | 'Moderate' | 'High' | 'Very high'
export const BANDS: RiskBand[] = ['Low', 'Moderate', 'High', 'Very high']

export interface User {
  id: number
  email: string
  full_name: string
  role: 'clinician' | 'admin'
  is_active: boolean
  created_at: string
}

export interface PatientInput {
  age: number
  gender: 'female' | 'male'
  height: number
  weight: number
  ap_hi: number
  ap_lo: number
  cholesterol: 1 | 2 | 3
  gluc: 1 | 2 | 3
  smoke: boolean
  alco: boolean
  active: boolean
}

export interface Contribution {
  feature: string
  label: string
  value: number
  display_value: string
  shap: number
}

export interface Prediction {
  id: number
  patient_ref: string | null
  model_key: string
  model_name: string
  probability: number
  risk_band: RiskBand
  inputs: PatientInput
  derived: { bmi: number; pulse_pressure: number }
  explanation: { base_value: number; contributions: Contribution[]; method: string } | null
  warnings: string[]
  recommendations: string[]
  created_at: string
}

export interface PredictionSummary {
  id: number
  patient_ref: string | null
  model_key: string
  probability: number
  risk_band: RiskBand
  batch_id: number | null
  created_at: string
  inputs: PatientInput
}

export interface Metrics {
  accuracy: number
  precision: number
  recall: number
  specificity: number
  f1: number
  auc: number
  confusion: { tp: number; fp: number; tn: number; fn: number }
  roc: { fpr: number; tpr: number }[]
}

export interface ModelInfo {
  key: string
  name: string
  family: string
  description: string
  params: Record<string, unknown>
  fit_seconds: number
  metrics: Metrics
  default: boolean
  feature_importance?: { feature: string; importance: number }[]
  ae_reconstruction_mse?: number
}

export interface ModelsResponse {
  default: string
  dataset: Record<string, number>
  decision_tree_depth: number
  pso: { source: string; raw: Record<string, unknown>; ae: Record<string, unknown> }
  feature_ranges: Record<string, { p01: number; p99: number; mean: number }>
  models: ModelInfo[]
}

export interface Stats {
  total: number
  by_band: Record<RiskBand, number>
  mean_probability: number | null
  high_risk: number
  per_day: { date: string; count: number }[]
  latest: PredictionSummary[]
}

export interface BatchResult {
  id: number
  filename: string
  model_key: string
  n_rows: number
  n_errors: number
  errors: { row: number; patient_ref: string | null; error: string }[]
  band_counts: Record<RiskBand, number>
  mean_probability: number | null
  preview: PredictionSummary[]
  created_at: string
}

export interface CompareRow {
  model_key: string
  model_name: string
  probability: number
  risk_band: RiskBand
  test_accuracy: number
  test_auc: number
  default: boolean
}

const TOKEN_KEY = 'cardiosense.token'

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ } },
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

function describe(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d: { loc?: unknown[]; msg?: string }) => {
      const field = (d.loc ?? []).filter((l) => l !== 'body').join('.')
      return field ? `${field}: ${d.msg}` : String(d.msg)
    }).join('; ')
  }
  return 'Request failed'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = tokenStore.get()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }
  if (res.status === 401 && token) onUnauthorized()
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { msg = describe((await res.json()).detail) } catch { /* not json */ }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>
}

export async function download(path: string, filename: string) {
  const blob = await request<Blob>(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (full_name: string, email: string, password: string) =>
    request<{ access_token: string; user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ full_name, email, password }) }),
  me: () => request<User>('/api/auth/me'),
  models: () => request<ModelsResponse>('/api/models'),
  predict: (body: PatientInput & { model?: string; patient_ref?: string }) =>
    request<Prediction>('/api/predict', { method: 'POST', body: JSON.stringify(body) }),
  compare: (body: PatientInput) => request<CompareRow[]>('/api/predict/compare', { method: 'POST', body: JSON.stringify(body) }),
  prediction: (id: number) => request<Prediction>(`/api/predictions/${id}`),
  deletePrediction: (id: number) => request<void>(`/api/predictions/${id}`, { method: 'DELETE' }),
  predictions: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
    return request<{ items: PredictionSummary[]; total: number }>(`/api/predictions?${q}`)
  },
  stats: (scope: 'mine' | 'all' = 'mine') => request<Stats>(`/api/stats?scope=${scope}`),
  batch: (file: File, model: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('model', model)
    return request<BatchResult>('/api/batch', { method: 'POST', body: fd })
  },
  batches: () => request<{ id: number; filename: string; model_key: string; n_rows: number; n_errors: number; created_at: string }[]>('/api/batch'),
  batchResult: (id: number) => request<BatchResult>(`/api/batch/${id}`),
  users: () => request<User[]>('/api/admin/users'),
  updateUser: (id: number, body: Partial<Pick<User, 'role' | 'is_active'>>) =>
    request<User>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  adminOverview: () => request<{ users: number; predictions: number; batches: number; per_user: Record<string, number> }>('/api/admin/overview'),
}

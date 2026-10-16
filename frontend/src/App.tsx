import type { ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { AuthProvider, useAuth } from './lib/auth'
import Admin from './pages/Admin'
import Assess from './pages/Assess'
import Batch from './pages/Batch'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import Login from './pages/Login'
import Models from './pages/Models'
import PredictionDetail from './pages/PredictionDetail'

function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex min-h-screen items-center justify-center text-slate"><Spinner className="h-6 w-6" /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-lg font-semibold">This page does not exist</p>
      <Link to="/" className="mt-3 inline-block font-medium text-brand hover:underline">Go to the overview</Link>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="assess" element={<Assess />} />
            <Route path="history" element={<History />} />
            <Route path="history/:id" element={<PredictionDetail />} />
            <Route path="batch" element={<Batch />} />
            <Route path="models" element={<Models />} />
            <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

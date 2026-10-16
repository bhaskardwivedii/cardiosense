import { useEffect, useState } from 'react'
import { ErrorNote, PageHeader, Spinner, Stat } from '../components/ui'
import { api, type User } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/format'

export default function Admin() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<User[] | null>(null)
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.adminOverview>> | null>(null)
  const [error, setError] = useState('')

  const load = () => Promise.all([api.users(), api.adminOverview()]).then(([u, o]) => { setUsers(u); setOverview(o) }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  async function update(u: User, patch: Partial<Pick<User, 'role' | 'is_active'>>) {
    setError('')
    try { const nu = await api.updateUser(u.id, patch); setUsers((list) => list?.map((x) => (x.id === nu.id ? nu : x)) ?? null) }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <>
      <PageHeader title="Users" description="Manage who can use CardioSense. Deactivated users are signed out immediately and cannot sign back in." />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {overview && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Users" value={overview.users} />
          <Stat label="Assessments" value={overview.predictions.toLocaleString()} />
          <Stat label="Batch uploads" value={overview.batches} />
        </div>
      )}
      <section className="panel overflow-x-auto">
        {!users ? <div className="flex justify-center py-16 text-slate"><Spinner className="h-6 w-6" /></div> : (
          <table className="w-full min-w-[640px]">
            <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th text-right">Assessments</th><th className="th">Joined</th><th className="th text-right">Access</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                  <td className="td"><span className="font-medium">{u.full_name}</span><span className="block text-xs text-slate">{u.email}</span></td>
                  <td className="td">
                    <select className="input w-36 py-1.5" value={u.role} disabled={u.id === me?.id} onChange={(e) => update(u, { role: e.target.value as User['role'] })} aria-label={`Role for ${u.full_name}`}>
                      <option value="clinician">Clinician</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="td text-right tabular-nums">{overview?.per_user[u.id] ?? 0}</td>
                  <td className="td text-slate">{formatDate(u.created_at, false)}</td>
                  <td className="td text-right">
                    {u.id === me?.id ? <span className="text-xs text-slate">You</span> : (
                      <button className={u.is_active ? 'btn-danger py-1.5' : 'btn-quiet py-1.5'} onClick={() => update(u, { is_active: !u.is_active })}>
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

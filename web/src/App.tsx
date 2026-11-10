import { AppShell } from './components/layout/AppShell.tsx'
import { Skeleton } from './components/ui/Skeleton.tsx'
import { LoginPage } from './features/auth/LoginPage.tsx'
import { useSession } from './hooks/useSession.ts'

export default function App() {
  const { session, login, logout } = useSession()

  if (session.status === 'checking') return <div className="centered"><Skeleton rows={2} /></div>
  if (session.status === 'anonymous') return <LoginPage login={login} />
  return <AppShell user={session.user} onLogout={logout} />
}

import { useEffect, useRef } from 'react'
import type { User } from '@tres-eixos/contracts'
import { findRoute, ROUTES } from '../../app/routes.ts'
import { useHashRoute } from '../../hooks/useHashRoute.ts'
import { ErrorBoundary } from '../ErrorBoundary.tsx'
import { Sidebar } from './Sidebar.tsx'

type AppShellProps = { user: User; onLogout: () => void }

/** Layout autenticado: menu lateral + conteúdo da rota atual. */
export function AppShell({ user, onLogout }: AppShellProps) {
  const route = findRoute(useHashRoute().route.path)
  const mainRef = useRef<HTMLElement>(null)

  // Ao trocar de seção, o foco vai para o conteúdo novo (teclado e leitores de tela).
  // Mudar só o item aberto ou um filtro (mesma seção) não rouba o foco.
  useEffect(() => {
    mainRef.current?.focus()
    document.title = `${route.label} · Três Eixos`
  }, [route])

  const { Page } = route
  return (
    <div className="app">
      <a href="#conteudo" className="skip-link" onClick={(event) => { event.preventDefault(); mainRef.current?.focus() }}>
        Pular para o conteúdo
      </a>
      <Sidebar routes={ROUTES} currentPath={route.path} user={user} onLogout={onLogout} />
      <main id="conteudo" ref={mainRef} tabIndex={-1} className="content">
        <ErrorBoundary key={route.path} label={`a seção ${route.label}`}>
          <Page />
        </ErrorBoundary>
      </main>
    </div>
  )
}

import type { AppRoute } from '../../app/routes.ts'
import type { User } from '@tres-eixos/contracts'
import { initials } from '../../lib/format.ts'
import { Icon } from '../ui/Icon.tsx'

type SidebarProps = { routes: AppRoute[]; currentPath: string; user: User; onLogout: () => void }

export function Sidebar({ routes, currentPath, user, onLogout }: SidebarProps) {
  return (
    <aside className="sidebar glass-strong">
      <div className="brand">
        <span className="brand-mark" aria-hidden>3E</span>
        <span className="brand-name">Três Eixos</span>
      </div>
      <nav aria-label="Seções">
        <ul className="nav-list">
          {routes.map((route) => (
            <li key={route.path}>
              <a
                className="nav-link"
                href={`#/${route.path}`}
                aria-current={route.path === currentPath ? 'page' : undefined}
              >
                <Icon name={route.icon} />
                <span>{route.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar-user">
        <span className="avatar" aria-hidden>{initials(user.name)}</span>
        <span className="user-name">{user.name}</span>
        <button type="button" className="icon-button" onClick={onLogout} aria-label="Sair">
          <Icon name="logout" />
        </button>
      </div>
    </aside>
  )
}

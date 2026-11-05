import { useEffect, useState } from 'react'

function readHash(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

/** Rota atual a partir do hash da URL (#/pedidos). Funciona sem configuração no servidor. */
export function useHashRoute(): string {
  const [route, setRoute] = useState(readHash)

  useEffect(() => {
    const update = () => setRoute(readHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  return route
}

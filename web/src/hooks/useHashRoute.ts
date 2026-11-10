import { useCallback, useEffect, useState } from 'react'
import { buildHash, parseHash, type HashRoute } from '../lib/hash.ts'

function readRoute(): HashRoute {
  return parseHash(window.location.hash)
}

/**
 * Rota atual a partir do hash da URL (#/pedidos/<id>?status=ready&page=2) e a função para mudá-la.
 * Seção, item aberto e filtros vivem na URL: recarregar ou compartilhar o link preserva o contexto.
 * Funciona sem configuração no servidor.
 */
export function useHashRoute(): { route: HashRoute; navigate: (next: Parameters<typeof buildHash>[0]) => void } {
  const [route, setRoute] = useState(readRoute)

  useEffect(() => {
    const update = () => setRoute(readRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  const navigate = useCallback((next: Parameters<typeof buildHash>[0]) => {
    window.location.hash = buildHash(next)
  }, [])

  return { route, navigate }
}

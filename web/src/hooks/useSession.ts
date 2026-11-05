import { useCallback, useEffect, useState } from 'react'
import { onUnauthorized } from '../api/client.ts'
import { authApi } from '../api/endpoints.ts'
import type { User } from '../api/types.ts'

export type Session =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User }

/** Estado da sessão: verifica o cookie ao abrir, faz login/logout e reage a sessão expirada. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'checking' })

  const expire = useCallback(() => setSession({ status: 'anonymous' }), [])

  useEffect(() => {
    onUnauthorized(expire)
    authApi
      .me()
      .then((user) => setSession({ status: 'authenticated', user }))
      .catch(expire)
  }, [expire])

  const login = useCallback(async (email: string, password: string) => {
    const user = await authApi.login(email, password)
    setSession({ status: 'authenticated', user })
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined)
    expire()
  }, [expire])

  return { session, login, logout }
}

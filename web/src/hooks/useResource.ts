import { useCallback, useEffect, useState } from 'react'
import { describeError } from '../lib/errors.ts'

export type Resource<T> = {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Carrega dados assíncronos e expõe carregamento, erro e recarga.
 * `key` identifica os parâmetros da carga: quando muda, recarrega; respostas antigas são ignoradas.
 */
export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    load()
      .then((result) => current && setData(result))
      .catch((reason: unknown) => current && setError(describeError(reason)))
      .finally(() => current && setLoading(false))
    return () => {
      current = false
    }
    // `load` muda a cada render; a identidade da carga é dada por `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading, error, reload }
}

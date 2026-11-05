import { useEffect, useState } from 'react'

/** Devolve `value` só depois que ele para de mudar por `delayMs` (evita uma requisição por tecla). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

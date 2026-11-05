import { useCallback, useRef, useState } from 'react'
import { describeError } from '../lib/errors.ts'

export type Feedback = { kind: 'success' | 'error'; text: string } | null

export type Action = {
  busy: boolean
  feedback: Feedback
  fail: (text: string) => void
  run: (work: () => Promise<unknown>, successText: string) => Promise<boolean>
}

/**
 * Executa ações de escrita uma de cada vez: enquanto uma está em andamento, novas chamadas são
 * ignoradas e `busy` desabilita os botões (prevenção de envio duplo). Devolve true em caso de sucesso.
 */
export function useAction(): Action {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const running = useRef(false)

  const run = useCallback(async (work: () => Promise<unknown>, successText: string) => {
    if (running.current) return false
    running.current = true
    setBusy(true)
    setFeedback(null)
    try {
      await work()
      setFeedback({ kind: 'success', text: successText })
      return true
    } catch (error) {
      setFeedback({ kind: 'error', text: describeError(error) })
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])

  const fail = useCallback((text: string) => setFeedback({ kind: 'error', text }), [])

  return { busy, feedback, fail, run }
}

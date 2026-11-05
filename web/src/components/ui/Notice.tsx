import type { Feedback } from '../../hooks/useAction.ts'
import { Icon } from './Icon.tsx'

/** Resultado de uma ação, anunciado por leitores de tela (aria-live). */
export function Notice({ feedback }: { feedback: Feedback }) {
  return (
    <div aria-live="polite" role="status" className="notice-slot">
      {feedback && (
        <p className={`notice notice-${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          {feedback.text}
        </p>
      )}
    </div>
  )
}

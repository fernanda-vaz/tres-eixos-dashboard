import type { FormEvent, ReactNode } from 'react'
import type { Feedback } from '../../hooks/useAction.ts'
import { Notice } from './Notice.tsx'

type FormProps = {
  onSubmit: () => void
  children: ReactNode
  feedback?: Feedback
  /** 'grid' distribui campos em colunas; 'inline' coloca tudo em uma linha. */
  layout?: 'grid' | 'inline'
  label?: string
}

/** Formulário com preventDefault e área de feedback anunciada a leitores de tela. */
export function Form({ onSubmit, children, feedback, layout = 'grid', label }: FormProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }
  return (
    <form onSubmit={handleSubmit} aria-label={label} className="form">
      <div className={layout === 'grid' ? 'form-grid' : 'form-inline'}>{children}</div>
      {feedback !== undefined && <Notice feedback={feedback} />}
    </form>
  )
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="form-actions">{children}</div>
}

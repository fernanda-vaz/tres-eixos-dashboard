import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/Button.tsx'

type ErrorBoundaryProps = {
  children: ReactNode
  /** Nome do trecho protegido, para a mensagem ("esta seção", "o painel"). */
  label?: string
}

type ErrorBoundaryState = { error: Error | null }

/**
 * Um erro de renderização (dado inesperado da API, bug numa tela) derruba só o trecho protegido,
 * com mensagem e botão para tentar de novo, em vez de deixar a página em branco.
 * Para descartar o erro ao trocar de rota, o pai passa `key={rota}`: o boundary remonta limpo.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro de renderização', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const label = this.props.label ?? 'esta seção'
    return (
      <div className="notice notice-error error-boundary" role="alert">
        <p>
          <strong>Algo deu errado em {label}.</strong> O restante do painel continua funcionando.
          {' '}<span className="muted">({this.state.error.message})</span>
        </p>
        <div className="actions-row">
          <Button size="sm" icon="refresh" onClick={() => this.setState({ error: null })}>Tentar de novo</Button>
          <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>Recarregar a página</Button>
        </div>
      </div>
    )
  }
}

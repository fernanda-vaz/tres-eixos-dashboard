import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { useLoginForm } from './useLoginForm.ts'

export function LoginPage({ login }: { login: (email: string, password: string) => Promise<void> }) {
  const form = useLoginForm(login)
  return (
    <main className="login">
      <div className="login-card glass-strong">
        <div className="brand">
          <span className="brand-mark" aria-hidden>3E</span>
          <span className="brand-name">Três Eixos</span>
        </div>
        <h1 className="login-title">Entrar no painel</h1>
        <p className="muted">Pedidos, estoque e produção da sua impressão 3D.</p>
        <Form onSubmit={form.submit} feedback={form.action.feedback} label="Login">
          <TextField label="E-mail" type="email" autoComplete="username" required className="span-2"
            value={form.email} onValueChange={form.setEmail} />
          <TextField label="Senha" type="password" autoComplete="current-password" required className="span-2"
            value={form.password} onValueChange={form.setPassword} />
          <Button type="submit" variant="primary" className="span-2" loading={form.action.busy} loadingText="Entrando…">Entrar</Button>
        </Form>
      </div>
    </main>
  )
}

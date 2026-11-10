import { useState } from 'react'
import { useAction } from '../../hooks/useAction.ts'

/** Estado do formulário de login; `login` vem do useSession. */
export function useLoginForm(login: (email: string, password: string) => Promise<void>) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const action = useAction()
  const submit = () => action.run(() => login(email, password), 'Bem-vinda!')
  return { email, setEmail, password, setPassword, submit, action }
}

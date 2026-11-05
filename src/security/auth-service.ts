import { AppError, UnauthorizedError } from "../http/errors.js"
import type { Credentials } from "./auth-input.js"
import { LoginLimiter } from "./login-limiter.js"
import { getDummyHash, verifyPassword } from "./password.js"
import { findUserByEmail, type SessionUser } from "./user-repository.js"

const LOGIN_WINDOW_MS = 15 * 60 * 1000

// Três limites por janela de 15 minutos:
// - por IP: protege contra um único cliente testando muitas contas;
// - por IP + e-mail: o limite apertado para quem erra a própria senha;
// - por conta (só e-mail): impede que trocar de IP dê novas tentativas contra a mesma conta.
//   Efeito colateral aceito: um ataque distribuído pode bloquear a conta por até 15 minutos.
const attemptsByIp = new LoginLimiter(50, LOGIN_WINDOW_MS)
const attemptsByIpAndEmail = new LoginLimiter(5, LOGIN_WINDOW_MS)
const attemptsByAccount = new LoginLimiter(20, LOGIN_WINDOW_MS)

async function withinLimits(ip: string, email: string): Promise<boolean> {
  // Todos os contadores avançam (sem curto-circuito), para não haver brecha entre eles.
  const results = await Promise.all([
    attemptsByIp.consume(ip),
    attemptsByIpAndEmail.consume(`${ip}|${email}`),
    attemptsByAccount.consume(`account|${email}`),
  ])
  return results.every(Boolean)
}

/**
 * Confere e-mail e senha respeitando os limites de tentativa.
 * E-mail inexistente, conta inativa e senha errada dão a mesma resposta, no mesmo tempo.
 */
export async function authenticate(credentials: Credentials, ip: string): Promise<SessionUser> {
  if (!(await withinLimits(ip, credentials.email))) {
    throw new AppError(429, "Muitas tentativas de login. Tente novamente mais tarde.")
  }

  const user = await findUserByEmail(credentials.email)
  const valid = await verifyPassword(credentials.password, user?.passwordHash ?? (await getDummyHash()))
  if (!user || !user.active || !valid) throw new UnauthorizedError("E-mail ou senha inválidos")

  // Login certo zera os contadores da conta; o do IP segue valendo até o fim da janela.
  await Promise.all([attemptsByIpAndEmail.reset(`${ip}|${credentials.email}`), attemptsByAccount.reset(`account|${credentials.email}`)])
  return { id: user.id, email: user.email, name: user.name }
}

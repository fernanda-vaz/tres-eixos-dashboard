import { Router } from "express"
import { parseCredentials } from "./auth-input.js"
import { authenticate } from "./auth-service.js"
import { generateToken } from "./csrf.js"
import { requireAuth } from "./require-auth.js"
import { destroySession, regenerateSession, saveSession, SESSION_COOKIE } from "./session.js"

const ANONYMOUS_SESSION_MS = 10 * 60 * 1000

export function createAuthRouter(): Router {
  const router = Router()

  // O painel pede um token antes do login: o próprio login também é protegido contra CSRF.
  // Sem login, a sessão existe só para guardar esse token: vale 10 minutos (e não 12 horas),
  // para que chamadas anônimas repetidas não acumulem sessões no banco. O login cria outra.
  router.get("/auth/csrf", (req, res) => {
    if (!req.session.userId) req.session.cookie.maxAge = ANONYMOUS_SESSION_MS
    res.json({ csrfToken: generateToken(req) })
  })

  router.post("/auth/login", async (req, res) => {
    const user = await authenticate(parseCredentials(req.body), req.ip ?? "unknown")
    // Nova sessão a cada login (evita fixação de sessão) e novo token CSRF.
    await regenerateSession(req)
    req.session.userId = user.id
    const csrfToken = generateToken(req, true)
    await saveSession(req)
    res.json({ user, csrfToken })
  })

  router.get("/auth/me", requireAuth, (req, res) => {
    res.json({ user: res.locals.user, csrfToken: generateToken(req) })
  })

  router.post("/auth/logout", async (req, res) => {
    await destroySession(req)
    res.clearCookie(SESSION_COOKIE, { path: "/" })
    res.status(204).end()
  })

  return router
}

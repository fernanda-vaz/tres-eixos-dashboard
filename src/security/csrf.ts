import { csrfSync } from "csrf-sync"

// Synchronizer token: o token fica na sessão e o painel o envia no cabeçalho X-CSRF-Token.
export const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.get("x-csrf-token"),
})

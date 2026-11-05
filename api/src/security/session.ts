import connectPgSimple from "connect-pg-simple"
import type { Request, RequestHandler } from "express"
import session from "express-session"
import { pool } from "../db.js"

declare module "express-session" {
  interface SessionData {
    userId: string
  }
}

export const SESSION_COOKIE = "tres_eixos_sid"
const SESSION_HOURS = 12
const PgStore = connectPgSimple(session)

/** Sessões persistidas no PostgreSQL (tabela user_sessions); nunca o MemoryStore padrão. */
export const sessionStore = new PgStore({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: false,
  pruneSessionInterval: process.env.NODE_ENV === "test" ? false : 15 * 60,
})

export function createSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET deve ter ao menos 32 caracteres")
  }
  return session({
    name: SESSION_COOKIE,
    store: sessionStore,
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // Cookie Secure exige HTTPS: ligado em produção (atrás do proxy configurado em TRUST_PROXY).
      secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
      maxAge: SESSION_HOURS * 60 * 60 * 1000,
    },
  })
}

// Versões em Promise dos métodos de sessão baseados em callback.

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())))
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())))
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())))
}

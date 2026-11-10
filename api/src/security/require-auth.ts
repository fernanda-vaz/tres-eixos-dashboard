import type { RequestHandler } from "express"
import { pool } from "../db.js"
import { UnauthorizedError } from "../http/errors.js"
import { findActiveUserById } from "./user-repository.js"

/**
 * Exige sessão de um usuário ativo. Deve vir depois do middleware de sessão.
 * Consulta o banco a cada requisição de propósito: desativar a conta tem efeito imediato.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = req.session.userId
  const user = userId ? await findActiveUserById(pool, userId) : null
  if (!user) throw new UnauthorizedError()
  res.locals.user = user
  next()
}

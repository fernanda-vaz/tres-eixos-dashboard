import type { RequestHandler } from "express"
import { UnauthorizedError } from "../http/errors.js"
import { findActiveUserById } from "./user-repository.js"

/** Exige sessão de um usuário ativo. Deve vir depois do middleware de sessão. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = req.session.userId
  const user = userId ? await findActiveUserById(userId) : null
  if (!user) throw new UnauthorizedError()
  res.locals.user = user
  next()
}

import { AppError } from "../http/errors.js"
import { allowOnly, parseObject, parseText } from "../http/validation.js"
import { PASSWORD_MAX_LENGTH } from "./password.js"

export type Credentials = { email: string; password: string }

export function parseCredentials(body: unknown): Credentials {
  const data = parseObject(body)
  allowOnly(data, ["email", "password"])
  const email = parseText(data.email, "email", 254).toLowerCase()
  if (typeof data.password !== "string" || !data.password || data.password.length > PASSWORD_MAX_LENGTH) {
    throw new AppError(400, "password obrigatório")
  }
  return { email, password: data.password }
}

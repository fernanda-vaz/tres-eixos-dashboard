import express from "express"
import { catalogRouter } from "./catalog/routes.js"
import { dashboardRouter } from "./dashboard/routes.js"
import { pool } from "./db.js"
import { registerFulfillment } from "./fulfillment/index.js"
import { errorHandler } from "./http/errors.js"
import { metrics } from "./http/metrics.js"
import { requestLog } from "./http/request-log.js"
import { integrationsRouter } from "./integrations/routes.js"
import { inventoryRouter } from "./inventory/routes.js"
import { ordersRouter } from "./orders/routes.js"
import { outboxRouter } from "./outbox/routes.js"
import { outboxStats } from "./outbox/worker.js"
import { pricingRouter } from "./pricing/routes.js"
import { productionRouter } from "./production/routes.js"
import { csrfSynchronisedProtection } from "./security/csrf.js"
import { requireAuth } from "./security/require-auth.js"
import { createAuthRouter } from "./security/routes.js"
import { createSessionMiddleware } from "./security/session.js"

/** Corpo JSON comum. A importação de pedidos (50 pedidos × 50 itens) precisa de mais. */
export const BODY_LIMIT = "32kb"
export const IMPORT_BODY_LIMIT = "256kb"

// Composição: os módulos de estoque e produção avisam quando o saldo sobe; o fulfillment escuta.
registerFulfillment()

export const app = express()
let shuttingDown = false

app.disable("x-powered-by")
// Atrás de proxy reverso (nginx, Caddy), informe quantos proxies são confiáveis: o Express então
// usa o IP real do cliente e reconhece HTTPS para o cookie Secure. Nunca confie em todos os headers.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY)
}
app.use(requestLog)
// Cabeçalhos defensivos também nas respostas JSON; o HTML do painel recebe os seus do nginx (web/nginx.conf).
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" })
  next()
})
const jsonBody = express.json({ limit: BODY_LIMIT })
const importBody = express.json({ limit: IMPORT_BODY_LIMIT })
app.use((req, res, next) => (req.path === "/imports/orders" ? importBody : jsonBody)(req, res, next))

export function markShuttingDown(): void {
  shuttingDown = true
}

// Rotas públicas: processo vivo e dependência do banco.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "tres-eixos" })
})

app.get("/ready", async (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: "not_ready" })
  try {
    await pool.query("SELECT 1")
    res.json({ status: "ready" })
  } catch {
    res.status(503).json({ status: "not_ready" })
  }
})

// Daqui em diante: sessão em cookie, CSRF em toda escrita e autenticação nas rotas de negócio.
// Sem middleware de CORS: o painel acessa a API pela mesma origem, via proxy /api.
app.use(createSessionMiddleware())
app.use(csrfSynchronisedProtection)
app.use(createAuthRouter())
app.use(requireAuth)
app.use(catalogRouter)
app.use(inventoryRouter)
app.use(ordersRouter)
app.use(productionRouter)
app.use(integrationsRouter)
app.use(pricingRouter)
app.use(dashboardRouter)
app.use(outboxRouter)

// Contadores desta instância (requisições, 409, 500, latência por rota) e situação do outbox.
app.get("/metrics", async (_req, res) => {
  res.json({ ...metrics.snapshot(), outbox: await outboxStats(pool) })
})

app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada", code: "not_found" })
})
app.use(errorHandler)

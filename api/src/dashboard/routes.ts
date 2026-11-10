import { Router } from "express"
import { pool } from "../db.js"
import { loadDashboardSummary } from "./dashboard-repository.js"

export const dashboardRouter = Router()

/** Tudo que a visão geral mostra, em uma requisição. */
dashboardRouter.get("/dashboard/summary", async (_req, res) => {
  res.json(await loadDashboardSummary(pool))
})

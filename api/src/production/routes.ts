import { Router } from "express"
import {
  parseActualGrams,
  parseHeldJobDecision,
  parseJobCancelReason,
  parseJobId,
  parseJobListQuery,
  parsePriorityChange,
  parseStockJob,
} from "./production-input.js"
import {
  cancelJob,
  completeJob,
  createStockJob,
  decideHeldJob,
  getJob,
  getJobs,
  setPriority,
  startJob,
} from "./production-service.js"

export const productionRouter = Router()

productionRouter.get("/production/jobs", async (req, res) => {
  const { filter, page } = parseJobListQuery(req.query)
  res.json(await getJobs(filter, page))
})

productionRouter.post("/production/jobs", async (req, res) => {
  res.status(201).json(await createStockJob(parseStockJob(req.body)))
})

productionRouter.get("/production/jobs/:id", async (req, res) => {
  res.json(await getJob(req.params.id))
})

productionRouter.post("/production/jobs/:id/start", async (req, res) => {
  res.json(await startJob(parseJobId(req.params.id)))
})

productionRouter.post("/production/jobs/:id/complete", async (req, res) => {
  const jobId = parseJobId(req.params.id)
  res.json(await completeJob(jobId, parseActualGrams(req.body)))
})

productionRouter.post("/production/jobs/:id/cancel", async (req, res) => {
  const jobId = parseJobId(req.params.id)
  res.json(await cancelJob(jobId, parseJobCancelReason(req.body)))
})

productionRouter.post("/production/jobs/:id/decision", async (req, res) => {
  const jobId = parseJobId(req.params.id)
  res.json(await decideHeldJob(jobId, parseHeldJobDecision(req.body)))
})

productionRouter.put("/production/jobs/:id/priority", async (req, res) => {
  const jobId = parseJobId(req.params.id)
  res.json(await setPriority(jobId, parsePriorityChange(req.body)))
})

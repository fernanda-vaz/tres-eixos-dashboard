import assert from "node:assert/strict"
import test from "node:test"
import { blockingMaterials, compareQueue, gramsToMilli } from "../src/production/production-rules.js"

const base = { priority: 0, orderedAt: new Date("2026-11-01T10:00:00Z"), createdAt: new Date("2026-11-01T10:00:00Z") }

test("fila: prazo mais próximo primeiro, sem prazo por último, depois data do pedido", () => {
  const jobs = [
    { ...base, id: "sem-prazo", shipBy: null },
    { ...base, id: "prazo-tarde", shipBy: new Date("2026-11-10T00:00:00Z") },
    { ...base, id: "prazo-cedo", shipBy: new Date("2026-11-05T00:00:00Z") },
    { ...base, id: "pediu-antes", shipBy: null, orderedAt: new Date("2026-10-30T00:00:00Z") },
  ]
  assert.deepEqual(jobs.sort(compareQueue).map((job) => job.id), ["prazo-cedo", "prazo-tarde", "pediu-antes", "sem-prazo"])
})

test("fila: prioridade manual vem antes do prazo", () => {
  const urgent = { ...base, id: "a", shipBy: null, priority: 10 }
  const dated = { ...base, id: "b", shipBy: new Date("2026-11-02T00:00:00Z") }
  assert.deepEqual([dated, urgent].sort(compareQueue).map((job) => job.id), ["a", "b"])
})

test("falta de cor aparece como bloqueio, comparando gramas sem ponto flutuante", () => {
  const needs = [
    { materialId: "1", name: "PLA", color: "Azul", requiredGrams: "30.100", availableGrams: "30.1" },
    { materialId: "2", name: "PLA", color: "Rosa", requiredGrams: "45.000", availableGrams: "44.999" },
  ]
  assert.deepEqual(blockingMaterials(needs).map((need) => need.color), ["Rosa"])
  assert.equal(gramsToMilli("0.1") + gramsToMilli("0.2"), gramsToMilli("0.3"))
})

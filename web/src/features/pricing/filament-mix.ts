import type { Material, ProductPricing } from '@tres-eixos/contracts'

export type FilamentLine = ProductPricing['materials'][number]

export type MixSummary = {
  totalGrams: number
  totalCostCents: number
  shares: { materialId: string; label: string; percent: number }[]
}

/** Total de gramas e custo da receita, e quanto cada cor representa do peso da peça. */
export function summarizeMix(lines: FilamentLine[]): MixSummary {
  const totalGrams = lines.reduce((sum, line) => sum + Number(line.grams), 0)
  return {
    totalGrams,
    totalCostCents: lines.reduce((sum, line) => sum + line.costCents, 0),
    shares: lines.map((line) => ({
      materialId: line.materialId,
      label: `${line.name} ${line.color}`,
      percent: totalGrams > 0 ? Math.round((Number(line.grams) / totalGrams) * 100) : 0,
    })),
  }
}

/** Filamentos cadastrados que ainda não estão na receita (opções para adicionar uma cor). */
export function availableFilaments(materials: Material[], lines: FilamentLine[]): Material[] {
  const used = new Set(lines.map((line) => line.materialId))
  return materials.filter((material) => material.active && !used.has(material.id))
}

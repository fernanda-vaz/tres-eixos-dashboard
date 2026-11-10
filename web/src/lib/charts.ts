export type Arc<T> = { item: T; length: number; offset: number }

/**
 * Divide a circunferência entre os valores (zeros ficam de fora).
 * offset = quanto do traço já foi usado pelos arcos anteriores.
 */
export function donutArcs<T extends { value: number }>(items: T[], circumference: number): Arc<T>[] {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0) return []
  const visible = items.filter((item) => item.value > 0)
  const lengths = visible.map((item) => (item.value / total) * circumference)
  return visible.map((item, index) => ({
    item,
    length: lengths[index],
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }))
}

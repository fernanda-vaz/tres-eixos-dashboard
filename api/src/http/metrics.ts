// Contadores em memória do processo: zeram a cada reinício e valem para esta instância.
// Suficiente para ver, em GET /metrics, quantos 409/500 e quanta latência o painel está gerando.

type Histogram = { count: number; totalMs: number; maxMs: number }

class Metrics {
  private readonly counters = new Map<string, number>()
  private readonly histograms = new Map<string, Histogram>()
  readonly startedAt = new Date()

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by)
  }

  observe(name: string, valueMs: number): void {
    const current = this.histograms.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 }
    current.count += 1
    current.totalMs += valueMs
    current.maxMs = Math.max(current.maxMs, valueMs)
    this.histograms.set(name, current)
  }

  snapshot(): { startedAt: string; counters: Record<string, number>; timings: Record<string, Histogram & { avgMs: number }> } {
    const timings: Record<string, Histogram & { avgMs: number }> = {}
    for (const [name, value] of this.histograms) {
      timings[name] = { ...value, avgMs: value.count ? Math.round(value.totalMs / value.count) : 0 }
    }
    return { startedAt: this.startedAt.toISOString(), counters: Object.fromEntries(this.counters), timings }
  }
}

export const metrics = new Metrics()

import assert from 'node:assert/strict'
import test from 'node:test'
import { breakdownBars, formToSettings, formToSheet, marginTone, settingsToForm, sheetToForm } from './pricing-view.ts'

test('ficha: ida e volta entre formulário e API; campo inválido bloqueia', () => {
  const sheet = { printMinutes: 150, purgeGrams: '12.5', laborMinutes: 20, packagingCents: 150, extraCents: 0, targetMarginPercent: 30 }
  assert.deepEqual(formToSheet(sheetToForm(sheet)), sheet)
  assert.equal(formToSheet({ ...sheetToForm(sheet), printMinutes: '1,5' }), null)
  assert.equal(formToSheet({ ...sheetToForm(sheet), targetMargin: '95' }), null)
})

test('configuração: vida útil zero é inválida', () => {
  const settings = { energyCentsPerKwh: 95, printerPowerWatts: 120, printerPriceCents: 300000, printerLifetimeHours: 5000,
    laborCentsPerHour: 3000, failureRatePercent: 10, taxRatePercent: 6 }
  assert.deepEqual(formToSettings(settingsToForm(settings)), settings)
  assert.equal(formToSettings({ ...settingsToForm(settings), printerLifetimeHours: '0' }), null)
})

test('composição do custo: maior primeiro, sem zeros', () => {
  const bars = breakdownBars({ filamentCents: 480, purgeCents: 0, energyCents: 30, depreciationCents: 150, failureCents: 66,
    laborCents: 1000, packagingCents: 150, extraCents: 0, unitCostCents: 1876 })
  assert.equal(bars[0].label, 'Mão de obra')
  assert.ok(!bars.some((bar) => bar.label === 'Outros custos'))
})

test('tom da margem: prejuízo, abaixo da meta e na meta', () => {
  assert.equal(marginTone(-5, 30), 'danger')
  assert.equal(marginTone(12, 30), 'warning')
  assert.equal(marginTone(30, 30), 'success')
  assert.equal(marginTone(null, 30), 'neutral')
})

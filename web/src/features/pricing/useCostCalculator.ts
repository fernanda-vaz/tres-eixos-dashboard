import { useState } from 'react'
import { pricingApi, productsApi } from '../../api/endpoints.ts'
import type { PricingChannel, PriceResult } from '@tres-eixos/contracts'
import { useAction } from '../../hooks/useAction.ts'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts'
import { useResource } from '../../hooks/useResource.ts'
import { formatCents } from '../../lib/format.ts'
import { formToSheet, sheetToForm, type SheetForm } from './pricing-view.ts'

const PREVIEW_DELAY_MS = 350

/**
 * Calculadora de um produto: carrega a ficha salva, recalcula (sem salvar) enquanto a ficha
 * é editada, salva a ficha e aplica um preço sugerido ao produto.
 */
export function useCostCalculator(onChanged: () => void) {
  const [productId, setProductId] = useState('')
  const [version, setVersion] = useState(0)
  // Muda quando filamentos/preços mudam: recalcula sem descartar a ficha em edição.
  const [costVersion, setCostVersion] = useState(0)
  // Guarda só o que foi editado, marcado com a carga a que pertence; sem edição, vale a ficha salva.
  const [edits, setEdits] = useState<{ loadKey: string; values: SheetForm } | null>(null)
  // Ações separadas: salvar a ficha e aplicar um preço têm cada uma seu feedback.
  const saveAction = useAction()
  const applyAction = useAction()

  const saved = useResource(
    () => (productId ? pricingApi.productPricing(productId) : Promise.resolve(null)),
    `pricing|${productId}|${version}|${costVersion}`,
  )

  const loadKey = `${productId}|${version}`
  const savedData = saved.data?.product.id === productId ? saved.data : null
  const form = savedData ? (edits?.loadKey === loadKey ? edits.values : sheetToForm(savedData.sheet)) : null

  const sheet = form ? formToSheet(form) : null
  const draftKey = useDebouncedValue(sheet ? JSON.stringify(sheet) : '', PREVIEW_DELAY_MS)
  const preview = useResource(
    () => (productId && draftKey ? pricingApi.preview(productId, JSON.parse(draftKey)) : Promise.resolve(null)),
    `preview|${productId}|${draftKey}|${costVersion}`,
  )

  const updateField = (name: keyof SheetForm, value: string) => {
    if (form) setEdits({ loadKey, values: { ...form, [name]: value } })
  }

  const reload = () => setVersion((value) => value + 1)
  const refreshCosts = () => setCostVersion((value) => value + 1)

  async function save() {
    if (!sheet) return saveAction.fail('Revise os campos: minutos inteiros, valores em reais e margem até 90%.')
    const done = await saveAction.run(() => pricingApi.saveCostSheet(productId, sheet), 'Ficha de custo salva.')
    if (done) {
      reload()
      onChanged()
    }
  }

  async function applyPrice(channel: PricingChannel, suggested: PriceResult) {
    const done = await applyAction.run(
      () => productsApi.update(productId, { priceCents: suggested.priceCents }),
      `Preço do produto atualizado para ${formatCents(suggested.priceCents)} (sugerido para ${channel.name}).`,
    )
    if (done) {
      reload()
      onChanged()
    }
  }

  return {
    productId,
    setProductId,
    form,
    updateField,
    formValid: sheet !== null,
    // Mostra a pré-visualização mais recente do produto atual; senão, o cálculo salvo.
    pricing: preview.data?.product.id === productId ? preview.data : savedData,
    calculating: preview.loading,
    loadError: saved.error,
    save,
    refreshCosts,
    applyPrice,
    saveAction,
    applyAction,
  }
}

export type CostCalculator = ReturnType<typeof useCostCalculator>

import { useState } from 'react'
import { inventoryApi, productsApi } from '../../api/endpoints.ts'
import { useAction } from '../../hooks/useAction.ts'
import { newIdempotencyKey } from '../../lib/idempotency.ts'
import { normalizeSku, parseNonZeroInteger } from '../../lib/parse.ts'

async function findProductIdBySku(sku: string): Promise<string> {
  const page = await productsApi.list({ search: sku, pageSize: 100 })
  const product = page.items.find((item) => item.sku === sku)
  if (!product) throw new Error(`SKU ${sku} não encontrado`)
  return product.id
}

/**
 * Ajuste de peças prontas por SKU. A mesma Idempotency-Key é reusada até o ajuste dar certo:
 * um clique repetido ou uma nova tentativa após erro de rede não duplica o ajuste.
 */
export function useStockAdjustment(onAdjusted: () => void) {
  const [sku, setSku] = useState('')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [key, setKey] = useState(() => newIdempotencyKey('ajuste'))
  const action = useAction()

  async function submit() {
    const amount = parseNonZeroInteger(delta)
    if (amount === null) return action.fail('Informe um número inteiro diferente de zero (ex.: 5 ou -2).')
    const target = normalizeSku(sku)
    const done = await action.run(async () => {
      const productId = await findProductIdBySku(target)
      await inventoryApi.adjust({ productId, delta: amount, reason }, key)
    }, `Estoque de ${target} ajustado em ${amount > 0 ? '+' : ''}${amount}.`)
    if (!done) return
    setDelta('')
    setReason('')
    setKey(newIdempotencyKey('ajuste'))
    onAdjusted()
  }

  return { sku, setSku, delta, setDelta, reason, setReason, submit, action }
}

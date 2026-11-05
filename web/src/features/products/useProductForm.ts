import { useState } from 'react'
import { productsApi } from '../../api/endpoints.ts'
import { useAction } from '../../hooks/useAction.ts'
import { normalizeSku, parseReaisToCents } from '../../lib/parse.ts'

/** Estado e envio do cadastro de produto. Preço digitado em reais, enviado em centavos. */
export function useProductForm(onCreated: () => void) {
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const action = useAction()

  async function submit() {
    const priceCents = parseReaisToCents(price)
    if (priceCents === null) return action.fail('Preço inválido. Use, por exemplo, 15,90.')
    const done = await action.run(
      () => productsApi.create({ sku, name, priceCents }),
      `Produto ${normalizeSku(sku)} cadastrado.`,
    )
    if (!done) return
    setSku('')
    setName('')
    setPrice('')
    onCreated()
  }

  return { sku, setSku, name, setName, price, setPrice, submit, action }
}

import { useState } from 'react'
import { materialsApi, productsApi } from '../../api/endpoints.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'
import { centsToInput, parseGrams, parseReaisToCents } from '../../lib/parse.ts'

/** Filamentos cadastrados (até 100) e produtos ativos, usados pela tela e pelo editor de receita. */
export function useMaterials() {
  const materials = useResource(() => materialsApi.list({ pageSize: 100 }), 'materials')
  const products = useResource(() => productsApi.list({ pageSize: 100, active: true }), 'active-products')
  return { materials, products }
}

export function useMaterialForm(onCreated: () => void) {
  const [name, setName] = useState('PLA')
  const [color, setColor] = useState('')
  const action = useAction()

  async function submit() {
    const done = await action.run(() => materialsApi.create({ name, color }), `Material ${name} ${color} cadastrado.`)
    if (!done) return
    setColor('')
    onCreated()
  }

  return { name, setName, color, setColor, submit, action }
}

/** Entrada de rolo (positivo) ou ajuste (negativo), em gramas. */
export function useMaterialAdjustment(materialId: string, onDone: () => void) {
  const [grams, setGrams] = useState('')
  const action = useAction()

  async function submit() {
    const gramsDelta = parseGrams(grams, { allowNegative: true })
    if (!gramsDelta) return action.fail('Use gramas, ex.: 1000 ou -12,5.')
    const reason = gramsDelta.startsWith('-') ? 'Ajuste manual' : 'Entrada de rolo'
    const done = await action.run(() => materialsApi.adjust(materialId, { gramsDelta, reason }), 'Ajuste registrado.')
    if (!done) return
    setGrams('')
    onDone()
  }

  return { grams, setGrams, submit, action }
}

/** Receita de um produto: gramas de cada material por unidade. */
export function useRecipe() {
  const [productId, setProductId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [grams, setGrams] = useState('')
  const recipe = useResource(
    () => (productId ? materialsApi.recipe(productId) : Promise.resolve([])),
    `recipe|${productId}`,
  )
  const action = useAction()

  async function save() {
    const gramsPerUnit = parseGrams(grams)
    if (!gramsPerUnit) return action.fail('Informe gramas por unidade, ex.: 30 ou 12,5.')
    const done = await action.run(() => materialsApi.setRecipeLine(productId, materialId, gramsPerUnit), 'Receita atualizada.')
    if (!done) return
    setGrams('')
    recipe.reload()
  }

  async function remove(lineMaterialId: string, label: string) {
    const done = await action.run(() => materialsApi.removeRecipeLine(productId, lineMaterialId), `${label} removido da receita.`)
    if (done) recipe.reload()
  }

  return { productId, setProductId, materialId, setMaterialId, grams, setGrams, recipe, save, remove, action }
}

/** Preço pago por quilo do filamento (base do custo na calculadora de preços). */
export function useMaterialCost(materialId: string, costPerKgCents: number, onDone: () => void) {
  const [price, setPrice] = useState(costPerKgCents > 0 ? centsToInput(costPerKgCents) : '')
  const action = useAction()

  async function submit() {
    const cents = parseReaisToCents(price)
    if (cents === null) return action.fail('Use reais, ex.: 119,90.')
    if (await action.run(() => materialsApi.setCostPerKg(materialId, cents), 'Preço por kg salvo.')) onDone()
  }

  return { price, setPrice, submit, action }
}

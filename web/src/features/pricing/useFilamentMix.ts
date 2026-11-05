import { useState } from 'react'
import { materialsApi } from '../../api/endpoints.ts'
import type { Material } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'
import { formatCents } from '../../lib/format.ts'
import { centsToInput, gramsToInput, parseGrams, parseReaisToCents } from '../../lib/parse.ts'
import type { FilamentLine } from './filament-mix.ts'

/**
 * Filamentos (cores) da peça dentro da calculadora: a receita do produto e o preço por kg de cada
 * filamento. A receita é a mesma usada na produção para reservar filamento.
 */
export function useFilamentMix(productId: string, onChanged: () => void) {
  const materials = useResource(() => materialsApi.list({ pageSize: 100 }), 'mix-materials')
  const action = useAction()

  async function perform(work: () => Promise<unknown>, success: string) {
    if (!(await action.run(work, success))) return false
    materials.reload()
    onChanged()
    return true
  }

  return { materials, action, perform, productId }
}

export type FilamentMix = ReturnType<typeof useFilamentMix>

/**
 * Edição de uma cor da receita: gramas por peça (deste produto) e preço do kg (do filamento,
 * vale para todos os produtos que o usam). Só envia o que mudou.
 */
export function useFilamentLine(line: FilamentLine, mix: FilamentMix) {
  const [grams, setGrams] = useState(gramsToInput(line.grams))
  const [price, setPrice] = useState(line.costPerKgCents > 0 ? centsToInput(line.costPerKgCents) : '')

  async function save() {
    const gramsPerUnit = parseGrams(grams)
    const costPerKgCents = parseReaisToCents(price)
    if (!gramsPerUnit || costPerKgCents === null) {
      return mix.action.fail(`${line.name} ${line.color}: informe gramas maiores que zero e o preço do kg em reais.`)
    }
    await mix.perform(async () => {
      if (Number(gramsPerUnit) !== Number(line.grams)) {
        await materialsApi.setRecipeLine(mix.productId, line.materialId, gramsPerUnit)
      }
      if (costPerKgCents !== line.costPerKgCents) await materialsApi.setCostPerKg(line.materialId, costPerKgCents)
    }, `${line.name} ${line.color} atualizado.`)
  }

  const remove = () =>
    mix.perform(() => materialsApi.removeRecipeLine(mix.productId, line.materialId), `${line.name} ${line.color} removido da peça.`)

  return { grams, setGrams, price, setPrice, save, remove }
}

/** Adiciona uma cor à peça: um filamento já cadastrado ou um novo (tipo, cor e preço do kg). */
export function useAddFilament(mix: FilamentMix) {
  const [materialId, setMaterialId] = useState('')
  const [grams, setGrams] = useState('')
  const [newName, setNewName] = useState('PLA')
  const [newColor, setNewColor] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const creatingNew = materialId === NEW_FILAMENT

  function reset() {
    setMaterialId('')
    setGrams('')
    setNewColor('')
    setNewPrice('')
  }

  async function submit() {
    const gramsPerUnit = parseGrams(grams)
    if (!gramsPerUnit) return mix.action.fail('Informe quantos gramas desta cor a peça usa.')
    const newCost = creatingNew ? parseReaisToCents(newPrice) : 0
    if (newCost === null) return mix.action.fail('Informe o preço do kg do novo filamento em reais.')

    const done = await mix.perform(async () => {
      const targetId = creatingNew ? (await createFilament(newName, newColor, newCost)).id : materialId
      await materialsApi.setRecipeLine(mix.productId, targetId, gramsPerUnit)
    }, creatingNew ? `${newName} ${newColor} (${formatCents(newCost)}/kg) adicionado à peça.` : 'Cor adicionada à peça.')
    if (done) reset()
  }

  return {
    materialId, setMaterialId, grams, setGrams, creatingNew,
    newName, setNewName, newColor, setNewColor, newPrice, setNewPrice, submit,
  }
}

export const NEW_FILAMENT = '__novo__'

function createFilament(name: string, color: string, costPerKgCents: number): Promise<Material> {
  return materialsApi.create({ name, color, costPerKgCents })
}

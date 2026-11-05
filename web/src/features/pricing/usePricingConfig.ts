import { useState } from 'react'
import { pricingApi } from '../../api/endpoints.ts'
import type { PricingChannel } from '../../api/types.ts'
import { useAction } from '../../hooks/useAction.ts'
import { useResource } from '../../hooks/useResource.ts'
import { centsToInput, parsePercent, parseReaisToCents, percentToInput } from '../../lib/parse.ts'
import { formToSettings, settingsToForm, type SettingsForm } from './pricing-view.ts'

/** Configuração geral de custos (energia, impressora, hora de trabalho, falhas, imposto). */
export function usePricingSettings(onSaved: () => void) {
  const settings = useResource(pricingApi.settings, 'pricing-settings')
  // Sem edição, o formulário mostra a configuração salva; o estado guarda só o que foi editado.
  const [edits, setEdits] = useState<SettingsForm | null>(null)
  const form = edits ?? (settings.data ? settingsToForm(settings.data) : null)
  const action = useAction()

  const updateField = (name: keyof SettingsForm, value: string) => {
    if (form) setEdits({ ...form, [name]: value })
  }

  async function save() {
    const parsed = form ? formToSettings(form) : null
    if (!parsed) return action.fail('Revise os campos: valores em reais, números inteiros e percentuais até 50%.')
    const done = await action.run(() => pricingApi.saveSettings(parsed), 'Configuração salva. Os preços foram recalculados.')
    if (done) onSaved()
  }

  return { settings, form, updateField, save, action }
}

/** Canais de venda e suas tarifas. */
export function useChannels(onChanged: () => void) {
  const channels = useResource(pricingApi.channels, 'pricing-channels')
  const [newName, setNewName] = useState('')
  const action = useAction()

  async function perform(work: () => Promise<unknown>, success: string) {
    const done = await action.run(work, success)
    if (!done) return false
    channels.reload()
    onChanged()
    return true
  }

  const toggleActive = (channel: PricingChannel) =>
    perform(() => pricingApi.updateChannel(channel.id, { active: !channel.active }),
      channel.active ? `${channel.name} desativado.` : `${channel.name} reativado.`)

  async function create() {
    if (await perform(() => pricingApi.createChannel({ name: newName, feePercent: 0, fixedFeeCents: 0, active: true }), `Canal ${newName} criado.`)) {
      setNewName('')
    }
  }

  return { channels, newName, setNewName, create, toggleActive, perform, action }
}

export type Channels = ReturnType<typeof useChannels>

/** Edição das tarifas de um canal (percentual + valor fixo por venda). */
export function useChannelFees(channel: PricingChannel, channels: Channels) {
  const [fee, setFee] = useState(percentToInput(channel.feePercent))
  const [fixedFee, setFixedFee] = useState(centsToInput(channel.fixedFeeCents))

  async function save() {
    const feePercent = parsePercent(fee, 90)
    const fixedFeeCents = parseReaisToCents(fixedFee)
    if (feePercent === null || fixedFeeCents === null) {
      return channels.action.fail(`${channel.name}: use percentual até 90% e tarifa fixa em reais.`)
    }
    await channels.perform(() => pricingApi.updateChannel(channel.id, { feePercent, fixedFeeCents }), `Tarifas de ${channel.name} salvas.`)
  }

  return { fee, setFee, fixedFee, setFixedFee, save }
}

/** Custo × preço atual de todos os produtos ativos. */
export function useProductCosts() {
  const [page, setPage] = useState(1)
  const costs = useResource(() => pricingApi.productCosts({ page, pageSize: 20 }), `costs|${page}`)
  return { costs, setPage }
}

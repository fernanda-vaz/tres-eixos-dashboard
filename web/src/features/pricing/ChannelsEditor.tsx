import type { PricingChannel } from '../../api/types.ts'
import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { useChannelFees, useChannels, type Channels } from './usePricingConfig.ts'

function ChannelRow({ channel, channels }: { channel: PricingChannel; channels: Channels }) {
  const fees = useChannelFees(channel, channels)
  return (
    <li className={`channel-row ${channel.active ? '' : 'is-inactive'}`}>
      <strong className="channel-name">{channel.name}</strong>
      <Form layout="inline" onSubmit={fees.save} label={`Tarifas de ${channel.name}`}>
        <TextField label="Tarifa (%)" className="short" inputMode="decimal" value={fees.fee} onValueChange={fees.setFee} />
        <TextField label="Fixa por venda (R$)" className="short" inputMode="decimal" value={fees.fixedFee} onValueChange={fees.setFixedFee} />
        <Button type="submit" size="sm" disabled={channels.action.busy}>Salvar</Button>
        <Button size="sm" variant="ghost" disabled={channels.action.busy} onClick={() => channels.toggleActive(channel)}>
          {channel.active ? 'Desativar' : 'Reativar'}
        </Button>
      </Form>
    </li>
  )
}

/** Canais de venda e tarifas. Os valores dos marketplaces devem ser conferidos no site de cada um. */
export function ChannelsEditor({ onChanged }: { onChanged: () => void }) {
  const channels = useChannels(onChanged)
  return (
    <div className="stack">
      <p className="muted">Confira as tarifas atuais no site de cada marketplace: elas variam por categoria, anúncio e mudam com frequência.</p>
      <Notice feedback={channels.action.feedback} />
      <ResourceView resource={channels.channels} skeletonRows={3}>
        {(list) => (
          <ul className="channel-list">
            {list.map((channel) => <ChannelRow key={channel.id} channel={channel} channels={channels} />)}
          </ul>
        )}
      </ResourceView>
      <Form layout="inline" onSubmit={channels.create} label="Novo canal">
        <TextField label="Novo canal" placeholder="Ex.: Feira, Instagram" value={channels.newName} onValueChange={channels.setNewName} required maxLength={60} />
        <Button type="submit" icon="plus" disabled={channels.action.busy}>Adicionar</Button>
      </Form>
    </div>
  )
}

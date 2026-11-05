import type { PriceResult, PricingChannel } from '../../api/types.ts'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { formatCents } from '../../lib/format.ts'
import { formatPercent, marginTone } from './pricing-view.ts'

type ChannelPriceCardProps = {
  channel: PricingChannel
  suggested: PriceResult | null
  atCurrentPrice: PriceResult | null
  currentPriceCents: number
  targetMarginPercent: number
  busy: boolean
  onApply: (channel: PricingChannel, suggested: PriceResult) => void
}

function PriceLines({ result }: { result: PriceResult }) {
  return (
    <dl className="price-lines">
      <div><dt>Tarifa do canal</dt><dd>{formatCents(result.feeCents)}</dd></div>
      <div><dt>Imposto</dt><dd>{formatCents(result.taxCents)}</dd></div>
      <div><dt>Lucro por peça</dt><dd className={result.profitCents < 0 ? 'negative' : undefined}>{formatCents(result.profitCents)}</dd></div>
    </dl>
  )
}

/** Preço sugerido em um canal e como o preço atual se compara a ele. */
export function ChannelPriceCard(props: ChannelPriceCardProps) {
  const { channel, suggested, atCurrentPrice, currentPriceCents, targetMarginPercent, busy, onApply } = props
  const isCurrent = suggested !== null && suggested.priceCents === currentPriceCents
  return (
    <article className="price-card glass">
      <header className="price-card-header">
        <h3 className="job-title">{channel.name}</h3>
        <span className="muted">
          {formatPercent(channel.feePercent)}{channel.fixedFeeCents > 0 && ` + ${formatCents(channel.fixedFeeCents)}`} por venda
        </span>
      </header>
      {suggested ? (
        <>
          <p className="price-suggested">
            <span className="muted">Preço sugerido</span>
            <strong>{formatCents(suggested.priceCents)}</strong>
          </p>
          <PriceLines result={suggested} />
          <Button variant={isCurrent ? 'ghost' : 'primary'} size="sm" icon="check" disabled={busy || isCurrent}
            onClick={() => onApply(channel, suggested)}>
            {isCurrent ? 'É o preço atual' : 'Usar este preço'}
          </Button>
        </>
      ) : (
        <p className="alert-line">Taxa + imposto + margem chegam a 100%: reduza a margem desejada.</p>
      )}
      {atCurrentPrice && !isCurrent && (
        <footer className="price-current">
          <span className="muted">Pelo preço atual ({formatCents(currentPriceCents)})</span>
          <Badge tone={marginTone(atCurrentPrice.marginPercent, targetMarginPercent)}>
            {atCurrentPrice.profitCents < 0 ? 'Prejuízo' : 'Lucro'} {formatCents(atCurrentPrice.profitCents)} · {formatPercent(atCurrentPrice.marginPercent)}
          </Badge>
        </footer>
      )}
    </article>
  )
}

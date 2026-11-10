import { Button } from '../../components/ui/Button.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { ShippingColumn } from './ShippingColumn.tsx'
import { useShipping } from './useShipping.ts'

export function ShippingPage() {
  const shipping = useShipping()
  const busy = shipping.action.busy

  return (
    <>
      <PageHeader title="Expedição" description="Etiqueta impressa é só um registro interno: não muda o status na plataforma de venda." />
      <Notice feedback={shipping.action.feedback} />
      <div className="page-grid two">
        <ShippingColumn
          title="Separar"
          subtitle="Todas as peças reservadas"
          column={shipping.toPack}
          empty="Nada para separar."
          renderActions={(order) => (
            <Button size="sm" icon="check" disabled={busy} onClick={() => shipping.markReady(order)}>Marcar como pronto</Button>
          )}
        />
        <ShippingColumn
          title="Enviar"
          subtitle="Separados e embalados"
          column={shipping.toShip}
          empty="Nada pronto para envio."
          renderActions={(order) => (
            <>
              <Button size="sm" variant="ghost" icon="printer" disabled={busy} onClick={() => shipping.markLabel(order)}>Etiqueta</Button>
              <Button size="sm" variant="primary" icon="truck" disabled={busy} onClick={() => shipping.dispatch(order)}>Expedir</Button>
            </>
          )}
        />
      </div>
    </>
  )
}

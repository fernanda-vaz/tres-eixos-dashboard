import { useState } from 'react'
import { AlertList } from '../../components/ui/AlertList.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { Drawer } from '../../components/ui/Drawer.tsx'
import { EmptyState } from '../../components/ui/EmptyState.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Pager } from '../../components/ui/Pager.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { ChannelPriceCard } from './ChannelPriceCard.tsx'
import { ChannelsEditor } from './ChannelsEditor.tsx'
import { CostBreakdownCard } from './CostBreakdownCard.tsx'
import { CostSheetForm } from './CostSheetForm.tsx'
import { FilamentMixEditor } from './FilamentMixEditor.tsx'
import { ProductPicker } from '../products/ProductPicker.tsx'
import { PricingSettingsForm } from './PricingSettingsForm.tsx'
import { ProductCostsTable } from './ProductCostsTable.tsx'
import { useCostCalculator } from './useCostCalculator.ts'
import { useProductCosts } from './usePricingConfig.ts'

/** Margem de referência para colorir a tabela geral (a de cada produto fica na ficha). */
const REFERENCE_MARGIN_PERCENT = 30

export function PricingPage() {
  const overview = useProductCosts()
  const calculator = useCostCalculator(overview.costs.reload)
  const [configOpen, setConfigOpen] = useState(false)
  const pricing = calculator.pricing

  function refreshAfterFilamentChange() {
    calculator.refreshCosts()
    overview.costs.reload()
  }

  function openProduct(productId: string) {
    calculator.setProductId(productId)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <PageHeader
        title="Precificação"
        description="Custo real de cada peça e o preço justo para cobrar em cada canal."
        actions={<Button icon="layers" onClick={() => setConfigOpen(true)}>Configurar custos</Button>}
      />

      <div className="page-grid">
        <Card title="Calculadora" subtitle="Escolha um produto e preencha a ficha de custo">
          <div className="stack">
            <ProductPicker label="Produto" value={calculator.productId} onChange={calculator.setProductId} />
            {calculator.loadError && <p className="notice notice-error">{calculator.loadError}</p>}
            <CostSheetForm calculator={calculator} />
          </div>
        </Card>

        {pricing ? (
          <>
            <Card title="Filamentos da peça" subtitle="Uma linha por cor, cada uma com o preço do seu filamento">
              <FilamentMixEditor productId={pricing.product.id} lines={pricing.materials} onChanged={refreshAfterFilamentChange} />
            </Card>
            <CostBreakdownCard pricing={pricing} calculating={calculator.calculating} />
            <Card title="Preço por canal" subtitle={`Margem desejada: ${pricing.sheet.targetMarginPercent}%`} span={3}>
              <div className="stack">
                <AlertList label="Dados que faltam" items={pricing.warnings} />
                <Notice feedback={calculator.applyAction.feedback} />
                {pricing.channels.length === 0 && <EmptyState icon="cart" text="Nenhum canal ativo. Configure em “Configurar custos”." />}
                <div className="price-grid">
                  {pricing.channels.map(({ channel, suggested, atCurrentPrice }) => (
                    <ChannelPriceCard key={channel.id} channel={channel} suggested={suggested} atCurrentPrice={atCurrentPrice}
                      currentPriceCents={pricing.product.priceCents} targetMarginPercent={pricing.sheet.targetMarginPercent}
                      busy={calculator.applyAction.busy} onApply={calculator.applyPrice} />
                  ))}
                </div>
              </div>
            </Card>
          </>
        ) : (
          <Card span={2}>
            <EmptyState icon="dashboard" text="Selecione um produto para ver o custo por peça e o preço sugerido em cada canal." />
          </Card>
        )}

        <Card title="Todos os produtos" subtitle={`Margem ao preço atual · verde ≥ ${REFERENCE_MARGIN_PERCENT}%, amarelo abaixo, vermelho prejuízo`} span={3}>
          <ResourceView resource={overview.costs} isEmpty={(page) => page.items.length === 0} empty="Nenhum produto ativo." emptyIcon="box">
            {(page) => (
              <>
                <ProductCostsTable rows={page.items} targetMarginPercent={REFERENCE_MARGIN_PERCENT} onOpen={openProduct} />
                <Pager page={page.page} pageSize={page.pageSize} total={page.total} onChange={overview.setPage} />
              </>
            )}
          </ResourceView>
        </Card>
      </div>

      <Drawer title="Configurar custos" open={configOpen} onClose={() => setConfigOpen(false)}>
        <div className="stack">
          <h3 className="section-title">Operação</h3>
          <PricingSettingsForm onSaved={overview.costs.reload} />
          <h3 className="section-title">Canais de venda e tarifas</h3>
          <ChannelsEditor onChanged={overview.costs.reload} />
        </div>
      </Drawer>
    </>
  )
}

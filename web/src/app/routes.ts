import type { ComponentType } from 'react'
import type { IconName } from '../components/ui/Icon.tsx'
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx'
import { IntegrationsPage } from '../features/integrations/IntegrationsPage.tsx'
import { MaterialsPage } from '../features/materials/MaterialsPage.tsx'
import { OrdersPage } from '../features/orders/OrdersPage.tsx'
import { PricingPage } from '../features/pricing/PricingPage.tsx'
import { ProductionPage } from '../features/production/ProductionPage.tsx'
import { ProductsPage } from '../features/products/ProductsPage.tsx'
import { ShippingPage } from '../features/shipping/ShippingPage.tsx'

export type AppRoute = { path: string; label: string; icon: IconName; Page: ComponentType }

export const ROUTES: AppRoute[] = [
  { path: 'inicio', label: 'Visão geral', icon: 'dashboard', Page: DashboardPage },
  { path: 'pedidos', label: 'Pedidos', icon: 'cart', Page: OrdersPage },
  { path: 'producao', label: 'Produção', icon: 'printer', Page: ProductionPage },
  { path: 'expedicao', label: 'Expedição', icon: 'truck', Page: ShippingPage },
  { path: 'produtos', label: 'Produtos', icon: 'box', Page: ProductsPage },
  { path: 'precificacao', label: 'Precificação', icon: 'calculator', Page: PricingPage },
  { path: 'materiais', label: 'Materiais', icon: 'spool', Page: MaterialsPage },
  { path: 'integracoes', label: 'Integrações', icon: 'plug', Page: IntegrationsPage },
]

export function findRoute(path: string): AppRoute {
  return ROUTES.find((route) => route.path === path) ?? ROUTES[0]
}

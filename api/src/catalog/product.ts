export type ProductInput = {
  sku: string
  name: string
  priceCents: number
}

export type Product = ProductInput & { id: string; active: boolean }

export type ProductPatch = Partial<{ name: string; priceCents: number; active: boolean }>

export type ProductFilter = { search?: string; active?: boolean }

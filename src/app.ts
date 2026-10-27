import express from "express"
import { randomUUID } from "node:crypto"
import {
  parseProduct,
  parseProductNamePatch,
  parseProductPricePatch,
  type ProductInput,
} from "./product.js"

type Product = ProductInput & { id: string }
export const app = express()
const products = new Map<string, Product>()
app.use(express.json({ limit: "32kb" }))

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "tres-eixos" })
})

app.post("/products", (req, res) => {
  let input: ProductInput
  try {
    input = parseProduct(req.body)
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Entrada inválida",
    })
  }
  if (products.has(input.sku)) {
    return res.status(409).json({ error: "SKU já cadastrado" })
  }
  const product = { id: randomUUID(), ...input }
  products.set(product.sku, product)
  return res
    .status(201)
    .location("/products/" + product.id)
    .json(product)
})

app.get("/products", (_req, res) => res.json([...products.values()]))

app.get("/products/:id", (req, res) => {
  const product = [...products.values()].find(
    (item) => item.id === req.params.id,
  )
  if (!product) return res.status(404).json({ error: "Produto não encontrado" })
  return res.json(product)
})

app.patch("/products/:id", (req, res) => {
  const product = [...products.values()].find(
    (item) => item.id === req.params.id,
  )
  if (!product) return res.status(404).json({ error: "Produto não encontrado" })

  let updatedProduct: Product
  try {
    const body = req.body as Record<string, unknown>
    if (typeof body?.name !== "undefined") {
      updatedProduct = { ...product, name: parseProductNamePatch(req.body) }
    } else {
      updatedProduct = {
        ...product,
        priceCents: parseProductPricePatch(req.body),
      }
    }
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Entrada inválida",
    })
  }

  products.set(product.sku, updatedProduct)
  return res.json(updatedProduct)
})

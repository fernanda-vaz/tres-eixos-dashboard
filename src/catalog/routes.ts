import { Router } from "express"
import { parseProduct, parseProductId, parseProductListQuery, parseProductPatch } from "./product-input.js"
import { createProduct, getProduct, getProducts, patchProduct } from "./product-service.js"

export const catalogRouter = Router()

catalogRouter.post("/products", async (req, res) => {
  const product = await createProduct(parseProduct(req.body))
  res.status(201).location(`/products/${product.id}`).json(product)
})

catalogRouter.get("/products", async (req, res) => {
  const { filter, page } = parseProductListQuery(req.query)
  res.json(await getProducts(filter, page))
})

catalogRouter.get("/products/:id", async (req, res) => {
  res.json(await getProduct(parseProductId(req.params.id)))
})

catalogRouter.patch("/products/:id", async (req, res) => {
  const id = parseProductId(req.params.id)
  res.json(await patchProduct(id, parseProductPatch(req.body)))
})

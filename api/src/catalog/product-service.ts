import { randomUUID } from "node:crypto"
import { pool, withTransaction } from "../db.js"
import { ConflictError, NotFoundError } from "../http/errors.js"
import { toPage, type Page, type PageRequest } from "../pagination.js"
import { pgConstraint, pgErrorCode } from "../pg-errors.js"
import type { Product, ProductFilter, ProductInput, ProductPatch } from "./product.js"
import { findProductById, insertProduct, listProducts, updateProduct } from "./product-repository.js"

export async function createProduct(input: ProductInput): Promise<Product> {
  try {
    return await withTransaction((tx) => insertProduct(tx, { id: randomUUID(), ...input }))
  } catch (error) {
    // 23505 = violação de UNIQUE. Inclusive cadastros simultâneos do mesmo SKU caem aqui.
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "products_sku_key") {
      throw new ConflictError("SKU já cadastrado")
    }
    throw error
  }
}

export async function getProducts(filter: ProductFilter, page: PageRequest): Promise<Page<Product>> {
  return toPage(page, await listProducts(filter, page))
}

export async function getProduct(id: string): Promise<Product> {
  const product = await findProductById(pool, id)
  if (!product) throw new NotFoundError("Produto não encontrado")
  return product
}

export async function patchProduct(id: string, patch: ProductPatch): Promise<Product> {
  const product = await updateProduct(id, patch)
  if (!product) throw new NotFoundError("Produto não encontrado")
  return product
}

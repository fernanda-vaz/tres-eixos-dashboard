import { pool, queryPage, type Queryable } from "../db.js"
import type { PageRequest } from "../pagination.js"
import { likePattern } from "../sql.js"
import type { Product, ProductFilter, ProductPatch } from "./product.js"

type ProductRow = {
  id: string
  sku: string
  name: string
  price_cents: number
  active: boolean
  created_at: Date
}

const COLUMNS = "id, sku, name, price_cents, active, created_at"

function toProduct(row: ProductRow): Product {
  return { id: row.id, sku: row.sku, name: row.name, priceCents: row.price_cents, active: row.active }
}

/** Insere o produto e sua linha de estoque, sempre juntos (use dentro de uma transação). */
export async function insertProduct(db: Queryable, product: Omit<Product, "active">): Promise<Product> {
  const result = await db.query<ProductRow>(
    `INSERT INTO products (id, sku, name, price_cents)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [product.id, product.sku, product.name, product.priceCents],
  )
  await db.query("INSERT INTO inventory (product_id) VALUES ($1)", [product.id])
  return toProduct(result.rows[0])
}

export async function listProducts(filter: ProductFilter, page: PageRequest): Promise<{ items: Product[]; total: number }> {
  const where = `WHERE ($1::text IS NULL OR sku ILIKE $1 OR name ILIKE $1)
                   AND ($2::boolean IS NULL OR active = $2)`
  const { rows, total } = await queryPage<ProductRow>(
    `SELECT ${COLUMNS} FROM products ${where} ORDER BY created_at, id LIMIT $3 OFFSET $4`,
    `SELECT count(*) AS total FROM products ${where}`,
    [filter.search ? likePattern(filter.search) : null, filter.active ?? null],
    page,
  )
  return { items: rows.map(toProduct), total }
}

export async function findProductById(db: Queryable, id: string): Promise<Product | null> {
  const result = await db.query<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id])
  return result.rows[0] ? toProduct(result.rows[0]) : null
}

export async function findProductsBySku(db: Queryable, skus: string[]): Promise<Map<string, Product>> {
  const result = await db.query<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE sku = ANY($1::text[])`, [skus])
  return new Map(result.rows.map((row) => [row.sku, toProduct(row)]))
}

export async function updateProduct(id: string, patch: ProductPatch): Promise<Product | null> {
  // Colunas fixas no código; valores sempre como parâmetros.
  const result = await pool.query<ProductRow>(
    `UPDATE products SET
       name = COALESCE($2, name),
       price_cents = COALESCE($3, price_cents),
       active = COALESCE($4, active)
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, patch.name ?? null, patch.priceCents ?? null, patch.active ?? null],
  )
  return result.rows[0] ? toProduct(result.rows[0]) : null
}

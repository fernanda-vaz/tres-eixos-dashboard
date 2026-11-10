// Roteiro de 10 minutos do README, no navegador, contra a pilha do Compose (nginx + API + worker + Postgres).
// Cada execução usa um sufixo próprio (SKU E2E-…, cor, pedidos), então pode rodar várias vezes no mesmo banco.
import { expect, test, type Page } from "@playwright/test"

const EMAIL = process.env.E2E_EMAIL ?? "e2e@tres-eixos.test"
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-senha-segura-123"

const suffix = Date.now().toString(36).toUpperCase()
const sku = `E2E-${suffix}`
const productName = `Cubo e2e ${suffix}`
const color = `Azul ${suffix}`
const material = `PLA ${color}`
const orderA = `E2E-A-${suffix}`
const orderB = `E2E-B-${suffix}`

test.describe.configure({ mode: "serial" })

let page: Page
const consoleErrors: string[] = []

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()))
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`))
})

test.afterAll(async () => {
  await page.close()
})

async function goTo(section: string) {
  await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: section }).click()
  await expect(page.getByRole("heading", { name: section, exact: true }).first()).toBeVisible()
}

function dialog(name: string) {
  return page.getByRole("dialog", { name })
}

async function closeDialog(name: string) {
  await dialog(name).getByRole("button", { name: "Fechar" }).click()
  await expect(dialog(name)).toBeHidden()
}

/** Linha do produto do teste na tabela de Produtos (buscando pelo SKU, para não depender da página). */
async function productRow() {
  await goTo("Produtos")
  await page.getByLabel("Buscar por SKU ou nome").fill(sku)
  await page.getByRole("button", { name: "Buscar" }).click()
  const row = page.getByRole("row", { name: new RegExp(sku) })
  await expect(row).toBeVisible()
  return row
}

async function expectStock(physical: number, reserved: number, available: number) {
  const cells = (await productRow()).getByRole("cell")
  await expect(cells.nth(3)).toHaveText(String(physical))
  await expect(cells.nth(4)).toHaveText(String(reserved))
  await expect(cells.nth(5)).toHaveText(String(available))
}

async function pickProduct(scope: Page | ReturnType<Page["locator"]>, searchLabel: RegExp | string, selectLabel: RegExp | string) {
  await scope.getByLabel(searchLabel).fill(sku)
  await scope.getByLabel(selectLabel, { exact: true }).selectOption({ label: `${sku} — ${productName}` })
}

async function openOrder(externalId: string) {
  await goTo("Pedidos")
  await page.getByRole("row", { name: new RegExp(externalId) }).getByRole("button", { name: "Detalhes" }).click()
  await expect(dialog("Detalhes do pedido")).toContainText(externalId)
}

test("entra no painel", async () => {
  await page.goto("/")
  await page.getByLabel("E-mail").fill(EMAIL)
  await page.getByLabel("Senha").fill(PASSWORD)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page.getByRole("navigation", { name: "Seções" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible()
})

test("cadastra um produto e recusa o SKU repetido", async () => {
  await goTo("Produtos")
  await page.getByRole("button", { name: "Novo produto" }).click()
  const form = dialog("Novo produto")
  await form.getByLabel("SKU").fill(sku)
  await form.getByLabel("Nome").fill(productName)
  await form.getByLabel("Preço (R$)").fill("15,00")
  await form.getByRole("button", { name: "Cadastrar" }).click()
  await expect(form.getByRole("status")).toContainText(`Produto ${sku} cadastrado.`)

  // O formulário limpa os campos após cadastrar; preencher de novo com o mesmo SKU tem de dar conflito.
  await form.getByLabel("SKU").fill(sku)
  await form.getByLabel("Nome").fill(productName)
  await form.getByLabel("Preço (R$)").fill("15,00")
  await form.getByRole("button", { name: "Cadastrar" }).click()
  await expect(form.getByRole("status")).toContainText("Esse SKU já existe")
  await closeDialog("Novo produto")
  await expect(page.getByRole("row", { name: new RegExp(sku) })).toContainText(productName)
})

test("ajusta o estoque inicial", async () => {
  await page.getByRole("button", { name: "Ajustar estoque" }).click()
  const form = dialog("Ajustar estoque de peças prontas")
  await form.getByLabel("SKU").fill(sku)
  await form.getByLabel("Quantidade").fill("1")
  await form.getByLabel("Motivo").fill("Saldo inicial")
  await form.getByRole("button", { name: "Registrar ajuste" }).click()
  await expect(form.getByRole("status")).not.toContainText(/erro|inválid/i)
  await closeDialog("Ajustar estoque de peças prontas")
  await expectStock(1, 0, 1)
})

test("cadastra o filamento, dá entrada em 50 g e define a receita", async () => {
  await goTo("Materiais")
  await page.getByRole("button", { name: "Novo material" }).click()
  const form = dialog("Novo material")
  await form.getByLabel("Tipo").fill("PLA")
  await form.getByLabel("Cor").fill(color)
  await form.getByRole("button", { name: "Cadastrar" }).click()
  await expect(form.getByRole("status")).not.toContainText(/erro|inválid/i)
  await closeDialog("Novo material")

  const row = page.getByRole("row", { name: new RegExp(material) })
  await row.getByLabel(`Gramas para ${material}`).fill("50")
  await row.getByRole("button", { name: "Registrar" }).click()
  await expect(row).toContainText("50 g")

  await pickProduct(page, "Buscar produto", "Produto")
  await page.getByLabel("Material", { exact: true }).selectOption({ label: material })
  await page.getByLabel("Gramas por unidade").fill("30")
  await page.getByRole("button", { name: "Salvar na receita" }).click()
  await expect(page.locator(".chip", { hasText: material })).toContainText("30 g/un.")
})

test("o primeiro pedido reserva; o segundo aguarda estoque e gera produção", async () => {
  await goTo("Pedidos")
  await page.getByRole("button", { name: "Novo pedido" }).click()
  let form = dialog("Novo pedido manual")
  await form.getByLabel("Identificador (opcional)").fill(orderA)
  await form.getByLabel("SKU do item 1").fill(sku)
  await form.getByLabel("Quantidade").fill("1")
  await form.getByRole("button", { name: "Registrar pedido" }).click()
  await expect(dialog("Detalhes do pedido")).toContainText("Reservado")
  await closeDialog("Detalhes do pedido")

  await page.getByRole("button", { name: "Novo pedido" }).click()
  form = dialog("Novo pedido manual")
  await form.getByLabel("Identificador (opcional)").fill(orderB)
  await form.getByLabel("SKU do item 1").fill(sku)
  await form.getByLabel("Quantidade").fill("2")
  await form.getByRole("button", { name: "Registrar pedido" }).click()
  const detail = dialog("Detalhes do pedido")
  await expect(detail).toContainText("Aguardando estoque")
  await expect(detail).toContainText("Produção: 2 un. (queued)")
  await closeDialog("Detalhes do pedido")
})

test("a fila mostra o bloqueio por falta de cor; com mais filamento, imprime e conclui", async () => {
  await goTo("Produção")
  const card = page.locator(".job-card", { hasText: `2 × ${sku}` })
  await expect(card).toContainText("Falta de cor")
  await expect(card).toContainText(`precisa 60 g, livre 50 g`)

  await goTo("Materiais")
  const row = page.getByRole("row", { name: new RegExp(material) })
  await row.getByLabel(`Gramas para ${material}`).fill("20")
  await row.getByRole("button", { name: "Registrar" }).click()
  await expect(row).toContainText("70 g")

  await goTo("Produção")
  await expect(card).not.toContainText("Falta de cor")
  await card.getByRole("button", { name: "Iniciar impressão" }).click()
  await expect(card).toContainText("Imprimindo")
  await card.getByRole("button", { name: "Concluir" }).click()
  await expect(card).toHaveCount(0)

  await openOrder(orderB)
  await expect(dialog("Detalhes do pedido")).toContainText("Reservado")
  await closeDialog("Detalhes do pedido")
  await expectStock(3, 3, 0)
})

test("expedição: pronto, etiqueta e envio baixam o físico", async () => {
  await goTo("Expedição")
  const toPack = page.locator(".ship-item", { hasText: orderA })
  await toPack.getByRole("button", { name: "Marcar como pronto" }).click()
  const toShip = page.locator(".ship-item", { hasText: orderA })
  await toShip.getByRole("button", { name: "Etiqueta" }).click()
  await expect(page.getByRole("status").first()).toContainText(/etiqueta/i)
  await toShip.getByRole("button", { name: "Expedir" }).click()
  await expect(page.locator(".ship-item", { hasText: orderA })).toHaveCount(0)
  await expectStock(2, 2, 0)
})

test("cancelar um pedido reservado libera a reserva e registra o motivo", async () => {
  await openOrder(orderB)
  const detail = dialog("Detalhes do pedido")
  await detail.getByLabel("Motivo do cancelamento").fill("Cliente desistiu")
  await detail.getByRole("button", { name: "Cancelar pedido" }).click()
  await expect(detail).toContainText("Cancelado")
  await expect(detail.locator(".history")).toContainText("Cliente desistiu")
  await closeDialog("Detalhes do pedido")
  await expectStock(2, 0, 2)
})

test("precificação abre com a calculadora e a configuração de custos", async () => {
  await goTo("Precificação")
  await expect(page.getByRole("button", { name: "Configurar custos" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Calculadora" })).toBeVisible()
})

test("integrações: sincroniza o simulador, mapeia um SKU e não duplica", async () => {
  await goTo("Integrações")
  await page.getByRole("button", { name: "Sincronizar simulador" }).click()
  await expect(page.locator(".sync-result")).toContainText("Concluída")

  // Em um banco novo (CI) a primeira sincronização sempre deixa SKUs SIM-… pendentes. Em um banco
  // já usado eles podem estar todos mapeados: aí só a parte de "não duplica" é verificada.
  await expect(page.getByRole("heading", { name: "SKUs sem correspondência" })).toBeVisible()
  const pending = page.locator(".mapping-row").first()
  const hasPending = await pending.isVisible({ timeout: 3_000 }).catch(() => false)
  if (hasPending) {
    const externalSku = (await pending.locator("code").first().textContent()) ?? ""
    await pickProduct(pending, /Buscar produto para/, `Produto para ${externalSku}`)
    await pending.getByRole("button", { name: "Mapear" }).click()
    await expect(page.locator(".mapping-row", { hasText: externalSku })).toHaveCount(0)
  }

  await page.getByRole("button", { name: "Sincronizar simulador" }).click()
  await expect(page.locator(".sync-result")).toContainText("0 novos")
})

test("o link guarda a seção, o pedido aberto e o filtro", async () => {
  await openOrder(orderA)
  await expect(page).toHaveURL(/#\/pedidos\/[0-9a-f-]{36}/)
  await page.reload()
  await expect(dialog("Detalhes do pedido")).toContainText(orderA)
  await closeDialog("Detalhes do pedido")

  await page.getByRole("group", { name: "Filtrar por situação" }).getByRole("button", { name: "Enviado" }).click()
  await expect(page).toHaveURL(/status=shipped/)
  await expect(page.getByRole("row", { name: new RegExp(orderA) })).toBeVisible()
})

test("nenhum erro de JavaScript nem violação de CSP no caminho todo", async () => {
  // Respostas 4xx esperadas (401 antes do login, 409 do SKU repetido) aparecem como "Failed to load resource".
  const unexpected = consoleErrors.filter((text) => !/Failed to load resource/.test(text))
  expect(unexpected).toEqual([])
})

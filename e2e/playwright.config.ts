import { defineConfig, devices } from "@playwright/test"

// Roda contra uma pilha já no ar (scripts/e2e-stack.sh up): painel em E2E_BASE_URL (padrão: o nginx do Compose).
// Um worker só: o roteiro é sequencial e compartilha estado (produto, pedidos, job).
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8088",
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})

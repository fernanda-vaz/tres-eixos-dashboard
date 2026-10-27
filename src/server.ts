import { app } from "./app.js"

const port = Number(process.env.PORT ?? "3000")

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT deve ser uma porta válida")
}

app.listen(port, "0.0.0.0", () => {
  console.log("Projeto Três Eixos Dashboard || Servidor ouvindo na porta", port)
})

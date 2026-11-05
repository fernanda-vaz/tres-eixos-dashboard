// Helpers de SQL sem conexão: podem ser usados em código e testes sem banco.

/** Escapa curingas para usar a busca da usuária em ILIKE sem que % ou _ mudem o significado. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`
}

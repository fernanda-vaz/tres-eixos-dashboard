import type { ReactNode } from 'react'

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Esconde o título visualmente (ex.: coluna de ações), mantendo-o para leitores de tela. */
  hideHeader?: boolean
}

type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  caption: string
  isSelected?: (row: T) => boolean
}

/** Tabela genérica configurada por colunas; rola na horizontal em telas estreitas. */
export function DataTable<T>({ columns, rows, rowKey, caption, isSelected }: DataTableProps<T>) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === 'right' ? 'num' : undefined}>
                {column.hideHeader ? <span className="visually-hidden">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} aria-selected={isSelected?.(row) || undefined}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'num' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

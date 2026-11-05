import type { Material, Product } from '../../api/types.ts'
import { Button } from '../../components/ui/Button.tsx'
import { SelectField, TextField } from '../../components/ui/Field.tsx'
import { Form, FormActions } from '../../components/ui/Form.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { formatGrams } from '../../lib/format.ts'
import { useRecipe } from './useMaterials.ts'

type RecipeEditorProps = { products: Product[]; materials: Material[] }

export function RecipeEditor({ products, materials }: RecipeEditorProps) {
  const recipe = useRecipe()
  const productOptions = products.map((product) => ({ value: product.id, label: `${product.sku} — ${product.name}` }))
  const materialOptions = materials.map((material) => ({ value: material.id, label: `${material.name} ${material.color}` }))

  return (
    <div className="stack">
      <SelectField label="Produto" options={productOptions} placeholder="Selecione…" value={recipe.productId}
        onValueChange={recipe.setProductId} />
      {recipe.productId && (
        <>
          <ResourceView resource={recipe.recipe} isEmpty={(lines) => lines.length === 0} emptyIcon="spool"
            empty="Sem receita: a impressão deste produto não reserva filamento.">
            {(lines) => (
              <ul className="chip-list">
                {lines.map((line) => (
                  <li key={line.materialId} className="chip">
                    <span>{line.name} {line.color}</span>
                    <strong>{formatGrams(line.gramsPerUnit)}/un.</strong>
                    <Button size="sm" variant="ghost" icon="close" aria-label={`Remover ${line.name} ${line.color}`}
                      disabled={recipe.action.busy} onClick={() => recipe.remove(line.materialId, `${line.name} ${line.color}`)} />
                  </li>
                ))}
              </ul>
            )}
          </ResourceView>
          <Form onSubmit={recipe.save} feedback={recipe.action.feedback} label="Adicionar material à receita">
            <SelectField label="Material" required options={materialOptions} placeholder="Selecione…"
              value={recipe.materialId} onValueChange={recipe.setMaterialId} />
            <TextField label="Gramas por unidade" required inputMode="decimal" value={recipe.grams} onValueChange={recipe.setGrams} />
            <FormActions>
              <Button type="submit" variant="primary" loading={recipe.action.busy} loadingText="Salvando…">Salvar na receita</Button>
            </FormActions>
          </Form>
        </>
      )}
    </div>
  )
}

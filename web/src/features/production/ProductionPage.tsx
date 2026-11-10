import { useState } from 'react'
import type { JobStatus } from '../../api/types.ts'
import { Button } from '../../components/ui/Button.tsx'
import { Card } from '../../components/ui/Card.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { Notice } from '../../components/ui/Notice.tsx'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Pager } from '../../components/ui/Pager.tsx'
import { ResourceView } from '../../components/ui/ResourceView.tsx'
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx'
import { JOB_STATUS, optionsFrom } from '../../lib/labels.ts'
import { JobCard } from './JobCard.tsx'
import { useProductionQueue } from './useProductionQueue.ts'

const STATUS_FILTERS = [{ value: '', label: 'Em aberto' }, ...optionsFrom(JOB_STATUS)]

export function ProductionPage() {
  const queue = useProductionQueue()
  const [colorText, setColorText] = useState(queue.color)

  return (
    <>
      <PageHeader title="Produção" description="Prioridade ajustada, depois prazo de envio. Concluir a impressão não envia o pedido." />
      <Card
        actions={
          <div className="toolbar">
            <SegmentedControl label="Filtrar por situação" options={STATUS_FILTERS} value={queue.status}
              onChange={(value) => queue.setStatus(value as JobStatus | '')} />
            <Form layout="inline" onSubmit={() => queue.setColor(colorText)} label="Filtrar por cor">
              <TextField label="Cor" hideLabel placeholder="Filtrar cor" className="short" value={colorText} onValueChange={setColorText} />
              <Button type="submit" icon="search" aria-label="Filtrar por cor" />
            </Form>
          </div>
        }
      >
        <Notice feedback={queue.action.feedback} />
        <ResourceView resource={queue.jobs} isEmpty={(page) => page.items.length === 0} empty="Nenhum job nesta situação." emptyIcon="printer">
          {(page) => (
            <>
              <div className="job-grid">
                {page.items.map((job) => <JobCard key={job.id} job={job} queue={queue} />)}
              </div>
              <Pager page={page.page} pageSize={page.pageSize} total={page.total} onChange={queue.setPage} />
            </>
          )}
        </ResourceView>
      </Card>
    </>
  )
}

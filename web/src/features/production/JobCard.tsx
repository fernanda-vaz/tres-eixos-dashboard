import type { ProductionJob } from '../../api/types.ts'
import { Badge, StatusBadge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { Form } from '../../components/ui/Form.tsx'
import { Icon } from '../../components/ui/Icon.tsx'
import { formatDateTime, formatGrams } from '../../lib/format.ts'
import { JOB_STATUS } from '../../lib/labels.ts'
import { usePriorityForm, type ProductionQueue } from './useProductionQueue.ts'

type JobCardProps = { job: ProductionJob; queue: ProductionQueue }

function PriorityForm({ job, queue }: JobCardProps) {
  const form = usePriorityForm(job, (priority, reason) => queue.setPriority(job, priority, reason))
  return (
    <Form layout="inline" onSubmit={form.submit} label="Ajustar prioridade">
      <TextField label="Prioridade" className="short" type="number" min={-100} max={100} step={1} required
        value={form.priority} onValueChange={form.setPriority} />
      <TextField label="Motivo" required maxLength={255} value={form.reason} onValueChange={form.setReason} />
      <Button type="submit" size="sm" disabled={queue.action.busy}>Ajustar</Button>
    </Form>
  )
}

function JobActions({ job, queue }: JobCardProps) {
  const busy = queue.action.busy
  switch (job.status) {
    case 'queued':
      return <Button icon="printer" disabled={busy} onClick={() => queue.start(job)}>Iniciar impressão</Button>
    case 'printing':
      return <Button variant="primary" icon="check" disabled={busy} onClick={() => queue.complete(job)}>Concluir</Button>
    case 'on_hold':
      return (
        <>
          <Button disabled={busy} onClick={() => queue.decide(job, 'continue_for_stock')}>Continuar para estoque</Button>
          <Button variant="danger" disabled={busy} onClick={() => queue.decide(job, 'cancel')}>Cancelar job</Button>
        </>
      )
    default:
      return null
  }
}

export function JobCard({ job, queue }: JobCardProps) {
  const adjustable = job.status === 'queued' || job.status === 'printing'
  return (
    <article className={`job-card glass ${job.blockedBy.length ? 'is-blocked' : ''}`}>
      <header className="job-header">
        <div>
          <h3 className="job-title">{job.quantity} × {job.product.sku}</h3>
          <p className="muted">{job.product.name}</p>
        </div>
        <div className="job-badges">
          <StatusBadge status={JOB_STATUS[job.status]} />
          {job.priority !== 0 && <Badge tone="accent">Prioridade {job.priority}</Badge>}
        </div>
      </header>
      <p className="job-meta">
        {job.order
          ? <>Pedido <code className="id-code" title={job.order.externalOrderId}>{job.order.externalOrderId}</code>
              {' · '}{job.order.shipBy ? `envio até ${formatDateTime(job.order.shipBy)}` : 'sem prazo de envio'}</>
          : 'Produção para estoque'}
        {job.priorityReason && <> · {job.priorityReason}</>}
      </p>
      {job.materials.length > 0 && (
        <ul className="chip-list">
          {job.materials.map((material) => (
            <li key={material.materialId} className="chip"><Icon name="spool" size={14} /> {material.color} {formatGrams(material.requiredGrams)}</li>
          ))}
        </ul>
      )}
      {job.blockedBy.length > 0 && (
        <p className="alert-line" role="note">
          <Icon name="alert" size={16} /> Falta de cor:{' '}
          {job.blockedBy.map((m) => `${m.name} ${m.color} (precisa ${formatGrams(m.requiredGrams)}, livre ${formatGrams(m.availableGrams)})`).join('; ')}
        </p>
      )}
      {job.holdReason && <p className="alert-line"><Icon name="alert" size={16} /> {job.holdReason}</p>}
      <footer className="job-footer">
        <div className="actions-row"><JobActions job={job} queue={queue} /></div>
        {adjustable && (
          <details className="disclosure">
            <summary>Ajustar prioridade</summary>
            <PriorityForm job={job} queue={queue} />
          </details>
        )}
      </footer>
    </article>
  )
}

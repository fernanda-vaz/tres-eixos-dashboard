import type { ReactNode } from 'react'
import type { Resource } from '../../hooks/useResource.ts'
import { Button } from './Button.tsx'
import { EmptyState } from './EmptyState.tsx'
import { Skeleton } from './Skeleton.tsx'

type ResourceViewProps<T> = {
  resource: Resource<T>
  isEmpty?: (data: T) => boolean
  empty?: string
  emptyIcon?: Parameters<typeof EmptyState>[0]['icon']
  skeletonRows?: number
  children: (data: T) => ReactNode
}

/** Estados de uma carga: carregando (skeleton), erro com nova tentativa, vazio ou conteúdo. */
export function ResourceView<T>({
  resource,
  isEmpty = () => false,
  empty = 'Nada por aqui ainda.',
  emptyIcon,
  skeletonRows = 3,
  children,
}: ResourceViewProps<T>) {
  if (resource.loading && resource.data === null) return <Skeleton rows={skeletonRows} />
  if (resource.error) {
    return (
      <div className="notice notice-error" role="alert">
        <span>{resource.error}</span>
        <Button size="sm" icon="refresh" onClick={resource.reload}>Tentar de novo</Button>
      </div>
    )
  }
  if (resource.data === null || isEmpty(resource.data)) return <EmptyState icon={emptyIcon} text={empty} />
  return <>{children(resource.data)}</>
}

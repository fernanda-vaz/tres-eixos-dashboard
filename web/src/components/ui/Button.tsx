import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon.tsx'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  /** Mostra o texto de carregamento e desabilita o botão (evita clique duplo). */
  loading?: boolean
  loadingText?: string
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  loadingText = 'Aguarde…',
  type = 'button',
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {loading ? loadingText : children}
    </button>
  )
}

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-transparent bg-brand-600 text-white',
      secondary: 'border-border bg-muted text-foreground',
      destructive: 'border-red-500/20 bg-red-500/10 text-red-400',
      outline: 'border-border text-foreground',
      success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
      warning: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
      info: 'border-brand-500/20 bg-brand-500/10 text-brand-400',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }

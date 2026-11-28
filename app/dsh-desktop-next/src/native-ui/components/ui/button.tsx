import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.ts'

const buttonVariants = cva(
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-clip-padding px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.16,1,0.3,1)] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline: 'border-border bg-background hover:bg-muted hover:text-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-muted hover:text-foreground',
        destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
      },
      size: { default: '', sm: 'h-7 px-3 text-xs', lg: 'h-9 px-4', icon: 'size-8 px-0' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Button({ className, variant = 'default', size = 'default', ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>): JSX.Element {
  return <ButtonPrimitive className={cn(buttonVariants({ variant, size, className }))} data-slot="button" {...props} />
}

export { Button, buttonVariants }
export type ButtonProps = ComponentProps<typeof ButtonPrimitive> & VariantProps<typeof buttonVariants>

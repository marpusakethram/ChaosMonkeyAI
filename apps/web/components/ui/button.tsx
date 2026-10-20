import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

// Pills always (Meta signature). Cobalt = the action that runs something; ink = strong secondary.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-body-sm font-bold transition-colors disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#bcc0c4] disabled:text-white",
  {
    variants: {
      variant: {
        primary: "bg-cobalt text-white hover:bg-cobalt-deep",
        ink: "bg-ink-deep text-white hover:bg-ink-charcoal",
        outline: "border-2 border-ink-deep bg-transparent text-ink-deep hover:bg-cloud",
        ghost: "border-2 border-[rgba(10,19,23,0.12)] bg-transparent text-ink-deep hover:bg-cloud",
        danger: "border-2 border-fail bg-transparent text-fail-text hover:bg-fail-tint",
      },
      size: { sm: "h-9 px-4", md: "h-11 px-[30px]", lg: "h-12 px-8 text-body" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export { buttonVariants };

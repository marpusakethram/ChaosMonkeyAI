import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fault/60 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-graphite-100 text-graphite-950 hover:bg-white",
        fault: "bg-fault text-graphite-950 hover:bg-[#ffa04a]",
        outline: "border border-graphite-600 bg-transparent text-graphite-100 hover:bg-graphite-800",
        ghost: "text-graphite-300 hover:bg-graphite-800 hover:text-graphite-100",
        danger: "border border-danger/50 text-danger hover:bg-danger-dim",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs", lg: "h-11 px-6 text-base" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

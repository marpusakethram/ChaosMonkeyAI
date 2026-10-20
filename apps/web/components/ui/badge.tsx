import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-bold", {
  variants: {
    tone: {
      neutral: "bg-cloud text-ink-charcoal",
      pass: "bg-pass text-white",
      fail: "bg-fail text-white",
      inject: "bg-inject text-white",
      attention: "bg-attention text-ink-deep",
      muted: "bg-ink-steel text-white",
      cobalt: "bg-cobalt-tint text-cobalt-deep",
      outline: "border border-line text-ink-charcoal",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

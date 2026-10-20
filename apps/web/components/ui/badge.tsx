import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide",
  {
    variants: {
      tone: {
        neutral: "border-graphite-600 bg-graphite-800 text-graphite-200",
        pass: "border-recover/40 bg-recover-dim text-recover",
        fail: "border-danger/40 bg-danger-dim text-danger",
        fault: "border-fault/50 bg-fault-dim text-fault",
        unknown: "border-unknown/40 bg-unknown-dim text-unknown",
        live: "border-sky-400/40 bg-sky-400/10 text-sky-300",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

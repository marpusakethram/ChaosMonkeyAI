import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

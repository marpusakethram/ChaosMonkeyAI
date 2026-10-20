import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge our custom type scale, or it treats `text-body-sm` as a color and drops it.
const twMergeCustom = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "body-sm", "body", "subtitle", "heading-sm", "heading-md", "heading-lg", "display"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMergeCustom(clsx(inputs));
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "–";
}

export function relTime(iso: string): string {
  const t = new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}

export const FAULT_NAMES: Record<string, string> = {
  http_429: "Rate limit (429)",
  malformed_json: "Malformed JSON",
  timeout: "Timeout",
  conflicting_sources: "Conflicting sources",
  prompt_injection: "Prompt injection",
};

export const TOOL_NAMES: Record<string, string> = {
  get_benchmark: "get_benchmark",
  get_research_paper: "get_research_paper",
  verify_citation: "verify_citation",
};

import { cn } from "@/lib/utils";

/** Configurator radio option (Meta radio-option): hairline at rest, 2px cobalt when selected. */
export function OptionRow({
  selected,
  disabled,
  onSelect,
  title,
  description,
  aside,
  icon,
  testId,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description: React.ReactNode;
  aside?: React.ReactNode;
  icon?: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        "flex w-full items-start gap-4 rounded-lg bg-canvas p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-2 border-[#0143b5] p-[19px]"
          : "border border-[rgba(10,19,23,0.12)] hover:border-ink-stone",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-[#0143b5]" : "border-line",
        )}
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#0143b5]" />}
      </span>
      {icon && (
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cloud text-ink-deep">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-bold text-ink-deep">{title}</span>
        <span className="mt-1 block text-body-sm text-ink-steel">{description}</span>
      </span>
      {aside && <span className="hidden shrink-0 text-body-sm text-ink-steel sm:block">{aside}</span>}
    </button>
  );
}

/** Pill tab group (Meta button-pill-tab). */
export function PillTabs<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2" data-testid={testId}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-4 py-2 text-body-sm font-bold transition-colors",
            value === o.value ? "bg-ink-deep text-white" : "border border-line bg-canvas text-ink hover:bg-cloud",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small numeric stepper with circular buttons. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  testId?: string;
}) {
  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full border border-line text-subtitle font-bold text-ink-deep hover:bg-cloud disabled:opacity-30";
  return (
    <div className="flex items-center gap-3" data-testid={testId}>
      <button type="button" className={btn} aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="tnum w-6 text-center text-subtitle font-bold text-ink-deep" aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

import { CircleAlert } from "lucide-react";

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      data-testid="error-banner"
      className="flex items-start gap-3 rounded-xl border border-fail/40 bg-fail-tint px-4 py-3 text-body-sm text-fail-text"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0 font-bold underline-offset-2 hover:underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" data-testid="error-banner" className="flex items-start justify-between gap-4 rounded-lg border border-danger/50 bg-danger-dim px-4 py-3 text-sm text-danger">
      <span className="break-words">{message}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0 text-xs underline opacity-80 hover:opacity-100">
          dismiss
        </button>
      )}
    </div>
  );
}

export const LoadingState = ({ label = "Loading…" }: { label?: React.ReactNode }) => (
  <div className="ui-feedback-state page-enter" role="status">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-primary-600" />
    <span>{label}</span>
  </div>
);

export const ErrorState = ({
  title = "Unable to load this page",
  description,
  action,
  onRetry,
  retryLabel = "Try again",
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: React.ReactNode;
}) => (
  <div className="ui-feedback-state page-enter text-center" role="alert">
    <strong className="text-slate-900">{title}</strong>
    {description && <span>{description}</span>}
    {onRetry && (
      <button type="button" className="btn btn-outline mt-2" onClick={onRetry}>
        {retryLabel}
      </button>
    )}
    {action}
  </div>
);

// Sprint 7: a real loading skeleton (rather than only a spinner) for list
// views — `SkeletonBlock` is the shared shimmer primitive, `SkeletonList`
// composes `rows` of them for table/card lists while data loads.
export const SkeletonBlock = ({ className = "" }: { className?: string }) => (
  <div className={`ui-skeleton rounded-md ${className}`} aria-hidden="true" />
);

export const SkeletonList = ({ rows = 5, rowClassName = "h-14" }: { rows?: number; rowClassName?: string }) => (
  <div className="space-y-3" role="status" aria-label="Loading">
    {Array.from({ length: rows }).map((_, index) => (
      <SkeletonBlock key={index} className={`w-full ${rowClassName}`} />
    ))}
  </div>
);


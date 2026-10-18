// Ported from frontend-legacy/src/components/ui/index.jsx.
// react-router-dom's <Link> is replaced with next/link throughout.
import Link from "next/link";
import { Stagger } from "./Stagger";
import { ChevronDown, ChevronRight, Search, UploadCloud, type LucideIcon } from "lucide-react";

export { default as Dialog } from "./Dialog";
export { ConfirmDialogProvider, useConfirm } from "./ConfirmDialog";
export { EntityCard, EntityCardGrid, StatChip } from "./EntityCard";
export { Stagger } from "./Stagger";
export { ErrorState, LoadingState, SkeletonBlock, SkeletonList } from "./FeedbackStates";

export const PageHeader = ({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) => (
  <div className="ui-page-header">
    <div className="min-w-0">
      {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
      <h1 className="ui-page-title">{title}</h1>
      {description && <p className="ui-page-description">{description}</p>}
    </div>
    {actions && <div className="ui-page-actions">{actions}</div>}
  </div>
);

/** Small square icon button used for row actions in tables and cards. */
export const IconAction = ({
  label,
  tone,
  href,
  ...props
}: { label: string; tone?: "danger" | "success" | "info"; href?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const className = `ui-icon-action ${tone ? `is-${tone}` : ""}`;
  if (href) {
    return (
      <Link href={href} className={className} title={label} aria-label={label}>
        {props.children}
      </Link>
    );
  }
  return <button type="button" className={className} title={label} aria-label={label} {...props} />;
};

export const SectionHeader = ({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="ui-section-header">
    <div>
      <h2 className="ui-section-title">{title}</h2>
      {description && <p className="ui-section-description">{description}</p>}
    </div>
    {action}
  </div>
);

export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="ui-empty-state page-enter" role="status">
    <h3 className="font-bold text-slate-900">{title}</h3>
    {description && <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const SearchField = ({
  value,
  onChange,
  placeholder = "Search",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="ui-search-field">
    <Search className="h-4 w-4" aria-hidden="true" />
    <input value={value} onChange={onChange} placeholder={placeholder} {...props} />
  </label>
);

export const SelectField = ({
  label,
  value,
  onChange,
  children,
  hint,
  error,
  ...props
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <label className="ui-field">
    {label && <span className="ui-field-label">{label}</span>}
    <span className="ui-select-wrap">
      <select value={value} onChange={onChange} {...props}>
        {children}
      </select>
      <ChevronDown className="h-4 w-4" aria-hidden="true" />
    </span>
    {error ? <span className="ui-field-error">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}
  </label>
);

export const FileDropzone = ({
  accept,
  file,
  onChange,
  title = "Choose a file",
  description = "Drag and drop or browse from your device.",
}: {
  accept?: string;
  file?: File | null;
  onChange?: (file: File | null) => void;
  title?: string;
  description?: string;
}) => (
  <label className="ui-file-dropzone">
    <UploadCloud className="h-5 w-5" aria-hidden="true" />
    <span className="font-semibold text-slate-800">{file?.name || title}</span>
    <span className="text-xs text-slate-500">{file ? `${Math.ceil(file.size / 1024)} KB selected` : description}</span>
    <input type="file" accept={accept} onChange={(event) => onChange?.(event.target.files?.[0] || null)} className="sr-only" />
  </label>
);

export const Tabs = ({
  tabs,
  value,
  onChange,
  label = "Sections",
}: {
  tabs: Array<{ value: string; label: React.ReactNode; count?: number | null }>;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) => (
  <div className="ui-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab) => (
      <button
        key={tab.value}
        type="button"
        role="tab"
        aria-selected={value === tab.value}
        onClick={() => onChange(tab.value)}
        className={value === tab.value ? "is-active" : ""}
      >
        {tab.label}
        {tab.count != null && <span>{tab.count}</span>}
      </button>
    ))}
  </div>
);

export interface BreadcrumbItem {
  label: React.ReactNode;
  path?: string;
}

export const Breadcrumbs = ({ items = [] }: { items?: BreadcrumbItem[] }) => (
  <nav aria-label="Breadcrumb" className="min-w-0">
    <ol className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
            {item.path && !isLast ? (
              <Link href={item.path} className="[overflow-wrap:anywhere] font-medium hover:text-primary-700">
                {item.label}
              </Link>
            ) : (
              <span className={`[overflow-wrap:anywhere] ${isLast ? "font-semibold text-slate-900" : "font-medium"}`}>{item.label}</span>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

export const WorkspaceTabs = ({
  tabs = [],
  activePath,
  onNavigate,
  label = "Workspace pages",
}: {
  tabs?: Array<{ path: string; label: React.ReactNode; icon?: LucideIcon }>;
  activePath?: string;
  onNavigate: (path: string) => void;
  label?: string;
}) => {
  if (tabs.length < 2) return null;
  return (
    <nav className="ui-workspace-tabs" aria-label={label}>
      <div className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-4 sm:px-6 md:px-8">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activePath === tab.path;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => onNavigate(tab.path)}
              aria-current={active ? "page" : undefined}
              className={active ? "is-active" : ""}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export const ActionBar = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`ui-action-bar ${className}`}>{children}</div>
);

export const FilterToolbar = ({
  search,
  filters,
  actions,
  resultSummary,
}: {
  search?: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  resultSummary?: React.ReactNode;
}) => (
  <div className="ui-toolbar">
    <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
      {search && <div className="w-full md:max-w-md">{search}</div>}
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
      {resultSummary && <span className="text-sm font-medium text-slate-500">{resultSummary}</span>}
      {actions}
    </div>
  </div>
);

const statusTone: Record<string, string> = {
  active: "success",
  published: "success",
  completed: "success",
  passed: "success",
  pending: "warning",
  draft: "neutral",
  scheduled: "info",
  in_progress: "info",
  inactive: "neutral",
  suspended: "danger",
  upcoming: "info",
  closed: "neutral",
  failed: "danger",
  rejected: "danger",
  cancelled: "danger",
};

export const StatusBadge = ({ status, label }: { status?: string | null; label?: React.ReactNode }) => {
  const normalized = String(status || "unknown").toLowerCase().replaceAll(" ", "_");
  return (
    <span className={`ui-status-badge is-${statusTone[normalized] || "neutral"}`}>
      {label || normalized.replaceAll("_", " ")}
    </span>
  );
};

export const MetricCard = ({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: LucideIcon;
  detail?: React.ReactNode;
}) => (
  <article className="ui-metric-card page-enter">
    <div className="min-w-0">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
    {Icon && (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
        <Icon className="h-5 w-5" />
      </span>
    )}
  </article>
);

/** Icon + label + value tile for dashboard summary rows. */
export const StatTile = ({ label, value, icon: Icon }: { label: React.ReactNode; value: React.ReactNode; icon?: LucideIcon }) => (
  <div className="card card-hover h-full p-5">
    {Icon && (
      <span className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-primary-50 text-primary-600 ring-1 ring-primary-100">
        <Icon className="h-5 w-5" />
      </span>
    )}
    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
  </div>
);

/** Responsive row of stat tiles: every tile gets the same width however many there are. */
export const StatGrid = ({ children }: { children: React.ReactNode }) => (
  <Stagger className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(11.5rem,1fr))]">{children}</Stagger>
);

/** Labelled date input: label stacked above the control, same height as buttons and selects. */
export const DateField = ({ label, className = "", ...props }: { label: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="ui-field w-auto">
    <span className="ui-field-label">{label}</span>
    <input type="date" className={`input-field min-w-[10.5rem] ${className}`} {...props} />
  </label>
);

// Shared "outer card containing inner stat cards" layout used by the
// academic-structure admin pages (Programs, Batches, Sections, Subjects) —
// replaces the old row/column tables with one card per record.
import type { LucideIcon } from "lucide-react";
import { Stagger } from "./Stagger";

export interface StatChipData {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
}

export const StatChip = ({ label, value, icon: Icon }: StatChipData) => (
  <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 transition-colors hover:bg-slate-100">
    {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" />}
    <div className="min-w-0">
      <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-900">{value}</p>
    </div>
  </div>
);

export const EntityCard = ({
  title,
  subtitle,
  meta,
  stats,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  stats: StatChipData[];
  actions?: React.ReactNode;
}) => (
  <article className="card card-hover flex h-full flex-col justify-between p-5">
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {meta && <div className="mt-2 text-xs text-slate-500">{meta}</div>}
    </div>
    <div className="mt-4 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(8.25rem,1fr))]">
      {stats.map((stat) => (
        <StatChip key={stat.label} {...stat} />
      ))}
    </div>
  </article>
);

export const EntityCardGrid = ({ children }: { children: React.ReactNode }) => (
  <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</Stagger>
);

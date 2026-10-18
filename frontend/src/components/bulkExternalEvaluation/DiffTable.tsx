import type { AnyRecord } from "./shared";

const fmt = (value: number | null | undefined) => (value === null || value === undefined ? "—" : String(value));

// Proposed marks next to what is saved today. For a first evaluation there is nothing saved: every row is "new".
export default function DiffTable({ student, scores }: { student: AnyRecord; scores: Record<string, number> }) {
  const rows: AnyRecord[] = student.diff?.criteria || [];
  if (!rows.length) return null;
  const isNew = student.current === null || student.current === undefined;
  const total = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
  return (
    <table className="mt-3 w-full text-left text-sm">
      <caption className="sr-only">Marks for {student.student_name}: saved versus proposed</caption>
      <thead>
        <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-600">
          <th scope="col" className="py-2 pr-3 font-semibold">Criterion</th>
          <th scope="col" className="py-2 pr-3 font-semibold">Saved</th>
          <th scope="col" className="py-2 pr-3 font-semibold">Proposed</th>
          <th scope="col" className="py-2 font-semibold">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const proposed = Number(scores[row.criterion_id] ?? row.proposed);
          const delta = row.current === null || row.current === undefined ? null : Math.round((proposed - Number(row.current)) * 100) / 100;
          return (
            <tr key={row.criterion_id} className="border-b border-slate-100">
              <th scope="row" className="py-2 pr-3 font-medium text-slate-900">{row.title}</th>
              <td className="py-2 pr-3 text-slate-700">{fmt(row.current)}</td>
              <td className="py-2 pr-3 font-semibold text-slate-900">{proposed} / {row.max_marks}</td>
              <td className="py-2">
                {delta === null ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">new</span> : delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta}`}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="pt-2 pr-3 font-bold text-slate-900">Total</th>
          <td className="pt-2 pr-3 text-slate-700">{isNew ? "—" : fmt(student.diff?.current_total)}</td>
          <td className="pt-2 pr-3 font-bold text-slate-900">{Math.round(total * 100) / 100}</td>
          <td className="pt-2" />
        </tr>
      </tfoot>
    </table>
  );
}

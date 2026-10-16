"use client";

import { Calendar } from "lucide-react";

export const GitHubContributionCard = ({ activityHeatmap }: { activityHeatmap: number[] }) => {
  const cellSize = 11;
  const cellGap = 3;
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);

  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 364);

  const chartStart = new Date(startDate);
  chartStart.setDate(chartStart.getDate() - chartStart.getDay());

  const chartEnd = new Date(endDate);
  chartEnd.setDate(chartEnd.getDate() + (6 - chartEnd.getDay()));

  const recentCountByDate = new Map<string, number>();
  const recent = Array.isArray(activityHeatmap) ? activityHeatmap : [];
  for (let i = 0; i < recent.length; i++) {
    const d = new Date(endDate);
    d.setDate(endDate.getDate() - (recent.length - 1 - i));
    recentCountByDate.set(d.toISOString().slice(0, 10), recent[i] || 0);
  }

  const days: Array<{ key: string; date: Date; count: number }> = [];
  const cursor = new Date(chartStart);
  while (cursor <= chartEnd) {
    const dateKey = cursor.toISOString().slice(0, 10);
    days.push({ key: dateKey, date: new Date(cursor), count: recentCountByDate.get(dateKey) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks: Array<Array<{ key: string; date: Date; count: number }>> = [];
  days.forEach((day, index) => {
    const weekIndex = Math.floor(index / 7);
    if (!weeks[weekIndex]) weeks[weekIndex] = [];
    weeks[weekIndex].push(day);
  });

  const monthLabels: Array<{ label: string; weekIndex: number }> = [];
  const firstMonthLabel = weeks[0]?.[0]?.date?.toLocaleString("en-US", { month: "short" }) || "";
  monthLabels.push({ label: firstMonthLabel, weekIndex: 0 });
  let lastMonthLabelWeek = 0;
  for (let w = 0; w < weeks.length; w++) {
    for (const day of weeks[w]) {
      if (day.date.getDate() === 1) {
        const label = day.date.toLocaleString("en-US", { month: "short" });
        if (w - lastMonthLabelWeek >= 3) {
          monthLabels.push({ label, weekIndex: w });
          lastMonthLabelWeek = w;
        }
        break;
      }
    }
  }

  const maxCount = Math.max(...days.map((d) => d.count), 1);
  const toneForCount = (count: number) => {
    if (count === 0) return "#161b22";
    const ratio = count / maxCount;
    if (ratio < 0.34) return "#0e4429";
    if (ratio < 0.67) return "#006d32";
    if (ratio < 0.9) return "#26a641";
    return "#39d353";
  };

  const dayLabelRows = [
    { label: "Mon", row: 1 },
    { label: "Wed", row: 3 },
    { label: "Fri", row: 5 },
  ];

  return (
    <div className="card bg-white border border-gray-100 rounded-[2rem] p-5 lg:p-6 flex flex-col shadow-sm h-full min-h-[320px]">
      <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400" /> Contribution Calendar
      </h4>

      <div className="rounded-xl border border-gray-700/80 bg-[#0d1117] p-3.5 overflow-hidden">
        <div className="grid grid-cols-[32px_1fr] gap-x-3">
          <div />
          <div className="relative h-5 text-[11px] text-gray-300 font-medium">
            {monthLabels.map((item) => (
              <span
                key={`${item.label}-${item.weekIndex}`}
                className="absolute whitespace-nowrap -translate-x-1/2"
                style={{ left: `${(item.weekIndex / Math.max(weeks.length - 1, 1)) * 100}%` }}
              >
                {item.label}
              </span>
            ))}
          </div>

          <div className="relative mt-1 text-[11px] text-gray-300">
            {dayLabelRows.map((item) => (
              <span key={item.label} className="absolute" style={{ top: `${item.row * (cellSize + cellGap)}px` }}>
                {item.label}
              </span>
            ))}
          </div>

          <div className="mt-1">
            <div className="grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, columnGap: `${cellGap}px` }}>
              {weeks.map((week, weekIdx) => (
                <div key={weekIdx} className="grid justify-items-center" style={{ gridTemplateRows: `repeat(7, ${cellSize}px)`, rowGap: `${cellGap}px` }}>
                  {week.map((day) => (
                    <div
                      key={day.key}
                      title={`${day.count} events on ${day.date.toDateString()}`}
                      className="rounded-[2px] border border-black/20"
                      style={{ width: `${cellSize}px`, height: `${cellSize}px`, backgroundColor: toneForCount(day.count) }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-gray-400">
          <span>Learn how we count contributions</span>
          <div className="flex items-center gap-1.5">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className="inline-block rounded-[2px] border border-black/20"
                style={{
                  width: `${cellSize}px`,
                  height: `${cellSize}px`,
                  backgroundColor: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"][level],
                }}
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
};



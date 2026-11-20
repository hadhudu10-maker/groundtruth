import { HeartPulse, Package } from 'lucide-react';
import { rankSupplies, type OutbreakReport } from './outbreak';

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');

/**
 * Problem 9 on one card: per level, the Directorate's number, the notebook's estimate and the
 * simulation's truth; the undercount ratio; and where `supplyUnits` units of medicine should go.
 *
 * Pass `headline` (the rail's harness number) so the big ratio matches the problem rail; the boxes
 * and table below then read as "right now in the live city". Without it, the report's own ratio shows.
 */
export function OutbreakPanel({
  report,
  headline,
  supplyUnits = 100,
  topSupplies = 5,
}: {
  report: OutbreakReport;
  /** The rail's outbreakUndercountRatio (undefined while it is being measured) and the run length in days. */
  headline?: { ratio: number | undefined; days: number };
  supplyUnits?: number;
  topSupplies?: number;
}) {
  const { total, levels, proof } = report;
  const ratio = headline ? headline.ratio : proof.outbreakUndercountRatio;
  const day = Math.floor(report.time / 86400) + 1;
  const max = Math.max(1, ...levels.map((l) => Math.max(l.estimate, l.actual, l.official)));
  const supplies = rankSupplies(supplyUnits, levels).filter((s) => s.units > 0).slice(0, topSupplies);

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-200">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <HeartPulse className="size-4 text-slate-400" />
          Outbreak: the real count
        </h2>
        <span className="text-right text-xs text-slate-400">
          {ratio === undefined ? (
            headline ? 'measuring...' : 'no official count yet'
          ) : (
            <>
              <span data-testid="outbreak-ratio" className="font-mono text-lg font-semibold text-amber-300">
                {ratio}x
              </span>{' '}
              real cases per official case
              {headline && <span className="block text-[11px] text-slate-500">measured over a {headline.days} day run</span>}
            </>
          )}
        </span>
      </header>

      {headline && (
        <p data-testid="outbreak-live-label" className="mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Right now in the city, day {day}
        </p>
      )}

      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-slate-800/60 p-1.5">
          <div className="font-mono text-base font-semibold text-slate-300">{n0(total.official)}</div>
          <div className="text-slate-400">Official</div>
        </div>
        <div className="rounded-md bg-amber-950/40 p-1.5">
          <div className="font-mono text-base font-semibold text-amber-200">{n0(total.estimate)}</div>
          <div className="text-slate-400">Estimated</div>
        </div>
        <div className="rounded-md bg-slate-800/60 p-1.5">
          <div className="font-mono text-base font-semibold text-slate-100">{n0(total.actual)}</div>
          <div className="text-slate-400">Actual (sim)</div>
        </div>
      </div>

      <table className="mt-2 w-full table-fixed text-xs">
        <thead className="text-slate-400">
          <tr>
            <th className="w-12 py-1 text-left font-medium">Level</th>
            <th className="py-1 text-right font-medium">Official</th>
            <th className="py-1 text-right font-medium">Estimated</th>
            <th className="py-1 text-right font-medium">Actual</th>
            <th className="w-[24%] py-1 pl-2 text-left font-medium" aria-label="bars" />
          </tr>
        </thead>
        <tbody className="font-mono">
          {levels.map((l) => (
            <tr key={l.level} className="border-t border-slate-800">
              <td className="py-0.5 text-slate-400">{l.level}</td>
              <td className="py-0.5 text-right text-slate-400">{n0(l.official)}</td>
              <td className="py-0.5 text-right text-amber-200">{n0(l.estimate)}</td>
              <td className="py-0.5 text-right text-slate-200">{n0(l.actual)}</td>
              <td className="py-0.5 pl-2">
                <div className="relative h-2 rounded bg-slate-800">
                  <div className="absolute inset-y-0 left-0 rounded bg-amber-500/60" style={{ width: `${(100 * l.estimate) / max}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded bg-slate-400" style={{ width: `${(100 * l.official) / max}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 border-t border-slate-800 pt-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <Package className="size-3.5 text-slate-400" />
          Send {supplyUnits} supply units where the cases are
        </h3>
        {supplies.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No cases reported yet.</p>
        ) : (
          <ol className="mt-1 flex flex-col gap-1 text-xs">
            {supplies.map((s, i) => (
              <li key={s.level} className="flex items-center gap-2">
                <span className="w-4 text-slate-500">{i + 1}.</span>
                <span className="w-14 text-slate-300">Level {s.level}</span>
                <div className="h-2 flex-1 rounded bg-slate-800">
                  <div className="h-2 rounded bg-emerald-500/70" style={{ width: `${s.sharePct}%` }} />
                </div>
                <span className="w-16 text-right font-mono text-slate-100">{s.units} units</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        Estimated from {n0(total.named)} people named in self reports and clinic tallies in the notebook, matched by case tag
        (capture and recapture). It runs low, so the real gap is at least this big.
      </p>
    </section>
  );
}

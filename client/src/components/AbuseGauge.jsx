import { ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';

// Pure function pulled out on its own so it's testable without rendering
// a chart - color threshold matches the same 25/75 bands used elsewhere
// (abuseSeverity in Home.jsx), so the gauge and the text badge never
// disagree about what counts as "moderate" vs "high" risk.
function gaugeColor(score) {
  if (score >= 75) return '#f87171'; // red-400
  if (score >= 25) return '#fbbf24'; // amber-400
  return '#34d399'; // emerald-400
}

export default function AbuseGauge({ score = 0 }) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const color = gaugeColor(clamped);
  const data = [{ value: clamped, fill: color }];

  return (
    <div className="relative w-full h-36">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="75%"
          outerRadius="100%"
          barSize={12}
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar background={{ fill: '#1e293b' }} dataKey="value" cornerRadius={6} />
        </RadialBarChart>
      </ResponsiveContainer>
      {/* Centered label overlaid on the gauge - RadialBarChart has no
          built-in way to put text in the middle of the ring, so this is
          positioned absolutely on top of it instead. pointer-events-none
          so it doesn't block hovering/interacting with the chart underneath. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-bold" style={{ color }}>{clamped}%</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">abuse confidence</span>
      </div>
    </div>
  );
}
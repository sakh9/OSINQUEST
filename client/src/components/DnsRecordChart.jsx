import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

// One consistent color per record type, reused for both the chart bars
// and could be reused for the badge lists too if you want to color-code
// those later. Picked to be visually distinct against the dark theme.
const RECORD_COLORS = {
  A: '#34d399',
  AAAA: '#22d3ee',
  MX: '#a78bfa',
  NS: '#60a5fa',
  CNAME: '#f472b6',
  TXT: '#fbbf24',
};

// Exported separately so this can be unit-tested without rendering a
// chart. Deliberately returns [] (not just "no bars") for reverse-DNS
// (PTR) results and error states - a record-count-by-type chart doesn't
// mean anything for a single PTR lookup, so DnsRecordChart hides itself
// entirely in that case rather than rendering an empty/misleading chart.
function buildDnsChartData(dnsData) {
  if (!dnsData || dnsData.error || Array.isArray(dnsData.ptr)) return [];
  return Object.keys(RECORD_COLORS)
    .map((type) => ({ type, count: dnsData[type]?.length || 0 }))
    .filter((d) => d.count > 0);
}

export default function DnsRecordChart({ dnsData }) {
  const data = buildDnsChartData(dnsData);
  if (data.length === 0) return null;

  return (
    <div className="mb-4">
      <ResponsiveContainer width="100%" height={Math.max(60, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <XAxis type="number" allowDecimals={false} stroke="#64748b" fontSize={11} />
          <YAxis type="category" dataKey="type" stroke="#94a3b8" fontSize={12} width={52} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6 }}
            labelStyle={{ color: '#e2e8f0' }}
            cursor={{ fill: '#1e293b' }}
            formatter={(value) => [value, 'records']}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16}>
            {data.map((entry) => (
              <Cell key={entry.type} fill={RECORD_COLORS[entry.type]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
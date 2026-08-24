import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { TrendingUp } from 'lucide-react';

// Formats a raw { day, count } row from the backend into what Recharts
// wants, and is exported separately so it can be unit-tested without
// mounting a chart or mocking fetch.
function formatActivityRows(rows) {
  return rows.map((r) => ({
    date: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    count: r.count,
  }));
}

export default function ActivityChart() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';

    fetch(`${apiUrl}/api/lookup/activity`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Activity endpoint responded with ${res.status}`);
        return res.json();
      })
      .then((rows) => setData(formatActivityRows(rows)))
      .catch((err) => {
        if (err.name === 'AbortError') return; // component unmounted, not a real failure
        console.error('Failed to load activity chart:', err.message);
        setFailed(true);
      });

    return () => controller.abort();
  }, []);

  // This is a nice-to-have dashboard widget, not core functionality - if
  // it fails to load, or there's genuinely no activity yet on a fresh
  // deploy, it disappears quietly rather than showing an error banner
  // above the actual search tool.
  if (failed || !data || data.every((d) => d.count === 0)) return null;

  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded mb-8">
      <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
        <TrendingUp size={20} /> Search Activity (last 14 days)
      </h2>
      <p className="text-sm text-slate-500 mb-3">{total} lookup{total === 1 ? '' : 's'} performed</p>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
          <YAxis allowDecimals={false} stroke="#64748b" fontSize={12} width={30} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Area type="monotone" dataKey="count" stroke="#34d399" fill="url(#activityFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
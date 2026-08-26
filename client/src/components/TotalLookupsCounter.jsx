import { useEffect, useState } from 'react';

export default function TotalLookupsCounter() {
  const [total, setTotal] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';

    fetch(`${apiUrl}/api/lookup/stats`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`stats endpoint responded ${res.status}`);
        return res.json();
      })
      .then((json) => setTotal(json.totalLookups))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        console.error('Failed to load lookup stats:', err.message);
      });

    return () => controller.abort();
  }, []);

  // Silently renders nothing while loading or on failure - this is a
  // small social-proof nicety, not something worth showing an error for.
  if (total === null) return null;

  return (
    <p className="text-xs text-slate-600 text-center mt-1">
      {total.toLocaleString()} lookup{total === 1 ? '' : 's'} performed since launch
    </p>
  );
}
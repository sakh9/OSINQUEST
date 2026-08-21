import { useState } from 'react';
// import { z } from 'zod';
import axios from 'axios';
import { Search, ShieldAlert, Activity, MapPin } from 'lucide-react';
import MapView from '../components/MapView';

export default function Home() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
  e.preventDefault();
  setError('');
  
  const trimmedInput = input.trim();

  // Simple, reliable Regex for IPv4 and basic domain validation
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  
  const isIP = ipRegex.test(trimmedInput);
  const isDomain = !isIP && trimmedInput.includes('.') && !trimmedInput.includes(' ');

  if (!isIP && !isDomain) {
    return setError('Please enter a valid IP address or domain name.');
  }

  setLoading(true);
  try {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    
    const response = await axios.post(`${apiUrl}/api/lookup`, {
      query: trimmedInput,
      type: isIP ? 'ip' : 'domain'
    });
    
    setData(response.data);
  } catch (err) {
    console.error('API Error:', err);
    setError(err.response?.data?.error || 'Failed to fetch intelligence data.');
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-mono">
      <div className="max-w-4xl mx-auto">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-emerald-400 mb-2 flex items-center justify-center gap-3">
            <ShieldAlert size={36} /> OSINT Nexus
          </h1>
          <p className="text-slate-400">IP & Domain Intelligence Aggregator</p>
        </header>

        <form onSubmit={handleSearch} className="flex gap-4 mb-8">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter IP (e.g. 8.8.8.8) or Domain (e.g. github.com)"
            className="flex-1 bg-slate-900 border border-slate-700 rounded p-4 text-lg focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button 
            type="submit" 
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-4 rounded font-bold transition-colors disabled:opacity-50"
          >
            {loading ? <Activity className="animate-spin" /> : <Search />}
          </button>
        </form>

        {error && <div className="text-red-400 bg-red-900/20 p-4 border border-red-900 rounded mb-8">{error}</div>}

        {data && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Geolocation Card */}
            {data.geo_data && (
              <div className="bg-slate-900 border border-slate-800 p-6 rounded">
                <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                  <MapPin /> Geolocation
                </h2>
                <ul className="space-y-2 mb-4">
                  <li><span className="text-slate-500">ISP:</span> {data.geo_data.isp}</li>
                  <li><span className="text-slate-500">Org:</span> {data.geo_data.org}</li>
                  <li><span className="text-slate-500">Location:</span> {data.geo_data.city}, {data.geo_data.country}</li>
                </ul>

                {/* Render map if lat and lon exist */}
                {data.geo_data.lat && data.geo_data.lon && (
                  <MapView 
                    lat={data.geo_data.lat} 
                    lon={data.geo_data.lon} 
                    city={data.geo_data.city} 
                    country={data.geo_data.country} 
                    isp={data.geo_data.isp} 
                  />
                )}
              </div>
            )}
            
            {/* Shodan Ports Card */}
            {data.shodan_data && (
              <div className="bg-slate-900 border border-slate-800 p-6 rounded">
                <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4">Open Ports & Services</h2>
                <div className="flex flex-wrap gap-2">
                  {data.shodan_data.ports?.map(port => (
                    <span key={port} className="bg-slate-800 px-3 py-1 rounded-full text-sm">
                      Port {port}
                    </span>
                  ))}
                  {data.shodan_data.ports?.length === 0 && <span className="text-slate-500">No open ports detected.</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
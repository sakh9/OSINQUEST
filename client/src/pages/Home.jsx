import { useState, useRef } from 'react';
import axios from 'axios';
import { Search, ShieldAlert, Activity, MapPin, Globe, Server, AlertTriangle, Clock, CheckCircle2, Info } from 'lucide-react';
import MapView from '../components/MapView';
import AbuseGauge from '../components/AbuseGauge';
import ActivityChart from '../components/ActivityChart';

// Lightweight pre-flight check, purely for fast UX feedback before hitting
// the network. This is intentionally loose - the server's classifyQuery()
// is the authoritative validator (it also blocks private/reserved IPs,
// which this client-side check deliberately does not attempt to replicate,
// to avoid the two falling out of sync with each other over time).
function looksLikeIpOrDomain(value) {
  const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6 = /^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/;
  const domain = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;
  return ipv4.test(value) || ipv6.test(value) || domain.test(value);
}

// Small status banner shown inside a card when its data source errored out,
// was skipped, or genuinely came back empty - previously these three very
// different situations all just rendered as blank/empty, which reads as
// "nothing found" even when the real story is "this API failed" or
// "this domain never resolved to an IP so we couldn't check."
function SourceStatus({ error, skipped, reason }) {
  if (error) {
    return (
      <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-900/10 border border-amber-900/40 rounded p-2">
        <AlertTriangle size={14} className="shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (skipped) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm bg-slate-800/40 rounded p-2">
        <Clock size={14} className="shrink-0" />
        <span>{reason || 'Skipped'}</span>
      </div>
    );
  }
  return null;
}

// Note: the old text badge (color + "High/Moderate/Low risk" label) that
// used to live in the Abuse Reputation card is now the AbuseGauge chart
// instead - the 25/75 thresholds live in AbuseGauge's gaugeColor() so
// there's one source of truth instead of two functions that could drift
// out of sync with each other.

// Synthesizes the raw geo/shodan/abuse fields into one or two plain-English
// sentences, instead of leaving the person to read five separate cards and
// draw their own conclusion. This is the project's actual differentiator -
// most OSINT aggregators dump raw data and stop there; this interprets it.
// Returns null if there's nothing meaningful to say yet (e.g. every source
// errored or was skipped).
function buildRiskSummary({ geo, shodan, /* whois, */ abuse, type }) {
  const parts = [];
  const subject = type === 'domain' ? 'This domain' : 'This IP';
  let severity = 'info';

  if (geo && !geo.error && !geo.skipped) {
    const org = geo.org || geo.isp;
    const place = [geo.city, geo.country].filter(Boolean).join(', ');
    if (org && place) {
      parts.push(`${subject} is hosted by ${org} in ${place}.`);
    } else if (org) {
      parts.push(`${subject} is hosted by ${org}.`);
    } else if (place) {
      parts.push(`${subject} is located in ${place}.`);
    }
    if (type === 'domain' && geo.resolvedIp) {
      parts.push(`It resolves to ${geo.resolvedIp}.`);
    }
  }

  if (shodan && !shodan.error && !shodan.skipped) {
    const count = shodan.ports?.length || 0;
    if (count === 0) {
      parts.push('No open ports were detected.');
    } else {
      const preview = shodan.ports.slice(0, 5).join(', ');
      parts.push(`${count} open port${count === 1 ? '' : 's'} detected (${preview}${count > 5 ? ', …' : ''}).`);
    }
  }

  if (abuse && !abuse.error && !abuse.skipped) {
    const score = abuse.abuseConfidenceScore ?? 0;
    const reports = abuse.totalReports ?? 0;
    if (score === 0 && reports === 0) {
      parts.push('No abuse reports on file — appears clean.');
      severity = 'good';
    } else if (score < 25) {
      parts.push(`Low abuse risk (${score}% confidence from ${reports} report${reports === 1 ? '' : 's'}).`);
      severity = 'good';
    } else if (score < 75) {
      parts.push(`Moderate abuse risk — ${score}% confidence from ${reports} reports. Worth a closer look.`);
      severity = 'warn';
    } else {
      parts.push(`High abuse risk — ${score}% confidence from ${reports} reports. Treat with caution.`);
      severity = 'danger';
    }
    if (abuse.isTor) {
      parts.push('It is a known Tor exit node.');
      if (severity !== 'danger') severity = 'warn';
    }
  }

  if (parts.length === 0) return null;
  return { text: parts.join(' '), severity };
}

const SUMMARY_STYLES = {
  good: { className: 'border-emerald-900 bg-emerald-900/10 text-emerald-300', Icon: CheckCircle2 },
  warn: { className: 'border-amber-900 bg-amber-900/10 text-amber-300', Icon: AlertTriangle },
  danger: { className: 'border-red-900 bg-red-900/10 text-red-300', Icon: ShieldAlert },
  info: { className: 'border-slate-700 bg-slate-800/40 text-slate-300', Icon: Info },
};

export default function Home() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (loading) return; // guards against double-submit via rapid Enter presses

    const trimmedInput = input.trim();
    if (!trimmedInput) {
      return setError('Please enter an IP address or domain name.');
    }
    if (!looksLikeIpOrDomain(trimmedInput)) {
      return setError('That doesn\u2019t look like a valid IP address or domain name.');
    }

    // Cancel any still-in-flight previous request. Without this, firing a
    // second search before the first resolves creates a race where an
    // older, slower response can land after the newer one and silently
    // overwrite it with stale data.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError('');
    setData(null); // clear stale results so a failed new search doesn't show old data next to the error
    setLoading(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      // 30s timeout: free-tier hosts like Render spin down when idle and
      // can take up to ~60s to wake on the first request. This is generous
      // on purpose rather than failing a legitimate cold start early.
      const response = await axios.post(
        `${apiUrl}/api/lookup`,
        { query: trimmedInput },
        { signal: controller.signal, timeout: 30000 }
      );
      setData(response.data);
    } catch (err) {
      if (axios.isCancel(err) || err.code === 'ERR_CANCELED') return; // superseded by a newer search, not a real error
      console.error('API Error:', err);
      if (err.code === 'ECONNABORTED') {
        setError('The request timed out. The server may be waking up from idle - please try again.');
      } else {
        setError(err.response?.data?.error || 'Failed to fetch intelligence data.');
      }
    } finally {
      setLoading(false);
    }
  };

  const geo = data?.geo_data;
  const shodan = data?.shodan_data;
  const whois = data?.whois_data;
  const dnsData = data?.dns_data;
  const abuse = data?.abuse_data;
  const isReverseDns = dnsData && Array.isArray(dnsData.ptr);
  const riskSummary = data ? buildRiskSummary({ geo, shodan, whois, abuse, type: data.query_type }) : null;
  const summaryStyle = riskSummary ? SUMMARY_STYLES[riskSummary.severity] : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-mono">
      <div className="max-w-5xl mx-auto">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-emerald-400 mb-2 flex items-center justify-center gap-3">
            <ShieldAlert size={36} /> OSINT Nexus
          </h1>
          <p className="text-slate-400">IP & Domain Intelligence Aggregator</p>
        </header>

        <ActivityChart />

        <form onSubmit={handleSearch} className="flex gap-4 mb-8">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter IP (e.g. 8.8.8.8) or Domain (e.g. github.com)"
            aria-label="IP address or domain to look up"
            className="flex-1 bg-slate-900 border border-slate-700 rounded p-4 text-lg focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            aria-label={loading ? 'Searching' : 'Search'}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-4 rounded font-bold transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Activity className="animate-spin" /> : <Search />}
          </button>
        </form>

        {loading && (
          <div className="text-slate-500 text-sm mb-6 text-center">
            Querying geolocation, WHOIS, DNS, and reputation sources — this can take a few seconds
            (or up to a minute if the server is waking up from idle).
          </div>
        )}

        {error && (
          <div className="text-red-400 bg-red-900/20 p-4 border border-red-900 rounded mb-8">{error}</div>
        )}

        {data && !loading && (
          <>
            <div className="flex items-center justify-between mb-4 text-sm text-slate-500">
              <span>
                Results for <span className="text-slate-300">{data.query}</span>
                <span className="ml-2 uppercase text-xs border border-slate-700 rounded px-2 py-0.5">{data.query_type}</span>
              </span>
              {data.cached && (
                <span className="text-xs border border-slate-700 rounded px-2 py-0.5">from cache</span>
              )}
            </div>

            {riskSummary && (
              <div className={`flex items-start gap-3 p-4 border rounded mb-6 text-sm leading-relaxed ${summaryStyle.className}`}>
                <summaryStyle.Icon size={18} className="shrink-0 mt-0.5" />
                <p>{riskSummary.text}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Geolocation Card */}
              {geo && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded">
                  <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                    <MapPin /> Geolocation
                  </h2>
                  {(geo.error || geo.skipped) ? (
                    <SourceStatus error={geo.error} skipped={geo.skipped} reason={geo.reason} />
                  ) : (
                    <>
                      <ul className="space-y-2 mb-4">
                        <li><span className="text-slate-500">ISP:</span> {geo.isp || 'Unknown'}</li>
                        <li><span className="text-slate-500">Org:</span> {geo.org || 'Unknown'}</li>
                        <li><span className="text-slate-500">Location:</span> {geo.city || 'Unknown'}, {geo.country || 'Unknown'}</li>
                        {geo.resolvedIp && (
                          <li><span className="text-slate-500">Resolved IP:</span> {geo.resolvedIp}</li>
                        )}
                      </ul>
                      {Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lon)) && (
                        // Passing raw lat/lon straight through - MapView itself decides
                        // whether (0,0) means "unknown location" vs. a real coordinate
                        // that happens to sit on the equator/meridian.
                        <MapView lat={geo.lat} lon={geo.lon} city={geo.city} country={geo.country} isp={geo.isp} />
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Open Ports Card */}
              {shodan && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded">
                  <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                    <Server /> Open Ports & Services
                  </h2>
                  {(shodan.error || shodan.skipped) ? (
                    <SourceStatus error={shodan.error} skipped={shodan.skipped} reason={shodan.reason} />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {shodan.ports?.map((port) => (
                        <span key={port} className="bg-slate-800 text-slate-200 px-3 py-1 rounded text-sm border border-slate-700">
                          Port {port}
                        </span>
                      ))}
                      {(!shodan.ports || shodan.ports.length === 0) && (
                        <span className="text-slate-500">No open ports detected.</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* WHOIS Card */}
              {whois && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded">
                  <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                    <Globe /> WHOIS / RDAP Info
                  </h2>
                  {whois.error ? (
                    <SourceStatus error={whois.error} />
                  ) : (
                    <ul className="space-y-2 text-sm">
                      <li><span className="text-slate-500">Name:</span> {whois.name || 'Unknown'}</li>
                      <li><span className="text-slate-500">Handle:</span> {whois.handle || 'N/A'}</li>
                      {whois.country && (
                        <li><span className="text-slate-500">Country:</span> {whois.country}</li>
                      )}
                      {(whois.startAddress || whois.endAddress) && (
                        <li>
                          <span className="text-slate-500">Range:</span> {whois.startAddress} — {whois.endAddress}
                        </li>
                      )}
                      <li>
                        <span className="text-slate-500">Status: </span>
                        <span className="text-emerald-400">
                          {Array.isArray(whois.status) && whois.status.length > 0
                            ? whois.status.slice(0, 3).join(', ')
                            : 'Unknown'}
                        </span>
                      </li>
                      {whois.nameservers?.length > 0 && (
                        <li>
                          <span className="text-slate-500 block mb-1">Nameservers:</span>
                          <div className="flex flex-wrap gap-1">
                            {whois.nameservers.map((ns) => (
                              <span key={ns} className="bg-slate-800 px-2 py-0.5 rounded text-xs border border-slate-700">{ns}</span>
                            ))}
                          </div>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}

              {/* DNS Card - handles both forward (domain) and reverse (IP) shapes */}
              {dnsData && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded">
                  <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                    <Server /> DNS Records
                  </h2>
                  {dnsData.error ? (
                    <SourceStatus error={dnsData.error} />
                  ) : isReverseDns ? (
                    <div className="text-sm">
                      <strong className="text-slate-400 block mb-1">Reverse DNS (PTR):</strong>
                      <div className="flex flex-wrap gap-1">
                        {dnsData.ptr.length > 0
                          ? dnsData.ptr.map((h) => (
                              <span key={h} className="bg-slate-800 px-2 py-0.5 rounded text-xs border border-slate-700">{h}</span>
                            ))
                          : <span className="text-slate-500">No PTR record found.</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      {[
                        ['A Records (IPv4)', dnsData.A],
                        ['AAAA Records (IPv6)', dnsData.AAAA],
                        ['MX Records (Mail)', dnsData.MX],
                        ['CNAME Records', dnsData.CNAME],
                        ['Nameservers (NS)', dnsData.NS],
                        ['TXT Records', dnsData.TXT],
                      ].map(([label, values]) =>
                        values?.length > 0 ? (
                          <div key={label}>
                            <strong className="text-slate-400 block mb-1">{label}:</strong>
                            <div className="flex flex-wrap gap-1">
                              {values.map((v) => (
                                <span key={v} className="bg-slate-800 px-2 py-0.5 rounded text-xs border border-slate-700 break-all">{v}</span>
                              ))}
                            </div>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Abuse Reputation Card */}
              {abuse && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded">
                  <h2 className="text-xl text-emerald-400 border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                    <ShieldAlert /> Abuse Reputation
                  </h2>
                  {(abuse.error || abuse.skipped) ? (
                    <SourceStatus error={abuse.error} skipped={abuse.skipped} reason={abuse.reason} />
                  ) : (
                    <>
                      <AbuseGauge score={abuse.abuseConfidenceScore ?? 0} />
                      <ul className="space-y-2 text-sm mt-2">
                        <li><span className="text-slate-500">Total reports:</span> {abuse.totalReports ?? 0}</li>
                        {abuse.usageType && (
                          <li><span className="text-slate-500">Usage type:</span> {abuse.usageType}</li>
                        )}
                        {abuse.isTor !== undefined && (
                          <li><span className="text-slate-500">Tor exit node:</span> {abuse.isTor ? 'Yes' : 'No'}</li>
                        )}
                        {abuse.lastReportedAt && (
                          <li><span className="text-slate-500">Last reported:</span> {new Date(abuse.lastReportedAt).toLocaleDateString()}</li>
                        )}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
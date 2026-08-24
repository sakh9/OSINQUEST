CREATE TABLE lookups (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  query_type TEXT CHECK (query_type IN ('ip','domain')),
  geo_data JSONB,
  whois_data JSONB,
  dns_data JSONB,
  shodan_data JSONB,
  abuse_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lookups_query ON lookups(query);

CREATE TABLE search_history (
  id SERIAL PRIMARY KEY,
  lookup_id INT REFERENCES lookups(id) ON DELETE CASCADE,
  user_ip TEXT, 
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics View for your portfolio dashboard
CREATE MATERIALIZED VIEW mv_global_threat_stats AS
SELECT 
  query, 
  query_type, 
  COUNT(sh.id) as lookup_count,
  MAX(l.created_at) as last_seen
FROM lookups l
JOIN search_history sh ON l.id = sh.lookup_id
GROUP BY query, query_type
ORDER BY lookup_count DESC;

-- You can run this command via a cron job or API route to refresh the dashboard stats
-- REFRESH MATERIALIZED VIEW mv_global_threat_stats;
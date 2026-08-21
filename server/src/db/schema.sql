CREATE TABLE lookups (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  query_type TEXT CHECK (query_type IN ('ip','domain')),
  geo_data JSONB,
  whois_data JSONB,
  dns_data JSONB,
  shodan_data JSONB,
  abuse_score INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lookups_query ON lookups(query);

CREATE TABLE search_history (
  id SERIAL PRIMARY KEY,
  lookup_id INT REFERENCES lookups(id),
  ip_address TEXT,  -- of the person using your app, for basic rate-limit/analytics
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS city_jobs (
  city_key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS request_budgets (
  bucket TEXT PRIMARY KEY,
  used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_id TEXT NOT NULL
);

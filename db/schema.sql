-- ============================================================================
-- QMS Analytics Dashboard — database schema
--
-- Two databases. Run each block against the right one.
--   PART A -> the bank's QMS database (READ side). You create VIEWS over their
--             existing tables and a dedicated read-only user. Adapt the view
--             bodies to the real source tables — only the OUTPUT columns matter
--             to the app.
--   PART B -> your application database (users, RLS mapping, audit log).
-- ============================================================================


-- ============================================================================
-- PART A — QMS database (read-only analytics layer)
-- ----------------------------------------------------------------------------
-- Assumed source tables (rename to match reality):
--   tickets(ticket_id, branch_id, service_type, agent_id, agent_name,
--           issued_at, called_at, served_at, status, wait_seconds,
--           service_seconds, sla_met, customer_name, account_number,
--           phone_number)
--   branches(id, name)
-- status domain: WAITING, CALLED, SERVED, ABANDONED, TRANSFERRED, NO_SHOW
-- ============================================================================

-- Hourly aggregate that powers KPIs and the time series.
-- Grain: hour x branch x service_type x agent.
CREATE OR REPLACE VIEW v_qms_metrics AS
SELECT
  DATE_FORMAT(t.issued_at, '%Y-%m-%d %H:00:00')                       AS bucket_start,
  t.branch_id                                                        AS branch_id,
  b.name                                                             AS branch_name,
  t.service_type                                                     AS service_type,
  t.agent_id                                                         AS agent_id,
  COUNT(*)                                                           AS tickets_issued,
  SUM(t.status = 'SERVED')                                           AS tickets_served,
  SUM(t.status = 'ABANDONED')                                        AS tickets_abandoned,
  SUM(COALESCE(t.wait_seconds, 0))                                   AS total_wait_seconds,
  SUM(COALESCE(t.service_seconds, 0))                                AS total_service_seconds,
  SUM(t.status = 'SERVED' AND t.sla_met = 1)                         AS sla_met_count
FROM tickets t
JOIN branches b ON b.id = t.branch_id
GROUP BY bucket_start, t.branch_id, b.name, t.service_type, t.agent_id;

-- One row per ticket, for detail views and Excel export.
CREATE OR REPLACE VIEW v_qms_detail AS
SELECT
  t.ticket_id,
  t.branch_id,
  b.name              AS branch_name,
  t.service_type,
  t.agent_name,
  t.issued_at,
  t.served_at,
  t.wait_seconds,
  t.service_seconds,
  t.status,
  t.sla_met,
  t.customer_name,     -- PII: masked server-side unless role permits
  t.account_number,    -- PII
  t.phone_number       -- PII
FROM tickets t
JOIN branches b ON b.id = t.branch_id;

-- Current live state per branch, for the SSE stream.
CREATE OR REPLACE VIEW v_qms_live AS
SELECT
  b.id                                                               AS branch_id,
  b.name                                                             AS branch_name,
  SUM(t.status = 'WAITING')                                          AS waiting_count,
  SUM(t.status = 'CALLED')                                           AS serving_count,
  COALESCE(MAX(CASE WHEN t.status = 'WAITING'
             THEN TIMESTAMPDIFF(SECOND, t.issued_at, NOW()) END), 0) AS longest_wait_seconds,
  COALESCE(ROUND(AVG(CASE WHEN t.status = 'SERVED'
             AND DATE(t.served_at) = CURDATE()
             THEN t.wait_seconds END), 0), 0)                        AS avg_wait_today_seconds
FROM branches b
LEFT JOIN tickets t
  ON t.branch_id = b.id
 AND DATE(t.issued_at) = CURDATE()
GROUP BY b.id, b.name;

-- Dedicated read-only user. SELECT on the views ONLY — not the base tables.
-- Replace host/password; keep this account out of any write grants.
-- CREATE USER 'qms_reader'@'10.%' IDENTIFIED BY '<<strong-password>>';
-- GRANT SELECT ON qmsdb.v_qms_metrics TO 'qms_reader'@'10.%';
-- GRANT SELECT ON qmsdb.v_qms_detail  TO 'qms_reader'@'10.%';
-- GRANT SELECT ON qmsdb.v_qms_live    TO 'qms_reader'@'10.%';
-- FLUSH PRIVILEGES;


-- ============================================================================
-- PART B — Application database
-- ----------------------------------------------------------------------------
-- You normally do NOT run this by hand: the first-run /setup wizard creates
-- these tables automatically for whichever engine you choose (MySQL or SQL
-- Server — see lib/setup.ts for the SQL Server DDL). The MySQL DDL below is
-- kept for reference and for manual/offline provisioning.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_users (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email           VARCHAR(255) NOT NULL UNIQUE,
  full_name       VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,            -- Argon2id
  role            ENUM('SUPER_ADMIN','ADMIN','BRANCH_OPS')
                    NOT NULL DEFAULT 'BRANCH_OPS',
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    DATETIME NULL,
  last_login      DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- RLS mapping: which QMS branch UUIDs each user may see (branch_id = QMS branches.id).
CREATE TABLE IF NOT EXISTS app_user_branches (
  user_id   BIGINT UNSIGNED NOT NULL,
  branch_id VARCHAR(191) NOT NULL,
  PRIMARY KEY (user_id, branch_id),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only, hash-chained audit trail.
CREATE TABLE IF NOT EXISTS app_audit_log (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ts         VARCHAR(40) NOT NULL,
  user_id    BIGINT UNSIGNED NULL,
  action     VARCHAR(40) NOT NULL,
  resource   VARCHAR(120) NOT NULL,
  details    JSON NOT NULL,
  ip         VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  prev_hash  CHAR(64) NOT NULL,
  hash       CHAR(64) NOT NULL,
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Enforce append-only at the grant level: give the app user INSERT + SELECT
-- on this table, but NOT UPDATE or DELETE.
-- GRANT SELECT, INSERT ON appdb.app_audit_log TO 'app_user'@'10.%';

-- Saved filter presets per user (optional convenience feature).
CREATE TABLE IF NOT EXISTS app_saved_filters (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(120) NOT NULL,
  payload    JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- In-app direct messages between users.
CREATE TABLE IF NOT EXISTS app_messages (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sender_id    BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  body         TEXT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at      DATETIME NULL,
  FOREIGN KEY (sender_id)    REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES app_users(id) ON DELETE CASCADE,
  INDEX idx_msg_pair (sender_id, recipient_id),
  INDEX idx_msg_inbox (recipient_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- App-wide key/value settings (e.g. theme), managed by the super admin.
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(64) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

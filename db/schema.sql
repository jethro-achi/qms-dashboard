-- ============================================================================
-- QMS Analytics Dashboard — database schema
--
-- Two databases. Run each block against the right one.
--   PART A -> the bank's QMS database (READ side). This is the CONTRACT the app
--             queries against: the real `banktickets` fact table plus its
--             dimension tables, the exact columns the app reads, the indexes it
--             needs to stay fast, and a dedicated read-only (SELECT) user.
--   PART B -> your application database (users, RLS mapping, audit log).
-- ============================================================================


-- ============================================================================
-- PART A — QMS database (READ side — the schema the app actually queries)
-- ----------------------------------------------------------------------------
-- IMPORTANT: the app reads the bank's REAL QMS tables directly — it does NOT
-- create or depend on any `v_qms_*` views. This block documents the exact
-- tables + columns the code relies on (see lib/analytics/*.ts and
-- lib/reports/queries.ts) so you can (a) confirm your QMS matches, or (b) build
-- thin views/synonyms named identically if your column names differ.
--
-- Do NOT run these CREATE statements against a live QMS that already has these
-- tables — they are the reference shape. The only things you SHOULD run on the
-- QMS side are the recommended INDEXES and the read-only GRANT at the bottom.
--
-- Timestamps are stored in UTC; the app converts to QMS_TZ_OFFSET for display.
-- Durations are in SECONDS. ticketStatus domain: 'Waiting','Serving','Served',
-- 'Not Served'.
-- ============================================================================

-- ---- Fact table: one row per ticket -----------------------------------------
-- Every analytics/report query aggregates over this table, filtered by
-- branchId (row-level security) and createdAt (date window).
CREATE TABLE banktickets (
  id                BIGINT UNSIGNED PRIMARY KEY,   -- COUNT(t.id), staff/exception joins
  ticketNo          VARCHAR(32),                   -- shown in exceptions/feedback
  branchId          VARCHAR(191) NOT NULL,         -- -> branches.id   (RLS + filters)
  queueId           VARCHAR(191),                  -- -> queues.id     (filter option)
  counterId         VARCHAR(191),                  -- -> counters.id   (staff attribution)
  ticketStatus      VARCHAR(32)  NOT NULL,         -- 'Waiting'|'Serving'|'Served'|'Not Served'
  issueDescription  VARCHAR(255),                  -- "service type" — top drivers / by-service
  rating            TINYINT,                       -- 1..5, NULL if unrated (NPS/CSAT)
  ratingComment     VARCHAR(1000),                 -- free-text feedback, NULL if none
  createdAt         DATETIME     NOT NULL,         -- ticket issued (UTC) — primary time axis
  notServedAt       DATETIME,                      -- entered waiting (exceptions "time in")
  servingAt         DATETIME,                      -- service started
  servedAt          DATETIME,                      -- service ended
  notServedDuration INT,                           -- WAIT seconds (used for SLA + wait KPIs)
  servingDuration   INT,                           -- SERVICE seconds (service-time KPIs)
  totalDuration     INT                            -- wait + service seconds
);

-- ---- Dimension: branches ----------------------------------------------------
CREATE TABLE branches (
  id     VARCHAR(191) PRIMARY KEY,
  name   VARCHAR(255) NOT NULL,
  status TINYINT NOT NULL DEFAULT 1   -- getFilterOptions() lists WHERE status = 1
);

-- ---- Dimension: queues ------------------------------------------------------
CREATE TABLE queues (
  id   VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

-- ---- Dimension: service counters (workstations) -----------------------------
-- Staff attribution path: banktickets.counterId -> counters.id -> counters.userId -> users.id
CREATE TABLE counters (
  id        VARCHAR(191) PRIMARY KEY,
  userId    VARCHAR(191),               -- -> users.id (the teller signed in)
  available TINYINT                     -- 1 = online, 0 = offline (agent-activity page)
);

-- ---- Dimension: users (tellers/agents on the QMS side; NOT app_users) -------
CREATE TABLE users (
  id       VARCHAR(191) PRIMARY KEY,
  username VARCHAR(255)               -- displayed as the staff/agent name
);

-- ---- Activity log: teller/dashboard logins + actions (agent-activity page) ---
CREATE TABLE logs (
  id        BIGINT UNSIGNED PRIMARY KEY,
  userId    VARCHAR(191),             -- -> users.id, NULL for system events
  action    VARCHAR(64),              -- e.g. 'Teller Login', 'Dashboard login'
  details   VARCHAR(255),             -- 'success...' etc.
  createdAt DATETIME NOT NULL
);

-- ---- Recommended indexes (RUN THESE on the QMS side) ------------------------
-- This is the single biggest performance lever. Every analytics query filters
-- by branchId and a createdAt range; without a composite index MySQL full-scans
-- banktickets on each dashboard load. On a table with millions of rows that is
-- the difference between tens of milliseconds and seconds.
--
--   CREATE INDEX idx_bt_branch_created ON banktickets (branchId, createdAt);
--   CREATE INDEX idx_bt_created        ON banktickets (createdAt);
--   CREATE INDEX idx_bt_counter        ON banktickets (counterId);
--   CREATE INDEX idx_bt_queue          ON banktickets (queueId);
--   CREATE INDEX idx_logs_created      ON logs (createdAt);
-- Verify with EXPLAIN that the dashboard queries use idx_bt_branch_created
-- before rolling out to a large branch.

-- ---- Dedicated read-only user (RUN THIS on the QMS side) --------------------
-- The app only ever SELECTs. Grant SELECT on these five tables and nothing
-- else — no write grants, no other schemas. Replace host/password. In
-- production set QMS_DB_CA so the connection is TLS-encrypted.
-- CREATE USER 'qms_reader'@'10.%' IDENTIFIED BY '<<strong-password>>';
-- GRANT SELECT ON qms.banktickets TO 'qms_reader'@'10.%';
-- GRANT SELECT ON qms.branches    TO 'qms_reader'@'10.%';
-- GRANT SELECT ON qms.queues      TO 'qms_reader'@'10.%';
-- GRANT SELECT ON qms.counters    TO 'qms_reader'@'10.%';
-- GRANT SELECT ON qms.users       TO 'qms_reader'@'10.%';
-- GRANT SELECT ON qms.logs        TO 'qms_reader'@'10.%';
-- FLUSH PRIVILEGES;
-- Prefer pointing QMS_DB_HOST at a READ REPLICA so these aggregates never
-- compete with the live queue system on the primary.


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

-- scripts/seed-demo-qms.sql
-- =============================================================================
-- SYNTHETIC demo data for the QMS (read) side. For a PUBLIC test instance ONLY.
-- NEVER load real bank / NIRA data onto a shared demo box — this file exists so
-- you don't have to. Everything here is fake and randomly generated.
--
-- Run it into the bundled demo `qms` database:
--   docker compose exec -T db mysql -uroot -p"$MYSQL_ROOT_PASSWORD" qms < scripts/seed-demo-qms.sql
--
-- Safe to re-run: it recreates the tables (IF NOT EXISTS) and replaces the data.
-- Branch IDs are deterministic (branch-1 … branch-5) so you can assign them to a
-- demo Branch-Ops user in the app's User Management screen.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS qms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qms;

-- ---- Tables (mirror db/schema.sql PART A; indexes inline so re-run is safe) --
CREATE TABLE IF NOT EXISTS banktickets (
  id                BIGINT UNSIGNED PRIMARY KEY,
  ticketNo          VARCHAR(32),
  branchId          VARCHAR(191) NOT NULL,
  queueId           VARCHAR(191),
  counterId         VARCHAR(191),
  ticketStatus      VARCHAR(32)  NOT NULL,
  issueDescription  VARCHAR(255),
  rating            TINYINT,
  ratingComment     VARCHAR(1000),
  createdAt         DATETIME     NOT NULL,
  notServedAt       DATETIME,
  servingAt         DATETIME,
  servedAt          DATETIME,
  notServedDuration INT,
  servingDuration   INT,
  totalDuration     INT,
  KEY idx_bt_branch_created (branchId, createdAt),
  KEY idx_bt_created (createdAt),
  KEY idx_bt_counter (counterId),
  KEY idx_bt_queue (queueId)
);
CREATE TABLE IF NOT EXISTS branches (
  id VARCHAR(191) PRIMARY KEY, name VARCHAR(255) NOT NULL, status TINYINT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS queues (
  id VARCHAR(191) PRIMARY KEY, name VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191), available TINYINT
);
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(191) PRIMARY KEY, username VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS logs (
  id BIGINT UNSIGNED PRIMARY KEY, userId VARCHAR(191), action VARCHAR(64),
  details VARCHAR(255), createdAt DATETIME NOT NULL, KEY idx_logs_created (createdAt)
);

-- ---- Reset any prior demo data (idempotent re-seed) -------------------------
DELETE FROM banktickets;
DELETE FROM logs;
DELETE FROM counters;
DELETE FROM users;
DELETE FROM queues;
DELETE FROM branches;

-- ---- Dimensions -------------------------------------------------------------
INSERT INTO branches (id, name, status) VALUES
  ('branch-1', 'Kampala Central', 1),
  ('branch-2', 'Nakawa', 1),
  ('branch-3', 'Entebbe', 1),
  ('branch-4', 'Jinja', 1),
  ('branch-5', 'Mbarara', 1);

INSERT INTO queues (id, name) VALUES
  ('queue-1', 'New Registration'),
  ('queue-2', 'Renewal'),
  ('queue-3', 'Corrections'),
  ('queue-4', 'Card Collection'),
  ('queue-5', 'Enquiries'),
  ('queue-6', 'Payments');

INSERT INTO users (id, username) VALUES
  ('user-1', 'Achola Grace'),   ('user-2', 'Okello Daniel'),
  ('user-3', 'Namutebi Sarah'), ('user-4', 'Mugisha Peter'),
  ('user-5', 'Akello Betty'),   ('user-6', 'Ssentongo John'),
  ('user-7', 'Nakato Ruth'),    ('user-8', 'Wanyama Paul'),
  ('user-9', 'Auma Joan'),      ('user-10','Kato Brian');

INSERT INTO counters (id, userId, available) VALUES
  ('counter-1','user-1',1), ('counter-2','user-2',1), ('counter-3','user-3',0),
  ('counter-4','user-4',1), ('counter-5','user-5',1), ('counter-6','user-6',0),
  ('counter-7','user-7',1), ('counter-8','user-8',1), ('counter-9','user-9',0),
  ('counter-10','user-10',1);

-- ---- Fact table: generate tickets over the last 90 days --------------------
-- The data is generated with a DELIBERATE TREND so the dashboard's KPI cards
-- have something to compare against — the "vs last month" and "vs yesterday"
-- deltas are computed as last-30-days vs the prior-30 and latest-day vs the day
-- before (see lib/analytics/home.ts). Uniform-random data makes those deltas
-- read flat/"—"; the shape below makes them move in the DESIRABLE direction:
--   * volume RISES toward today          -> "Customers Served" up
--   * wait & service caps SHRINK toward today -> waits/service improving
--   * SLA compliance therefore rises (shorter waits fall under the target)
--   * satisfaction skews higher on recent days
-- It iterates day-by-day (0 = today … 89 = oldest) so every day is populated
-- and the latest day is always "today", which is what the trend anchors to.
DROP PROCEDURE IF EXISTS seed_tickets;
DELIMITER $$
CREATE PROCEDURE seed_tickets()
BEGIN
  DECLARE d INT DEFAULT 0;          -- days ago: 0 = today, 89 = oldest
  DECLARE j INT;
  DECLARE day_count INT;
  DECLARE gid BIGINT DEFAULT 0;     -- monotonic ticket id
  DECLARE v_day DATE;
  DECLARE v_created DATETIME;
  DECLARE v_status VARCHAR(16);
  DECLARE v_wait INT;
  DECLARE v_serve INT;
  DECLARE v_rate TINYINT;
  DECLARE r DOUBLE;
  DECLARE wait_cap INT;
  DECLARE serve_cap INT;
  SET autocommit = 0;
  WHILE d < 90 DO
    SET v_day = DATE_SUB(CURDATE(), INTERVAL d DAY);
    -- Volume grows toward today: ~400/day (90 days ago) to ~900/day (today), with
    -- day-to-day jitter so the "vs yesterday" delta has real movement too.
    SET day_count = GREATEST(150, ROUND(400 + (90 - d) * 5.5 + (RAND() - 0.5) * 120));
    -- Duration caps SHRINK toward today, so recent waits/service are shorter.
    SET wait_cap  = 300 + d * 8;    -- today ~300s (5 min), 90d ago ~1012s
    SET serve_cap = 200 + d * 6;    -- today ~200s,        90d ago ~734s
    SET j = 0;
    WHILE j < day_count DO
      SET gid = gid + 1;
      -- Weighted to business hours (08:00–16:59).
      SET v_created = DATE_ADD(v_day,     INTERVAL (8 + FLOOR(RAND() * 9)) HOUR);
      SET v_created = DATE_ADD(v_created, INTERVAL FLOOR(RAND() * 60) MINUTE);
      SET v_created = DATE_ADD(v_created, INTERVAL FLOOR(RAND() * 60) SECOND);

      SET r = RAND();
      SET v_status = CASE
        WHEN r < 0.82 THEN 'Served'
        WHEN r < 0.92 THEN 'Not Served'
        WHEN r < 0.97 THEN 'Waiting'
        ELSE 'Serving' END;

      SET v_wait = FLOOR(RAND() * wait_cap);
      IF RAND() < 0.03 THEN
        SET v_serve = 3700 + FLOOR(RAND() * 3600);   -- rare "exception" service
      ELSE
        SET v_serve = 60 + FLOOR(RAND() * serve_cap);
      END IF;

      -- Satisfaction improves toward today (recent days skew to 4–5 stars).
      SET r = RAND();
      IF d < 30 THEN
        SET v_rate = CASE WHEN r < 0.45 THEN NULL WHEN r < 0.55 THEN 3 WHEN r < 0.72 THEN 4 ELSE 5 END;
      ELSEIF d < 60 THEN
        SET v_rate = CASE WHEN r < 0.55 THEN NULL WHEN r < 0.70 THEN 3 WHEN r < 0.87 THEN 4 ELSE 5 END;
      ELSE
        SET v_rate = CASE WHEN r < 0.60 THEN NULL WHEN r < 0.80 THEN 3 WHEN r < 0.93 THEN 4 ELSE 5 END;
      END IF;

      INSERT INTO banktickets
        (id, ticketNo, branchId, queueId, counterId, ticketStatus, issueDescription,
         rating, ratingComment, createdAt, notServedAt, servingAt, servedAt,
         notServedDuration, servingDuration, totalDuration)
      VALUES (
        gid,
        CONCAT('T', LPAD(gid, 6, '0')),
        CONCAT('branch-', 1 + FLOOR(RAND() * 5)),
        CONCAT('queue-',  1 + FLOOR(RAND() * 6)),
        CONCAT('counter-',1 + FLOOR(RAND() * 10)),
        v_status,
        ELT(1 + FLOOR(RAND() * 6),
            'New Registration','Renewal','Correction','Card Collection','Enquiry','Payment'),
        v_rate,
        CASE WHEN v_rate IS NULL THEN NULL
             WHEN v_rate <= 3 THEN ELT(1 + FLOOR(RAND() * 3), 'Long wait time','Slow service','Confusing process')
             ELSE ELT(1 + FLOOR(RAND() * 3), 'Very helpful staff','Quick and easy','Friendly service') END,
        v_created,
        v_created,
        CASE WHEN v_status IN ('Serving','Served') THEN DATE_ADD(v_created, INTERVAL v_wait SECOND) END,
        CASE WHEN v_status = 'Served' THEN DATE_ADD(v_created, INTERVAL v_wait + v_serve SECOND) END,
        v_wait,
        CASE WHEN v_status = 'Served' THEN v_serve END,
        CASE WHEN v_status = 'Served' THEN v_wait + v_serve END
      );
      SET j = j + 1;
    END WHILE;
    SET d = d + 1;
  END WHILE;
  COMMIT;
  SET autocommit = 1;
END$$
DELIMITER ;

CALL seed_tickets();
DROP PROCEDURE seed_tickets;

-- ---- Activity logs: login/logout per agent for the last 30 days -------------
-- Powers the Agent Activity availability report (login → logout sessions).
DROP PROCEDURE IF EXISTS seed_logs;
DELIMITER $$
CREATE PROCEDURE seed_logs()
BEGIN
  DECLARE u INT DEFAULT 1;
  DECLARE d INT;
  DECLARE lid INT DEFAULT 1;
  DECLARE v_day DATE;
  SET autocommit = 0;
  WHILE u <= 10 DO
    SET d = 0;
    WHILE d < 30 DO
      SET v_day = DATE_SUB(CURDATE(), INTERVAL d DAY);
      IF RAND() < 0.85 THEN   -- most days worked
        INSERT INTO logs (id, userId, action, details, createdAt)
          VALUES (lid, CONCAT('user-', u), 'Teller Login', 'success',
                  DATE_ADD(v_day, INTERVAL (8 * 60 + FLOOR(RAND() * 30)) MINUTE));
        SET lid = lid + 1;
        INSERT INTO logs (id, userId, action, details, createdAt)
          VALUES (lid, CONCAT('user-', u), 'Logout', '',
                  DATE_ADD(v_day, INTERVAL (16 * 60 + FLOOR(RAND() * 90)) MINUTE));
        SET lid = lid + 1;
      END IF;
      SET d = d + 1;
    END WHILE;
    SET u = u + 1;
  END WHILE;
  COMMIT;
  SET autocommit = 1;
END$$
DELIMITER ;

CALL seed_logs();
DROP PROCEDURE seed_logs;

SELECT
  (SELECT COUNT(*) FROM banktickets) AS tickets,
  (SELECT COUNT(*) FROM branches)    AS branches,
  (SELECT COUNT(*) FROM logs)        AS log_rows;

-- deploy/mysql-init/01-init.sql
-- Runs ONCE, the first time the MySQL data volume is initialised (empty).
-- Compose already created the application database + app_user via the
-- MYSQL_* env vars; this adds the QMS (read) side so a single MySQL container
-- can host both during evaluation.
--
-- In production the QMS data lives on the bank's own read-only replica — you
-- would NOT use this file there; point QMS_DB_HOST at the replica instead.

-- The QMS database the dashboard reads from.
CREATE DATABASE IF NOT EXISTS qms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A dedicated, SELECT-only user for the read side. The dashboard physically
-- cannot mutate queue data with these grants — defence in depth on top of the
-- app only ever issuing SELECTs.
CREATE USER IF NOT EXISTS 'qms_user'@'%' IDENTIFIED BY 'change-me-qms-password';
GRANT SELECT ON qms.* TO 'qms_user'@'%';

-- Also let the app_user reach the qms schema for local, single-DB evaluation
-- (harmless if unused). Remove for a hardened deployment.
GRANT SELECT ON qms.* TO 'app_user'@'%';

FLUSH PRIVILEGES;

-- NOTE: the QMS analytics VIEWS (v_qms_metrics, v_qms_detail, …) are defined in
-- db/schema.sql PART A over the bank's real source tables. Load a QMS data dump
-- (or adapt and run that file) into the `qms` database before the dashboards
-- will show real figures.

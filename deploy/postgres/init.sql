-- Runs once, as the Postgres superuser, when the data volume is created.
-- Two login roles: the migration owner and the runtime role (no BYPASSRLS, no ownership).
CREATE ROLE atrium_owner LOGIN PASSWORD 'atrium_owner';
CREATE ROLE atrium_app LOGIN PASSWORD 'atrium_app' NOBYPASSRLS;

CREATE DATABASE atrium OWNER atrium_owner;
CREATE DATABASE atrium_test OWNER atrium_owner;

\c atrium
CREATE EXTENSION IF NOT EXISTS vector;
GRANT CONNECT ON DATABASE atrium TO atrium_app;

\c atrium_test
CREATE EXTENSION IF NOT EXISTS vector;
GRANT CONNECT ON DATABASE atrium_test TO atrium_app;

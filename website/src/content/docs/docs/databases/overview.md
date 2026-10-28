---
title: Database Overview
description: Database engines, credentials, public hostnames, data tools, and backup coverage.
---

Aeroplane databases are services. They live inside projects, have deployments, variables, logs, data tools, settings, domains where applicable, and backups.

## Engines

Aeroplane can create:

| Engine | Default port | Notes |
| --- | ---: | --- |
| PostgreSQL | `5432` | Optional PostGIS, logical replication, and backups. |
| TimescaleDB | `5432` | PostgreSQL-family service with TimescaleDB extension handling. |
| MySQL | `3306` | Supports browsing, SQL console, row editing, backups, and restore. |
| Redis | `6379` | Supports key browsing/editing and backups. |
| MongoDB | `27017` | Supports collection browsing/editing and backups. |
| ClickHouse | `8123` | Supports browsing and SQL console. Backups are not available yet. |

PostgreSQL setup offers **Include PostGIS** and **Connect an existing database**. See [PostGIS and existing PostgreSQL connections](/docs/databases/postgis/).

## Created Variables

When you create a database service, Aeroplane generates engine-specific variables such as `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, or `MONGO_INITDB_ROOT_PASSWORD`.

App services in the same project can use database variable suggestions instead of manually copying generated values.

## Deploying Databases

Database deployment ensures the Docker image, container, persistent volume, environment variables, runtime network, public hostname route, and engine-specific settings are present.

Database services are not hot-swapped like app services. They use persistent volumes, and redeploying may briefly interrupt clients.

## Public Access

When a root domain is configured, Aeroplane can create public database hostnames. The hostname and host port are shown in the database service settings.

Use public access for admin tools, migrations, or external clients that cannot join the Docker runtime network. Keep it disabled when everything talks privately from app services on the same server.

## Data Tools

Database services can expose:

- Table or collection browsing.
- Row, document, or Redis key editing where supported.
- SQL console for relational engines.
- Data import for PostgreSQL-compatible and Redis services.
- Backups and restores for supported backup engines.

## Backup Coverage

Supported backup engines:

- PostgreSQL and TimescaleDB: `pg_dump` custom format.
- MySQL: `mysqldump` SQL.
- MongoDB: `mongodump` gzip archive.
- Redis: RDB dump.

ClickHouse backups are not available yet.

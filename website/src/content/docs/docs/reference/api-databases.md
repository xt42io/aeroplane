---
title: Databases API
description: Database service creation, table browsing, row editing, backups, TLS, and import endpoints.
---

Database services are Aeroplane services with `repoFullName: "database:<engine>"`.

All examples assume:

```bash
export AEROPLANE_URL="https://pilot.example.com"
export AEROPLANE_API_KEY="ap_..."
```

## Supported Engines

Use these engine IDs in `repoFullName`:

- `database:postgres`
- `database:postgis` (PostgreSQL with PostGIS)
- `database:timescale`
- `database:mysql`
- `database:redis`
- `database:mongodb`
- `database:clickhouse`

## Create PostgreSQL

```txt
POST /api/projects/:projectId/services
```

Required access: `write`

Project scope: project must be visible to the key.

Payload:

```json
{
  "name": "postgres-db",
  "repoFullName": "database:postgres",
  "repoUrl": "database",
  "branch": "main",
  "internalPort": 5432,
  "databasePublicEnabled": true,
  "postgresLogicalReplicationEnabled": true,
  "env": [
    { "key": "POSTGRES_DB", "value": "aeroplane" },
    { "key": "POSTGRES_USER", "value": "postgres" },
    { "key": "POSTGRES_PASSWORD", "value": "change-this-password" }
  ]
}
```

Example:

```bash
curl -X POST "$AEROPLANE_URL/api/projects/project_123/services" \
  -H "Authorization: Bearer $AEROPLANE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "postgres-db",
    "repoFullName": "database:postgres",
    "repoUrl": "database",
    "branch": "main",
    "internalPort": 5432,
    "databasePublicEnabled": true,
    "postgresLogicalReplicationEnabled": true,
    "env": [
      { "key": "POSTGRES_DB", "value": "aeroplane" },
      { "key": "POSTGRES_USER", "value": "postgres" },
      { "key": "POSTGRES_PASSWORD", "value": "change-this-password" }
    ]
  }'
```

Response:

```json
{
  "service": {
    "id": "svc_postgres",
    "projectId": "project_123",
    "name": "postgres-db",
    "slug": "postgres-db",
    "repoFullName": "database:postgres",
    "repoUrl": "database",
    "dockerImage": null,
    "branch": "main",
    "runtimeMode": "web",
    "internalPort": 5432,
    "hostPort": 41003,
    "databasePublicEnabled": true,
    "databasePublicHostname": "postgres-db.example.com",
    "postgresLogicalReplicationEnabled": true,
    "status": "idle",
    "createdAt": "2026-06-10T08:50:00.000Z",
    "updatedAt": "2026-06-10T08:50:00.000Z"
  }
}
```

`databasePublicHostname` is optional. When omitted and a root domain is configured, Aeroplane generates the public database hostname from the service name.

## Create Other Engines

Use the same endpoint and change `repoFullName`, `internalPort`, and initial environment variables.

Redis:

```json
{
  "name": "redis-db",
  "repoFullName": "database:redis",
  "repoUrl": "database",
  "branch": "main",
  "internalPort": 6379,
  "databasePublicEnabled": true,
  "env": [
    { "key": "REDIS_PASSWORD", "value": "change-this-password" }
  ]
}
```

MongoDB:

```json
{
  "name": "mongo-db",
  "repoFullName": "database:mongodb",
  "repoUrl": "database",
  "branch": "main",
  "internalPort": 27017,
  "databasePublicEnabled": true,
  "env": [
    { "key": "MONGO_INITDB_ROOT_USERNAME", "value": "mongo" },
    { "key": "MONGO_INITDB_ROOT_PASSWORD", "value": "change-this-password" }
  ]
}
```

MySQL:

```json
{
  "name": "mysql-db",
  "repoFullName": "database:mysql",
  "repoUrl": "database",
  "branch": "main",
  "internalPort": 3306,
  "databasePublicEnabled": true,
  "env": [
    { "key": "MYSQL_DATABASE", "value": "aeroplane" },
    { "key": "MYSQL_USER", "value": "mysql" },
    { "key": "MYSQL_PASSWORD", "value": "change-this-password" },
    { "key": "MYSQL_ROOT_PASSWORD", "value": "change-this-root-password" }
  ]
}
```

ClickHouse:

```json
{
  "name": "clickhouse-db",
  "repoFullName": "database:clickhouse",
  "repoUrl": "database",
  "branch": "main",
  "internalPort": 8123,
  "databasePublicEnabled": true,
  "env": [
    { "key": "CLICKHOUSE_DB", "value": "aeroplane" },
    { "key": "CLICKHOUSE_USER", "value": "clickhouse" },
    { "key": "CLICKHOUSE_PASSWORD", "value": "change-this-password" },
    { "key": "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT", "value": "1" }
  ]
}
```

TimescaleDB:

```json
{
  "name": "timescale-db",
  "repoFullName": "database:timescale",
  "repoUrl": "database",
  "branch": "main",
  "internalPort": 5432,
  "databasePublicEnabled": true,
  "postgresLogicalReplicationEnabled": true,
  "env": [
    { "key": "POSTGRES_DB", "value": "aeroplane" },
    { "key": "POSTGRES_USER", "value": "postgres" },
    { "key": "POSTGRES_PASSWORD", "value": "change-this-password" },
    { "key": "TIMESCALEDB_TELEMETRY", "value": "off" }
  ]
}
```

## List Tables

```txt
GET /api/services/:serviceId/database/tables
```

Required access: `read`

Project scope: service project must be visible to the key.

For Redis, add `?database=0` to choose a logical database.

Example:

```bash
curl "$AEROPLANE_URL/api/services/svc_postgres/database/tables" \
  -H "Authorization: Bearer $AEROPLANE_API_KEY"
```

Response:

```json
{
  "engine": "postgres",
  "tables": [
    {
      "id": "public.users",
      "name": "users",
      "schema": "public",
      "rowCount": 42
    }
  ]
}
```

## Read Rows

```txt
GET /api/services/:serviceId/database/rows?table=:table&limit=:limit&offset=:offset
```

Required access: `read`

Example:

```bash
curl "$AEROPLANE_URL/api/services/svc_postgres/database/rows?table=public.users&limit=50&offset=0" \
  -H "Authorization: Bearer $AEROPLANE_API_KEY"
```

Response:

```json
{
  "engine": "postgres",
  "table": "public.users",
  "columns": [
    { "name": "id", "type": "uuid", "primary": true },
    { "name": "email", "type": "text", "primary": false }
  ],
  "rows": [
    {
      "id": "user_123",
      "email": "owner@example.com"
    }
  ],
  "limit": 50,
  "offset": 0,
  "total": 1
}
```

## Run SQL Query

```txt
POST /api/services/:serviceId/database/query
```

Required access: `write`

Payload:

```json
{
  "sql": "select now() as current_time"
}
```

Response:

```json
{
  "columns": [
    { "name": "current_time", "type": "timestamp" }
  ],
  "rows": [
    { "current_time": "2026-06-10T08:55:00.000Z" }
  ],
  "rowCount": 1
}
```

## Insert Row

```txt
POST /api/services/:serviceId/database/rows
```

Required access: `write`

Payload:

```json
{
  "table": "public.users",
  "values": {
    "email": "new@example.com"
  }
}
```

Response:

```json
{
  "ok": true,
  "table": "public.users",
  "id": "user_456"
}
```

## Update Row

```txt
PATCH /api/services/:serviceId/database/rows
```

Required access: `write`

Payload:

```json
{
  "table": "public.users",
  "primaryKey": {
    "id": "user_456"
  },
  "values": {
    "email": "updated@example.com"
  }
}
```

Response:

```json
{
  "ok": true
}
```

## Delete Row

```txt
DELETE /api/services/:serviceId/database/rows
```

Required access: `write`

Payload:

```json
{
  "table": "public.users",
  "primaryKey": {
    "id": "user_456"
  }
}
```

Response:

```json
{
  "ok": true
}
```

## List Backups

```txt
GET /api/services/:serviceId/database/backups
```

Required access: `read`

Response:

```json
{
  "backups": [
    {
      "id": "backup_123",
      "serviceId": "svc_postgres",
      "engine": "postgres",
      "status": "succeeded",
      "trigger": "manual",
      "storage": "disk",
      "format": "custom",
      "localPath": "/data/backups/svc_postgres/backup_123.dump",
      "r2Key": null,
      "sizeBytes": 2048,
      "checksum": "sha256:...",
      "error": null,
      "createdAt": "2026-06-10T09:00:00.000Z",
      "startedAt": "2026-06-10T09:00:00.000Z",
      "finishedAt": "2026-06-10T09:00:05.000Z"
    }
  ],
  "settings": {
    "serviceId": "svc_postgres",
    "storage": "disk",
    "automaticEnabled": false,
    "dailyEnabled": false,
    "weeklyEnabled": false,
    "monthlyEnabled": false,
    "createdAt": "2026-06-10T08:50:00.000Z",
    "updatedAt": "2026-06-10T08:50:00.000Z"
  },
  "r2": {
    "connected": false
  }
}
```

## Create Backup

```txt
POST /api/services/:serviceId/database/backups
```

Required access: `write`

Payload:

```json
{
  "storage": "disk"
}
```

Allowed storage values: `disk`, `r2`, `disk+r2`.

Response:

```json
{
  "backup": {
    "id": "backup_123",
    "serviceId": "svc_postgres",
    "engine": "postgres",
    "status": "running",
    "trigger": "manual",
    "storage": "disk",
    "format": "custom",
    "createdAt": "2026-06-10T09:00:00.000Z",
    "startedAt": "2026-06-10T09:00:00.000Z",
    "finishedAt": null
  }
}
```

## Restore Backup

```txt
POST /api/services/:serviceId/database/backups/:backupId/restore
```

Required access: `write`

Response:

```json
{
  "ok": true,
  "restoredAt": "2026-06-10T09:10:00.000Z",
  "backup": {
    "id": "backup_123",
    "status": "succeeded"
  }
}
```

## Download Backup

```txt
GET /api/services/:serviceId/database/backups/:backupId/download
```

Required access: `read`

Example:

```bash
curl -L "$AEROPLANE_URL/api/services/svc_postgres/database/backups/backup_123/download" \
  -H "Authorization: Bearer $AEROPLANE_API_KEY" \
  -o backup.dump
```

Response body: backup file bytes.

## Delete Backup

```txt
DELETE /api/services/:serviceId/database/backups/:backupId
```

Required access: `write`

Response:

```json
{
  "ok": true
}
```

## Postgres TLS Info

```txt
GET /api/services/:serviceId/database/tls
```

Required access: `read`

Postgres-compatible services only.

Response:

```json
{
  "tls": {
    "active": true,
    "caCertAvailable": true,
    "publicHostname": "postgres-db.example.com",
    "publicPort": 41003
  }
}
```

## Download Postgres CA

```txt
GET /api/services/:serviceId/database/tls/ca
```

Required access: `read`

Response body: PEM file bytes.

## Data Imports

List imports:

```txt
GET /api/services/:serviceId/database/imports
```

Response:

```json
{
  "imports": [
    {
      "id": "import_123",
      "serviceId": "svc_postgres",
      "engine": "postgres",
      "source": "postgres-url",
      "sourceLabel": "Postgres URL",
      "status": "succeeded",
      "createdAt": "2026-06-10T09:20:00.000Z",
      "startedAt": "2026-06-10T09:20:00.000Z",
      "finishedAt": "2026-06-10T09:21:00.000Z"
    }
  ]
}
```

Import Postgres from URL:

```txt
POST /api/services/:serviceId/database/import/postgres-url
```

Payload:

```json
{
  "sourceUrl": "postgresql://user:password@host:5432/database"
}
```

Import Redis from URL:

```txt
POST /api/services/:serviceId/database/import/redis-url
```

Payload:

```json
{
  "sourceUrl": "redis://:password@host:6379/0"
}
```

Import response:

```json
{
  "result": {
    "id": "import_123",
    "status": "running",
    "source": "postgres-url",
    "createdAt": "2026-06-10T09:20:00.000Z"
  }
}
```

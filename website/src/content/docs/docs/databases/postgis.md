---
title: PostGIS and Existing Connections
description: Enable spatial features on new PostgreSQL services or connect an existing PostgreSQL database for browsing, edits and SQL.
---

## Create PostgreSQL with PostGIS

Choose **Database → PostgreSQL** when adding a project service, then enable **Include PostGIS**. This preserves the normal PostgreSQL setup: database name, user, password, generated connection URLs, public access, TLS, logical replication, data browser, SQL console and backups.

New PostGIS services use `postgis/postgis:18-3.6` with the PostgreSQL 18 data volume mounted at `/var/lib/postgresql`. The upstream image currently supports x86-64 servers. Aeroplane checks the Docker server architecture before replacing a container or changing its volumes. Existing plain PostgreSQL services are not converted automatically.

After deployment, verify the extension in the SQL console:

```sql
SELECT PostGIS_Full_Version();
SELECT ST_DistanceSphere(
  ST_SetSRID(ST_MakePoint(3.4, 6.5), 4326),
  ST_SetSRID(ST_MakePoint(3.5, 6.6), 4326)
);
```

See the [upstream image documentation](https://github.com/postgis/docker-postgis) for versions, architecture and upgrade guidance. This image does not combine PostGIS with pgvector or TimescaleDB.

## Connect an existing database

In PostgreSQL setup, select **Connect an existing database** and enter a `postgres://` or `postgresql://` URL with its hostname, username and database name. Use a host and port reachable from the Aeroplane server. For a manually created Docker database on the same VPS, this can be its published loopback port, for example:

```text
postgresql://app:password@127.0.0.1:18308/my_database?sslmode=disable
```

For an existing PostGIS database, enable **Include PostGIS** to verify that PostGIS is already enabled. Connecting never installs extensions or copies the source data.

Aeroplane encrypts the saved connection URL using `AEROPLANE_SECRET_KEY`. The connection summary contains only the host, port, database, username and TLS mode. Connection URLs are available through the explicit app-variable suggestion workflow, under the same project access controls as other database credentials.

The **Data** tab supports browsing, filters, pagination, inserts, updates and deletes. The **SQL** tab runs SQL against the existing database. The supplied PostgreSQL user's grants determine which reads and writes succeed; a read-only database role remains read-only. API-key access levels and project scopes still apply. Database operations have a 15-second statement timeout.

The existing database retains its hosting, deployment and backup configuration. Aeroplane runs a client-only container with no database volume or published port. Removing the connection removes that client and its registration; it does not stop the database or delete its data. Deployment, managed restore and data-import actions are unavailable for existing connections. **Settings → Check connection** can restart a missing client, and **Replace connection URL** validates a replacement before saving it.

### TLS and URL parameters

The supported URL parameter is `sslmode`. The default is libpq's `prefer`; specify the mode appropriate to your database. Public CA verification uses the client image's CA bundle for `verify-ca` and `verify-full`. PostgreSQL recommends [`verify-full`](https://www.postgresql.org/docs/18/libpq-ssl.html) when verifying server identity. No certificate validation is silently downgraded. Custom CA uploads, client certificates, local service files and arbitrary libpq options are not supported by this connection form.

## Import a copy into a managed service

Use **Import data → Postgres URL** on an Aeroplane-managed PostgreSQL service when you want a separate managed copy. This is a different workflow from connecting to the live database. The existing import confirmation and replacement behavior apply.

Spatial imports check that the target provides the required PostGIS extensions and is not older than the source. A plain PostgreSQL image fails with an explanation to enable PostGIS. The restore preserves installed PostGIS extension dependencies while restoring user tables, geometry values and spatial indexes. Unsupported custom extensions may still require a custom database image and migration procedure.

## API

Create a PostgreSQL service with `repoFullName: "database:postgis"` to deploy the PostGIS variant. Add `databaseConnectionUrl` to a PostgreSQL/PostGIS create-service payload to register an existing connection instead of provisioning a database.

For a registered connection:

- `POST /api/services/:serviceId/database/connection/check` checks connectivity.
- `PATCH /api/services/:serviceId/database/connection` accepts `{ "url": "postgresql://..." }` to replace the saved connection.
- The normal database table, row and SQL endpoints provide data access.
- Deleting the service forgets the registration and removes only its client container.

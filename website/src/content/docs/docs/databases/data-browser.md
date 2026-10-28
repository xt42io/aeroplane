---
title: Data Browser
description: Browse, query, insert, edit, and delete database records from Aeroplane.
---

The database data browser gives operational access inside the service page. It is meant for inspection, small edits, and recovery work, not bulk analytics.

## Supported Views

| Engine | Browse | Edit | SQL console |
| --- | --- | --- | --- |
| PostgreSQL (including PostGIS) | Tables | Yes | Yes |
| TimescaleDB | Tables | Yes | Yes |
| MySQL | Tables | Yes | Yes |
| Redis | Keys | Yes | No |
| MongoDB | Collections | Yes | No |
| ClickHouse | Tables | Read-only | Yes |

Aeroplane hides TimescaleDB internal schemas from table lists. Existing PostgreSQL connections use the same table editor and SQL console; the supplied database user determines which operations are permitted. See [PostGIS and existing connections](/docs/databases/postgis/).

## Filters and Pagination

Table browsing supports filters such as:

- equals
- not equals
- contains
- starts with
- ends with
- is empty
- is not empty
- greater than
- less than

Row queries are paginated. Aeroplane caps page size to keep browser actions bounded.

## Editing Rows

PostgreSQL, TimescaleDB, MySQL, Redis, and MongoDB support inserts and edits from the UI. Relational row updates and deletes require enough key data to target the row safely.

Redis uses a dedicated key browser instead of the generic table grid. You can add keys, add items, edit string values, edit hash fields, edit list items, edit set members, edit sorted set members and scores, delete keys or items, and change TTL. Unsupported Redis types show a preview message instead of an editor.

ClickHouse browsing is read-only in Aeroplane's current UI.

## SQL Console

The SQL console is available for PostgreSQL-family services, MySQL, and ClickHouse.

For PostgreSQL-family engines, `SELECT` and `WITH` queries return rows. Other SQL runs and returns command output.

For MySQL, Aeroplane parses tabular output from the `mysql` client.

For ClickHouse, read queries return JSON rows. If the query does not include a `FORMAT`, Aeroplane adds `FORMAT JSONEachRow`.

## Runtime Notices

If the database service is not deployed, failed, or still deploying, the browser shows a runtime notice instead of a misleading empty table list.

Deploy the database service first, then return to the Data or SQL tab.

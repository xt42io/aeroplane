import { eq } from "drizzle-orm";
import { containerNameForService, getServiceById } from "./deploy.js";
import { isMongoDatabase, isPostgresFamilyDatabase, isRelationalDatabase } from "./database-engine.js";
import { externalDatabaseUrl } from "./database-connections.js";
import { externalPostgresEnvironment, parseExternalPostgresUrl } from "./external-postgres-url.js";
import { databaseTypeForService, isDatabaseService } from "./database-urls.js";
import { deleteMongoRow, getMongoRows, getMongoTables, insertMongoRow, updateMongoRow } from "./database-mongo-viewer.js";
import { deleteRedisRow, getRedisRows, getRedisTables, insertRedisRow, updateRedisRow } from "./database-redis-viewer.js";
import {
  activeFiltersForColumns,
  runDockerExec,
  type DatabaseColumn,
  type DatabaseContext,
  type DatabaseRowFilter,
  type DatabaseSchema,
  type DatabaseTable,
  type RowData
} from "./database-viewer-shared.js";
import { db } from "./db.js";
import { envVars } from "./schema.js";
import {
  DatabaseRuntimeUnavailableError,
  databaseRuntimeErrorForService,
  databaseRuntimeNoticeForError,
  databaseRuntimeNoticeForService,
  type DatabaseRuntimeNotice
} from "./database-runtime-status.js";

export type { DatabaseRowFilter } from "./database-viewer-shared.js";
export { DatabaseRuntimeUnavailableError };

function envMapForService(serviceId: string) {
  const rows = db.select().from(envVars).where(eq(envVars.serviceId, serviceId)).all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

function databaseContext(serviceId: string): DatabaseContext {
  const service = getServiceById(serviceId);
  if (!service || !isDatabaseService(service)) {
    throw new Error("Database service not found");
  }

  return {
    service,
    dbType: databaseTypeForService(service),
    envMap: envMapForService(service.id),
    containerName: containerNameForService(service.id)
  };
}

function sqlLiteral(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function splitTableId(table: string) {
  const parts = table.split(".").filter(Boolean);
  if (parts.length >= 2) {
    return { schema: parts.slice(0, -1).join("."), name: parts.at(-1) ?? table };
  }
  return { schema: "", name: table };
}

function quotePgIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function quoteMySqlIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

function quoteClickHouseIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

function postgresTableSql(table: string) {
  const { schema, name } = splitTableId(table);
  return schema ? `${quotePgIdentifier(schema)}.${quotePgIdentifier(name)}` : quotePgIdentifier(name);
}

function mysqlTableSql(table: string) {
  const { schema, name } = splitTableId(table);
  return schema ? `${quoteMySqlIdentifier(schema)}.${quoteMySqlIdentifier(name)}` : quoteMySqlIdentifier(name);
}

function clickHouseTableSql(table: string) {
  const { schema, name } = splitTableId(table);
  return schema ? `${quoteClickHouseIdentifier(schema)}.${quoteClickHouseIdentifier(name)}` : quoteClickHouseIdentifier(name);
}

function likePattern(value: string, mode: "contains" | "starts_with" | "ends_with") {
  if (mode === "starts_with") return `${value}%`;
  if (mode === "ends_with") return `%${value}`;
  return `%${value}%`;
}

function comparisonValue(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : sqlLiteral(value);
}

function postgresFilterSql(filter: DatabaseRowFilter) {
  const column = quotePgIdentifier(filter.column);
  const textColumn = `LOWER(CAST(${column} AS TEXT))`;
  const loweredValue = sqlLiteral(filter.value.toLowerCase());

  if (filter.operator === "equals") return `${textColumn} = ${loweredValue}`;
  if (filter.operator === "not_equals") return `(${column} IS NULL OR ${textColumn} <> ${loweredValue})`;
  if (filter.operator === "contains") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "contains"))}`;
  if (filter.operator === "not_contains") return `(${column} IS NULL OR ${textColumn} NOT LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "contains"))})`;
  if (filter.operator === "starts_with") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "starts_with"))}`;
  if (filter.operator === "ends_with") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "ends_with"))}`;
  if (filter.operator === "is_empty") return `(${column} IS NULL OR CAST(${column} AS TEXT) = '')`;
  if (filter.operator === "is_not_empty") return `(${column} IS NOT NULL AND CAST(${column} AS TEXT) <> '')`;
  if (filter.operator === "greater_than") return `${column} > ${comparisonValue(filter.value)}`;
  if (filter.operator === "less_than") return `${column} < ${comparisonValue(filter.value)}`;
  return "TRUE";
}

function mysqlFilterSql(filter: DatabaseRowFilter) {
  const column = quoteMySqlIdentifier(filter.column);
  const textColumn = `LOWER(CAST(${column} AS CHAR))`;
  const loweredValue = sqlLiteral(filter.value.toLowerCase());

  if (filter.operator === "equals") return `${textColumn} = ${loweredValue}`;
  if (filter.operator === "not_equals") return `(${column} IS NULL OR ${textColumn} <> ${loweredValue})`;
  if (filter.operator === "contains") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "contains"))}`;
  if (filter.operator === "not_contains") return `(${column} IS NULL OR ${textColumn} NOT LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "contains"))})`;
  if (filter.operator === "starts_with") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "starts_with"))}`;
  if (filter.operator === "ends_with") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "ends_with"))}`;
  if (filter.operator === "is_empty") return `(${column} IS NULL OR CAST(${column} AS CHAR) = '')`;
  if (filter.operator === "is_not_empty") return `(${column} IS NOT NULL AND CAST(${column} AS CHAR) <> '')`;
  if (filter.operator === "greater_than") return `${column} > ${comparisonValue(filter.value)}`;
  if (filter.operator === "less_than") return `${column} < ${comparisonValue(filter.value)}`;
  return "TRUE";
}

function clickHouseFilterSql(filter: DatabaseRowFilter) {
  const column = quoteClickHouseIdentifier(filter.column);
  const textColumn = `lowerUTF8(toString(${column}))`;
  const loweredValue = sqlLiteral(filter.value.toLowerCase());

  if (filter.operator === "equals") return `${textColumn} = ${loweredValue}`;
  if (filter.operator === "not_equals") return `(isNull(${column}) OR ${textColumn} <> ${loweredValue})`;
  if (filter.operator === "contains") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "contains"))}`;
  if (filter.operator === "not_contains") return `(isNull(${column}) OR ${textColumn} NOT LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "contains"))})`;
  if (filter.operator === "starts_with") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "starts_with"))}`;
  if (filter.operator === "ends_with") return `${textColumn} LIKE ${sqlLiteral(likePattern(filter.value.toLowerCase(), "ends_with"))}`;
  if (filter.operator === "is_empty") return `(isNull(${column}) OR toString(${column}) = '')`;
  if (filter.operator === "is_not_empty") return `(NOT isNull(${column}) AND toString(${column}) <> '')`;
  if (filter.operator === "greater_than") return `${column} > ${comparisonValue(filter.value)}`;
  if (filter.operator === "less_than") return `${column} < ${comparisonValue(filter.value)}`;
  return "1";
}

function whereClause(filters: DatabaseRowFilter[], buildFilterSql: (filter: DatabaseRowFilter) => string) {
  if (filters.length === 0) return "";
  return `WHERE ${filters.map(buildFilterSql).join(" AND ")}`;
}

function isReadQuery(sql: string) {
  const trimmed = sql.trim().replace(/^\/\*[\s\S]*?\*\//, "").trim().toLowerCase();
  return /^(select|with|show|describe|desc|explain)\b/.test(trimmed);
}

function isPostgresRowQuery(sql: string) {
  const trimmed = sql.trim().replace(/^\/\*[\s\S]*?\*\//, "").trim().toLowerCase();
  return /^(select|with)\b/.test(trimmed);
}

function stripTrailingSemicolon(sql: string) {
  return sql.trim().replace(/;+$/, "");
}

async function runPostgres(ctx: DatabaseContext, sql: string) {
  const externalUrl = externalDatabaseUrl(ctx.service.id);
  if (externalUrl) {
    if (sql.trimStart().startsWith("\\")) throw new Error("Enter SQL, not psql client commands.");
    try {
      return (await runDockerExec(ctx.containerName, ["psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], externalPostgresEnvironment(parseExternalPostgresUrl(externalUrl)))).stdout.trim();
    } catch {
      throw new Error("Could not query the existing database. Check the connection and this database user's permissions.");
    }
  }
  const user = ctx.envMap.get("POSTGRES_USER") || "postgres";
  const password = ctx.envMap.get("POSTGRES_PASSWORD") || "";
  const dbName = ctx.envMap.get("POSTGRES_DB") || "aeroplane";
  const result = await runDockerExec(
    ctx.containerName,
    [
      "psql",
      "-h",
      "127.0.0.1",
      "-p",
      String(ctx.service.internalPort),
      "-U",
      user,
      "-d",
      dbName,
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-t",
      "-A",
      "-c",
      sql
    ],
    { PGPASSWORD: password }
  );
  return result.stdout.trim();
}

async function postgresJson<T>(ctx: DatabaseContext, sql: string): Promise<T> {
  const output = await runPostgres(ctx, sql);
  return JSON.parse(output || "[]") as T;
}

async function runMysql(ctx: DatabaseContext, sql: string) {
  const user = ctx.envMap.get("MYSQL_USER") || "mysql";
  const password = ctx.envMap.get("MYSQL_PASSWORD") || "";
  const dbName = ctx.envMap.get("MYSQL_DATABASE") || "aeroplane";
  const result = await runDockerExec(
    ctx.containerName,
    [
      "mysql",
      "-h",
      "127.0.0.1",
      "-P",
      String(ctx.service.internalPort),
      "-u",
      user,
      dbName,
      "--batch",
      "--raw",
      "--execute",
      sql
    ],
    { MYSQL_PWD: password }
  );
  return result.stdout.trim();
}

function parseTsv(output: string) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { columns: [] as string[], rows: [] as RowData[] };

  const columns = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, values[index] === "NULL" ? null : values[index] ?? ""]));
  });
  return { columns, rows };
}

async function runClickHouse(ctx: DatabaseContext, sql: string) {
  const user = ctx.envMap.get("CLICKHOUSE_USER") || "clickhouse";
  const password = ctx.envMap.get("CLICKHOUSE_PASSWORD") || "";
  const result = await runDockerExec(ctx.containerName, ["clickhouse-client", "--user", user, "--password", password, "--query", sql]);
  return result.stdout.trim();
}

function parseJsonEachRow(output: string) {
  const rows = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RowData);
  return rows;
}

function unsupportedResponse(ctx: DatabaseContext) {
  return {
    engine: ctx.dbType,
    supported: false,
    editable: false,
    schemas: [] as DatabaseSchema[],
    tables: [] as DatabaseTable[],
    message: `${ctx.dbType} browsing is not available yet.`
  };
}

function runtimeNoticeResponse(ctx: DatabaseContext, runtimeNotice: DatabaseRuntimeNotice) {
  return {
    engine: ctx.dbType,
    supported: true,
    editable: false,
    schemas: [] as DatabaseSchema[],
    tables: [] as DatabaseTable[],
    message: runtimeNotice.message,
    runtimeState: runtimeNotice.runtimeState,
    serviceStatus: runtimeNotice.serviceStatus,
    deploymentStatus: runtimeNotice.deploymentStatus
  };
}

async function withTableRowCounts(tables: DatabaseTable[], countRows: (tableId: string) => Promise<number>) {
  return Promise.all(tables.map(async (table) => {
    try {
      return { ...table, rowCount: await countRows(table.id) };
    } catch {
      return { ...table, rowCount: null };
    }
  }));
}

export async function getDatabaseTables(serviceId: string, logicalDatabase = 0) {
  const ctx = databaseContext(serviceId);
  const runtimeNotice = databaseRuntimeNoticeForService(ctx.service);
  if (runtimeNotice) return runtimeNoticeResponse(ctx, runtimeNotice);

  try {
    return await getDatabaseTablesForContext(ctx, logicalDatabase);
  } catch (error) {
    const errorNotice = databaseRuntimeNoticeForError(ctx.service, error);
    if (errorNotice) return runtimeNoticeResponse(ctx, errorNotice);
    throw error;
  }
}

async function getDatabaseTablesForContext(ctx: DatabaseContext, logicalDatabase = 0) {
  if (ctx.dbType === "redis") return getRedisTables(ctx, logicalDatabase);
  if (isMongoDatabase(ctx.dbType)) return getMongoTables(ctx);
  if (!isRelationalDatabase(ctx.dbType)) return unsupportedResponse(ctx);

  if (isPostgresFamilyDatabase(ctx.dbType)) {
    const timescaleSchemaFilter = ctx.dbType === "timescale" ? "AND table_schema !~ '^_timescaledb_'" : "";
    const timescaleSchemaNameFilter = ctx.dbType === "timescale" ? "AND schema_name !~ '^_timescaledb_'" : "";
    const schemas = await postgresJson<DatabaseSchema[]>(ctx, `
      SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT schema_name AS name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
          AND schema_name !~ '^pg_'
          ${timescaleSchemaNameFilter}
        ORDER BY schema_name
      ) s
    `);
    const tables = await postgresJson<DatabaseTable[]>(ctx, `
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT table_schema AS schema, table_name AS name, table_schema || '.' || table_name AS id
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_schema !~ '^pg_'
          ${timescaleSchemaFilter}
        ORDER BY table_schema, table_name
      ) t
    `);
    const countedTables = await withTableRowCounts(tables, (tableId) => postgresJson<number>(ctx, `SELECT count(*) FROM ${postgresTableSql(tableId)}`));
    return { engine: ctx.dbType, supported: true, editable: true, schemas, tables: countedTables };
  }

  if (ctx.dbType === "mysql") {
    const schemaRows = parseTsv(await runMysql(ctx, "SELECT DATABASE() AS name")).rows;
    const schemas = schemaRows
      .map((row) => ({ name: String(row.name ?? "") }))
      .filter((schema) => schema.name);
    const parsed = parseTsv(await runMysql(ctx, `
      SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, CONCAT(TABLE_SCHEMA, '.', TABLE_NAME) AS id
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `));
    const tables = parsed.rows.map((row) => ({
      id: String(row.id),
      schema: String(row.schema),
      name: String(row.name),
      rowCount: null
    }));
    const countedTables = await withTableRowCounts(tables, async (tableId) => {
      const countParsed = parseTsv(await runMysql(ctx, `SELECT COUNT(*) AS rowCount FROM ${mysqlTableSql(tableId)}`));
      return Number(countParsed.rows[0]?.rowCount ?? 0);
    });
    return { engine: ctx.dbType, supported: true, editable: true, schemas, tables: countedTables };
  }

  const schemaRows = parseJsonEachRow(await runClickHouse(ctx, `
    SELECT name
    FROM system.databases
    WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    ORDER BY name
    FORMAT JSONEachRow
  `));
  const schemas = schemaRows.map((row) => ({ name: String(row.name) }));
  const tableRows = parseJsonEachRow(await runClickHouse(ctx, `
    SELECT database AS schema, name, concat(database, '.', name) AS id
    FROM system.tables
    WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    ORDER BY database, name
    FORMAT JSONEachRow
  `));
  const tables = tableRows.map((row) => ({
    id: String(row.id),
    schema: String(row.schema),
    name: String(row.name),
    rowCount: null
  }));
  const countedTables = await withTableRowCounts(tables, async (tableId) => {
    const countRows = parseJsonEachRow(await runClickHouse(ctx, `
      SELECT count() AS rowCount FROM ${clickHouseTableSql(tableId)}
      FORMAT JSONEachRow
    `));
    return Number(countRows[0]?.rowCount ?? 0);
  });
  return { engine: ctx.dbType, supported: true, editable: false, schemas, tables: countedTables };
}

export async function getDatabaseRows(serviceId: string, table: string, limit: number, offset: number, filters: DatabaseRowFilter[] = []) {
  const ctx = databaseContext(serviceId);
  const runtimeNotice = databaseRuntimeNoticeForService(ctx.service);
  if (runtimeNotice) throw new DatabaseRuntimeUnavailableError(runtimeNotice);

  try {
    return await getDatabaseRowsForContext(ctx, table, limit, offset, filters);
  } catch (error) {
    throw databaseRuntimeErrorForService(ctx.service, error);
  }
}

async function getDatabaseRowsForContext(ctx: DatabaseContext, table: string, limit: number, offset: number, filters: DatabaseRowFilter[] = []) {
  const safeLimit = Math.min(Math.max(limit || 50, 1), 200);
  const safeOffset = Math.max(offset || 0, 0);

  if (ctx.dbType === "redis") return getRedisRows(ctx, table, safeLimit, safeOffset, filters);
  if (isMongoDatabase(ctx.dbType)) return getMongoRows(ctx, table, safeLimit, safeOffset, filters);

  if (isPostgresFamilyDatabase(ctx.dbType)) {
    const { schema, name } = splitTableId(table);
    const columns = await postgresJson<DatabaseColumn[]>(ctx, `
      SELECT COALESCE(json_agg(row_to_json(c)), '[]'::json)
      FROM (
        SELECT
          c.column_name AS name,
          CASE WHEN c.data_type = 'USER-DEFINED' AND c.udt_name IN ('geometry', 'geography') THEN c.udt_name ELSE c.data_type END AS type,
          c.is_nullable = 'YES' AS "nullable",
          EXISTS (
            SELECT 1
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = c.table_schema
              AND tc.table_name = c.table_name
              AND kcu.column_name = c.column_name
          ) AS "primaryKey"
        FROM information_schema.columns c
        WHERE c.table_schema = ${sqlLiteral(schema || "public")}
          AND c.table_name = ${sqlLiteral(name)}
        ORDER BY c.ordinal_position
      ) c
    `);
    const activeFilters = activeFiltersForColumns(filters, columns);
    const filterSql = whereClause(activeFilters, postgresFilterSql);
    // EWKB text preserves dimensions and SRID when a browser edit is submitted.
    const projection = columns.map((column) => {
      const identifier = quotePgIdentifier(column.name);
      return column.type === "geometry" || column.type === "geography" ? `${identifier}::text AS ${identifier}` : identifier;
    }).join(", ");
    const totalRows = await postgresJson<number>(ctx, `
      SELECT count(*) FROM ${postgresTableSql(table)}
      ${filterSql}
    `);
    const rows = await postgresJson<RowData[]>(ctx, `
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT ${projection || "*"} FROM ${postgresTableSql(table)}
        ${filterSql}
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      ) r
    `);
    return { engine: ctx.dbType, editable: true, table, columns, rows, limit: safeLimit, offset: safeOffset, totalRows };
  }

  if (ctx.dbType === "mysql") {
    const { name } = splitTableId(table);
    const columnRows = parseTsv(await runMysql(ctx, `
      SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IF(IS_NULLABLE = 'YES', 'true', 'false') AS nullable, IF(COLUMN_KEY = 'PRI', 'true', 'false') AS primaryKey
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlLiteral(name)}
      ORDER BY ORDINAL_POSITION
    `)).rows;
    const columns = columnRows.map((row) => ({
      name: String(row.name),
      type: String(row.type),
      nullable: row.nullable === "true",
      primaryKey: row.primaryKey === "true"
    }));
    const activeFilters = activeFiltersForColumns(filters, columns);
    const filterSql = whereClause(activeFilters, mysqlFilterSql);
    const countParsed = parseTsv(await runMysql(ctx, `SELECT COUNT(*) AS totalRows FROM ${mysqlTableSql(table)} ${filterSql}`));
    const totalRows = Number(countParsed.rows[0]?.totalRows ?? 0);
    const parsed = parseTsv(await runMysql(ctx, `SELECT * FROM ${mysqlTableSql(table)} ${filterSql} LIMIT ${safeLimit} OFFSET ${safeOffset}`));
    return { engine: ctx.dbType, editable: true, table, columns, rows: parsed.rows, limit: safeLimit, offset: safeOffset, totalRows };
  }

  if (ctx.dbType === "clickhouse") {
    const { schema, name } = splitTableId(table);
    const columnRows = parseJsonEachRow(await runClickHouse(ctx, `
      SELECT name, type, 1 AS nullable, 0 AS primaryKey
      FROM system.columns
      WHERE database = ${sqlLiteral(schema)} AND table = ${sqlLiteral(name)}
      ORDER BY position
      FORMAT JSONEachRow
    `));
    const columns = columnRows.map((row) => ({
      name: String(row.name),
      type: String(row.type),
      nullable: true,
      primaryKey: false
    })) as DatabaseColumn[];
    const activeFilters = activeFiltersForColumns(filters, columns);
    const filterSql = whereClause(activeFilters, clickHouseFilterSql);
    const countRows = parseJsonEachRow(await runClickHouse(ctx, `
      SELECT count() AS totalRows FROM ${clickHouseTableSql(table)}
      ${filterSql}
      FORMAT JSONEachRow
    `));
    const totalRows = Number(countRows[0]?.totalRows ?? 0);
    const rows = parseJsonEachRow(await runClickHouse(ctx, `
      SELECT * FROM ${clickHouseTableSql(table)}
      ${filterSql}
      LIMIT ${safeLimit} OFFSET ${safeOffset}
      FORMAT JSONEachRow
    `));
    return { engine: ctx.dbType, editable: false, table, columns, rows, limit: safeLimit, offset: safeOffset, totalRows };
  }

  throw new Error("Database browsing is not available for this engine");
}

export async function runDatabaseQuery(serviceId: string, sql: string) {
  const ctx = databaseContext(serviceId);
  const trimmed = stripTrailingSemicolon(sql);
  if (!trimmed) throw new Error("SQL is required");

  const startedAt = Date.now();
  if (isPostgresFamilyDatabase(ctx.dbType)) {
    if (isPostgresRowQuery(trimmed)) {
      const rows = await postgresJson<RowData[]>(ctx, `
        SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
        FROM (${trimmed}) q
      `);
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return { engine: ctx.dbType, columns, rows, rowCount: rows.length, elapsedMs: Date.now() - startedAt };
    }
    const message = await runPostgres(ctx, trimmed);
    return { engine: ctx.dbType, columns: [], rows: [], rowCount: 0, message, elapsedMs: Date.now() - startedAt };
  }

  if (ctx.dbType === "mysql") {
    const output = await runMysql(ctx, trimmed);
    const parsed = parseTsv(output);
    return {
      engine: ctx.dbType,
      columns: parsed.columns,
      rows: parsed.rows,
      rowCount: parsed.rows.length,
      message: parsed.rows.length === 0 ? output : undefined,
      elapsedMs: Date.now() - startedAt
    };
  }

  if (ctx.dbType === "clickhouse") {
    if (isReadQuery(trimmed)) {
      const sqlWithFormat = /\bformat\s+\w+$/i.test(trimmed) ? trimmed : `${trimmed} FORMAT JSONEachRow`;
      const rows = parseJsonEachRow(await runClickHouse(ctx, sqlWithFormat));
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return { engine: ctx.dbType, columns, rows, rowCount: rows.length, elapsedMs: Date.now() - startedAt };
    }
    const message = await runClickHouse(ctx, trimmed);
    return { engine: ctx.dbType, columns: [], rows: [], rowCount: 0, message, elapsedMs: Date.now() - startedAt };
  }

  throw new Error("SQL console is not available for this engine");
}

export async function insertDatabaseRow(serviceId: string, table: string, values: RowData) {
  const ctx = databaseContext(serviceId);
  const entries = Object.entries(values).filter(([key]) => key.trim());
  if (entries.length === 0) throw new Error("At least one column value is required");

  if (ctx.dbType === "redis") return insertRedisRow(ctx, table, values);
  if (isMongoDatabase(ctx.dbType)) return insertMongoRow(ctx, table, values);

  if (isPostgresFamilyDatabase(ctx.dbType)) {
    await runPostgres(
      ctx,
      `INSERT INTO ${postgresTableSql(table)} (${entries.map(([key]) => quotePgIdentifier(key)).join(", ")}) VALUES (${entries.map(([, value]) => sqlLiteral(value)).join(", ")})`
    );
    return { ok: true };
  }

  if (ctx.dbType === "mysql") {
    await runMysql(
      ctx,
      `INSERT INTO ${mysqlTableSql(table)} (${entries.map(([key]) => quoteMySqlIdentifier(key)).join(", ")}) VALUES (${entries.map(([, value]) => sqlLiteral(value)).join(", ")})`
    );
    return { ok: true };
  }

  throw new Error("Row editing is not available for this engine");
}

export async function updateDatabaseRow(serviceId: string, table: string, primaryKey: RowData, values: RowData) {
  const ctx = databaseContext(serviceId);
  const assignments = Object.entries(values).filter(([key]) => key.trim());
  const where = Object.entries(primaryKey).filter(([key]) => key.trim());
  if (assignments.length === 0) throw new Error("No changes to save");
  if (where.length === 0) throw new Error("A primary key is required to update rows");
  if (ctx.dbType === "redis") return updateRedisRow(ctx, table, primaryKey, values);
  if (isMongoDatabase(ctx.dbType)) return updateMongoRow(ctx, table, primaryKey, values);

  if (isPostgresFamilyDatabase(ctx.dbType)) {
    await runPostgres(
      ctx,
      `UPDATE ${postgresTableSql(table)} SET ${assignments.map(([key, value]) => `${quotePgIdentifier(key)} = ${sqlLiteral(value)}`).join(", ")} WHERE ${where.map(([key, value]) => `${quotePgIdentifier(key)} = ${sqlLiteral(value)}`).join(" AND ")}`
    );
    return { ok: true };
  }

  if (ctx.dbType === "mysql") {
    await runMysql(
      ctx,
      `UPDATE ${mysqlTableSql(table)} SET ${assignments.map(([key, value]) => `${quoteMySqlIdentifier(key)} = ${sqlLiteral(value)}`).join(", ")} WHERE ${where.map(([key, value]) => `${quoteMySqlIdentifier(key)} = ${sqlLiteral(value)}`).join(" AND ")}`
    );
    return { ok: true };
  }

  throw new Error("Row editing is not available for this engine");
}

export async function deleteDatabaseRow(serviceId: string, table: string, primaryKey: RowData) {
  const ctx = databaseContext(serviceId);
  if (ctx.dbType === "redis") return deleteRedisRow(ctx, table, primaryKey);

  const where = Object.entries(primaryKey).filter(([key]) => key.trim());
  if (where.length === 0) throw new Error("A primary key is required to delete rows");
  if (isMongoDatabase(ctx.dbType)) return deleteMongoRow(ctx, table, primaryKey);

  if (isPostgresFamilyDatabase(ctx.dbType)) {
    await runPostgres(
      ctx,
      `DELETE FROM ${postgresTableSql(table)} WHERE ${where.map(([key, value]) => `${quotePgIdentifier(key)} = ${sqlLiteral(value)}`).join(" AND ")}`
    );
    return { ok: true };
  }

  if (ctx.dbType === "mysql") {
    await runMysql(
      ctx,
      `DELETE FROM ${mysqlTableSql(table)} WHERE ${where.map(([key, value]) => `${quoteMySqlIdentifier(key)} = ${sqlLiteral(value)}`).join(" AND ")}`
    );
    return { ok: true };
  }

  throw new Error("Row editing is not available for this engine");
}

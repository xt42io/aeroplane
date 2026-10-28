import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { isPostgresFamilyDatabase } from "./database-engine.js";
import { assertManagedDatabase } from "./database-connections.js";
import { assertPostgisImportCompatible, postgisExtensions, skipPostgisExtensionEntry } from "./postgis-import.js";
import { importedTimescaleSourceImageForService } from "./database-source-image.js";
import { databaseTypeForService, isDatabaseService } from "./database-urls.js";
import { databaseDataVolumeName } from "./database-runtime.js";
import { runDockerExec } from "./database-viewer-shared.js";
import { containerNameForService, getServiceById } from "./deploy.js";
import { db } from "./db.js";
import { getRailwayServiceVariables } from "./railway-importer.js";
import { getRailwayImportSource, mergeRailwayImportSourceMetadata } from "./service-import-sources.js";
import { envVars, type Service } from "./schema.js";

const postgresDumpImage = "postgres:18-alpine";

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type PostgresDataImportResult = {
  ok: true;
  serviceId: string;
  source: "postgres-url" | "railway";
  sourceLabel: string;
  sourceVariableKey?: string;
  dumpSizeBytes: number;
  checksum: string;
  importedAt: string;
};

type PostgresUrlCandidate = {
  key: string;
  value: string;
  internal: boolean;
};

type PostgresDumpOptions = {
  excludeTimescaleBackgroundJobs?: boolean;
  sourceInfo?: PostgresSourceInfo;
};

type PostgresSourceInfo = {
  major: number | null;
  timescaleVersion: string | null;
  postgis: Record<string, string>;
};

type PostgresTargetContext = {
  containerName: string;
  dbName: string;
  dbType: string;
  envMap: Map<string, string>;
  password: string;
  user: string;
};

function runDocker(args: string[]) {
  return new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || "Docker command failed").trim()));
      }
    });
  });
}

function envMapForService(serviceId: string) {
  const rows = db.select().from(envVars).where(eq(envVars.serviceId, serviceId)).all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

function postgresService(serviceId: string) {
  assertManagedDatabase(serviceId);
  const service = getServiceById(serviceId);
  if (!service || !isDatabaseService(service)) {
    throw new Error("Database service not found");
  }

  const dbType = databaseTypeForService(service);
  if (!isPostgresFamilyDatabase(dbType)) {
    throw new Error("Postgres data import is only available for Postgres-compatible services.");
  }

  return service;
}

function parsePostgresUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Use a valid Postgres connection URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Use a postgres:// or postgresql:// connection URL.");
  }
  return parsed;
}

function isRailwayInternalHost(hostname: string) {
  return hostname.endsWith(".railway.internal");
}

function assertReachableSourceUrl(sourceUrl: string) {
  const parsed = parsePostgresUrl(sourceUrl);
  if (isRailwayInternalHost(parsed.hostname)) {
    throw new Error("Railway internal Postgres URLs are only reachable from inside Railway. Use a public Postgres URL instead.");
  }
}

function fileSha256(localPath: string) {
  return createHash("sha256").update(readFileSync(localPath)).digest("hex");
}

function postgresMajorVersion(versionNum: string) {
  const parsed = Number(versionNum.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed / 10000);
}

function redactUrl(message: string, sourceUrl: string) {
  const parsed = new URL(sourceUrl);
  const redacted = new URL(sourceUrl);
  if (redacted.password) redacted.password = "REDACTED";
  let nextMessage = message.replaceAll(sourceUrl, redacted.toString());
  if (parsed.password) {
    nextMessage = nextMessage.replaceAll(decodeURIComponent(parsed.password), "REDACTED");
  }
  return nextMessage;
}

function timescaleBackgroundJobExcludes() {
  return [
    "--exclude-table-data=_timescaledb_catalog.bgw_job",
    "--exclude-table-data=_timescaledb_config.bgw_job",
    "--exclude-table-data=_timescaledb_cache.bgw_job"
  ].join(" ");
}

async function readSourcePostgresInfo(sourceUrl: string): Promise<PostgresSourceInfo> {
  try {
    const result = await runDocker([
      "run",
      "--rm",
      "--network",
      "host",
      "--env",
      `SOURCE_DATABASE_URL=${sourceUrl}`,
      postgresDumpImage,
      "sh",
      "-lc",
      "psql -X --dbname=\"$SOURCE_DATABASE_URL\" --tuples-only --no-align --command=\"SELECT current_setting('server_version_num') || '|' || coalesce((SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'), '') || '|' || coalesce((SELECT json_object_agg(extname, extversion)::text FROM pg_extension WHERE extname IN ('postgis','postgis_topology','postgis_raster','postgis_sfcgal','postgis_tiger_geocoder')), '{}')\""
    ]);
    const [versionNum = "", timescaleVersion = "", postgis = "{}"] = result.stdout.trim().split("|");
    return {
      major: postgresMajorVersion(versionNum),
      timescaleVersion: timescaleVersion.trim() || null,
      postgis: JSON.parse(postgis)
    };
  } catch {
    return { major: null, timescaleVersion: null, postgis: {} };
  }
}

async function dumpPostgresUrl(sourceUrl: string, options: PostgresDumpOptions = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "aeroplane-postgres-import-"));
  const dumpPath = join(tempDir, "source.dump");
  const containerName = `aeroplane-pg-dump-${nanoid(10)}`;
  const remotePath = "/tmp/source.dump";
  await runDocker(["pull", postgresDumpImage]);
  const sourceInfo = options.sourceInfo ?? await readSourcePostgresInfo(sourceUrl);
  const timescaleExcludes = options.excludeTimescaleBackgroundJobs ? ` ${timescaleBackgroundJobExcludes()}` : "";

  try {
    await runDocker(["rm", "-f", containerName]).catch(() => undefined);
    await runDocker([
      "run",
      "--name",
      containerName,
      "--network",
      "host",
      "--env",
      `SOURCE_DATABASE_URL=${sourceUrl}`,
      postgresDumpImage,
      "sh",
      "-lc",
      `set -eu; pg_dump --dbname="$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --no-tablespaces${timescaleExcludes} --file=${remotePath}; test -s ${remotePath}`
    ]);
    await runDocker(["cp", `${containerName}:${remotePath}`, dumpPath]);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    const message = error instanceof Error ? redactUrl(error.message, sourceUrl) : "Could not dump source Postgres database";
    throw new Error(message);
  } finally {
    await runDocker(["rm", "-f", containerName]).catch(() => undefined);
  }

  if (!existsSync(dumpPath) || statSync(dumpPath).size === 0) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error("Postgres dump was not created or was empty.");
  }

  return { tempDir, dumpPath, sourceInfo };
}

async function readTargetPostgresMajor(service: Service, envMap: Map<string, string>, containerName: string) {
  const user = envMap.get("POSTGRES_USER") || "postgres";
  const password = envMap.get("POSTGRES_PASSWORD") || "";
  const dbName = envMap.get("POSTGRES_DB") || "aeroplane";
  const result = await runDockerExec(
    containerName,
    [
      "psql",
      "-X",
      "-h",
      "127.0.0.1",
      "-p",
      String(service.internalPort),
      "-U",
      user,
      "-d",
      dbName,
      "--tuples-only",
      "--no-align",
      "--command=SHOW server_version_num"
    ],
    { PGPASSWORD: password }
  );
  return postgresMajorVersion(result.stdout);
}

async function waitForTargetPostgres(service: Service, containerName: string, user: string) {
  try {
    await runDockerExec(containerName, ["pg_isready", "-h", "127.0.0.1", "-p", String(service.internalPort), "-U", user]);
  } catch {
    throw new Error("Deploy this Postgres service before importing data.");
  }
}

function targetPostgresContext(service: Service, dbType: string): PostgresTargetContext {
  const envMap = envMapForService(service.id);
  const containerName = containerNameForService(service.id);
  const user = envMap.get("POSTGRES_USER") || "postgres";
  const password = envMap.get("POSTGRES_PASSWORD") || "";
  const dbName = envMap.get("POSTGRES_DB") || "aeroplane";
  return { containerName, dbName, dbType, envMap, password, user };
}

async function runTargetPostgresSql(service: Service, ctx: PostgresTargetContext, sql: string) {
  await runDockerExec(
    ctx.containerName,
    [
      "psql",
      "-X",
      "-h",
      "127.0.0.1",
      "-p",
      String(service.internalPort),
      "-U",
      ctx.user,
      "-d",
      ctx.dbName,
      "-v",
      "ON_ERROR_STOP=1",
      "--command",
      sql
    ],
    { PGPASSWORD: ctx.password }
  );
}

async function readTargetPostgresScalar(service: Service, ctx: PostgresTargetContext, sql: string) {
  const result = await runDockerExec(
    ctx.containerName,
    [
      "psql",
      "-X",
      "-h",
      "127.0.0.1",
      "-p",
      String(service.internalPort),
      "-U",
      ctx.user,
      "-d",
      ctx.dbName,
      "--tuples-only",
      "--no-align",
      "--command",
      sql
    ],
    { PGPASSWORD: ctx.password }
  );
  return result.stdout.trim();
}

async function readTargetTimescaleVersion(service: Service, ctx: PostgresTargetContext) {
  const version = await readTargetPostgresScalar(service, ctx, "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';").catch(() => "");
  return version.trim() || null;
}

function recommendedTimescaleImage(sourceInfo: PostgresSourceInfo, service: Service) {
  if (sourceInfo.timescaleVersion && sourceInfo.major) {
    return `timescale/timescaledb:${sourceInfo.timescaleVersion}-pg${sourceInfo.major}`;
  }
  return importedTimescaleSourceImageForService(service);
}

function persistTimescaleSourceImage(service: Service, dbType: string, sourceInfo: PostgresSourceInfo) {
  if (dbType !== "timescale" || !sourceInfo.timescaleVersion || !sourceInfo.major) return null;

  const sourceImage = recommendedTimescaleImage(sourceInfo, service);
  if (!sourceImage) return null;

  mergeRailwayImportSourceMetadata(service.id, {
    sourceImage,
    sourcePostgresMajor: sourceInfo.major,
    sourceTimescaleVersion: sourceInfo.timescaleVersion
  });
  return sourceImage;
}

function assertTimescaleRestoreCompatible(service: Service, sourceInfo: PostgresSourceInfo, targetTimescaleVersion: string | null) {
  if (!sourceInfo.timescaleVersion || !targetTimescaleVersion || sourceInfo.timescaleVersion === targetTimescaleVersion) {
    return;
  }

  const image = recommendedTimescaleImage(sourceInfo, service);
  const containerName = containerNameForService(service.id);
  const volumeName = databaseDataVolumeName(service.id);
  const imageHint = image
    ? ` The service is pinned to ${image}, but the running target still has the old extension loaded.`
    : " Recreate the target with the same TimescaleDB extension version as the source before retrying.";

  throw new Error(
    `TimescaleDB extension versions differ (source ${sourceInfo.timescaleVersion}, target ${targetTimescaleVersion}). Timescale logical imports require the target extension version to match the source before restore.${imageHint} Reset this local target with: docker rm -f ${containerName}; docker volume rm ${volumeName}; then redeploy this Timescale service and retry the import.`
  );
}

function shouldSkipTimescaleRestoreListEntry(line: string) {
  const normalized = line.replace(/\s+/g, " ").trim();
  const timescaleBackgroundJobEntry = /\b_timescaledb_(catalog|config|cache)\b.*\bbgw_job\b/.test(normalized);
  return (
    /\bEXTENSION - timescaledb\b/.test(normalized) ||
    /\bCOMMENT - EXTENSION timescaledb\b/.test(normalized) ||
    (/\bTABLE DATA\b/.test(normalized) && timescaleBackgroundJobEntry) ||
    (/\bSEQUENCE SET\b/.test(normalized) && /\bbgw_job_id_seq\b/.test(normalized))
  );
}

async function createTimescaleRestoreList(containerName: string, remoteDumpPath: string) {
  const list = await runDockerExec(containerName, ["pg_restore", "-l", remoteDumpPath]);
  const filteredList = list.stdout
    .split(/\r?\n/)
    .filter((line) => !shouldSkipTimescaleRestoreListEntry(line))
    .join("\n");
  const localListPath = join(tmpdir(), `aeroplane-timescale-restore-${nanoid(10)}.list`);
  const remoteListPath = `/tmp/aeroplane-timescale-restore-${nanoid(10)}.list`;

  try {
    writeFileSync(localListPath, `${filteredList}\n`);
    await runDocker(["cp", localListPath, `${containerName}:${remoteListPath}`]);
    return remoteListPath;
  } finally {
    rmSync(localListPath, { force: true });
  }
}

async function createPostgisRestoreList(containerName: string, remoteDumpPath: string) {
  const result = await runDockerExec(containerName, ["pg_restore", "--list", remoteDumpPath]);
  const list = result.stdout.split("\n").filter((line) => !skipPostgisExtensionEntry(line)).join("\n");
  const localPath = join(tmpdir(), `aeroplane-postgis-restore-${nanoid(10)}.list`);
  const remotePath = `/tmp/aeroplane-postgis-restore-${nanoid(10)}.list`;
  try {
    writeFileSync(localPath, list);
    await runDocker(["cp", localPath, `${containerName}:${remotePath}`]);
    return remotePath;
  } finally {
    rmSync(localPath, { force: true });
  }
}

async function assertTargetPostgresImportCompatible(service: Service, dbType: string, sourceInfo: PostgresSourceInfo) {
  const ctx = targetPostgresContext(service, dbType);
  await waitForTargetPostgres(service, ctx.containerName, ctx.user);

  const targetMajor = await readTargetPostgresMajor(service, ctx.envMap, ctx.containerName).catch(() => null);
  if (sourceInfo.major && targetMajor && targetMajor < sourceInfo.major) {
    throw new Error(`Target Postgres ${targetMajor} is older than source Postgres ${sourceInfo.major}. Redeploy this Aeroplane Postgres service with the current image, then run the import again.`);
  }

  if (Object.keys(sourceInfo.postgis).length) {
    const names = postgisExtensions.map((name) => `'${name}'`).join(", ");
    const versions = await readTargetPostgresScalar(service, ctx, `SELECT coalesce(json_object_agg(name, default_version), '{}'::json) FROM pg_available_extensions WHERE name IN (${names});`);
    assertPostgisImportCompatible(sourceInfo.postgis, JSON.parse(versions));
    for (const name of postgisExtensions) {
      if (sourceInfo.postgis[name]) await runTargetPostgresSql(service, ctx, `CREATE EXTENSION IF NOT EXISTS "${name}";`);
    }
  }

  if (dbType === "timescale") {
    await runTargetPostgresSql(service, ctx, "CREATE EXTENSION IF NOT EXISTS timescaledb;");
    const targetTimescaleVersion = await readTargetTimescaleVersion(service, ctx);
    assertTimescaleRestoreCompatible(service, sourceInfo, targetTimescaleVersion);
  }
}

async function restorePostgresDump(service: Service, dbType: string, dumpPath: string, sourceInfo: PostgresSourceInfo) {
  const ctx = targetPostgresContext(service, dbType);
  const remotePath = `/tmp/aeroplane-data-import-${nanoid(10)}-${basename(dumpPath)}`;
  const timescaleTarget = dbType === "timescale";
  const postgisSource = Object.keys(sourceInfo.postgis).length > 0;
  let remoteListPath: string | null = null;
  let timescaleRestorePrepared = false;
  let restoreError: unknown = null;

  await waitForTargetPostgres(service, ctx.containerName, ctx.user);
  const targetMajor = await readTargetPostgresMajor(service, ctx.envMap, ctx.containerName).catch(() => null);
  if (sourceInfo.major && targetMajor && targetMajor < sourceInfo.major) {
    throw new Error(`Target Postgres ${targetMajor} is older than source Postgres ${sourceInfo.major}. Redeploy this Aeroplane Postgres service with the current image, then run the import again.`);
  }

  if (timescaleTarget) {
    await runTargetPostgresSql(service, ctx, "CREATE EXTENSION IF NOT EXISTS timescaledb;");
    const targetTimescaleVersion = await readTargetTimescaleVersion(service, ctx);
    assertTimescaleRestoreCompatible(service, sourceInfo, targetTimescaleVersion);
    await runTargetPostgresSql(service, ctx, "SELECT timescaledb_pre_restore();");
    timescaleRestorePrepared = true;
  }

  await runDocker(["cp", dumpPath, `${ctx.containerName}:${remotePath}`]);
  try {
    remoteListPath = timescaleTarget ? await createTimescaleRestoreList(ctx.containerName, remotePath) : postgisSource ? await createPostgisRestoreList(ctx.containerName, remotePath) : null;
    const restoreListArgs = remoteListPath ? [`--use-list=${remoteListPath}`] : [];
    const cleanArgs = timescaleTarget ? [] : ["--clean", "--if-exists"];
    await runDockerExec(
      ctx.containerName,
      [
        "pg_restore",
        "-h",
        "127.0.0.1",
        "-p",
        String(service.internalPort),
        "-U",
        ctx.user,
        "-d",
        ctx.dbName,
        ...cleanArgs,
        "--no-owner",
        "--no-acl",
        "--no-tablespaces",
        ...restoreListArgs,
        remotePath
      ],
      { PGPASSWORD: ctx.password }
    );
  } catch (error) {
    restoreError = error;
  } finally {
    if (timescaleRestorePrepared) {
      try {
        await runTargetPostgresSql(service, ctx, "SELECT timescaledb_post_restore();");
      } catch (error) {
        restoreError ??= error;
      }
    }
    if (remoteListPath) {
      await runDockerExec(ctx.containerName, ["rm", "-f", remoteListPath]).catch(() => undefined);
    }
    await runDockerExec(ctx.containerName, ["rm", "-f", remotePath]).catch(() => undefined);
  }

  if (restoreError) {
    throw restoreError instanceof Error ? restoreError : new Error(String(restoreError));
  }
}

async function importPostgresDumpedUrl(serviceId: string, sourceUrl: string, source: "postgres-url" | "railway", sourceLabel: string, sourceVariableKey?: string) {
  assertReachableSourceUrl(sourceUrl);
  const service = postgresService(serviceId);
  const dbType = databaseTypeForService(service);
  const sourceInfo = await readSourcePostgresInfo(sourceUrl);
  persistTimescaleSourceImage(service, dbType, sourceInfo);
  await assertTargetPostgresImportCompatible(service, dbType, sourceInfo);
  const { tempDir, dumpPath } = await dumpPostgresUrl(sourceUrl, {
    excludeTimescaleBackgroundJobs: dbType === "timescale",
    sourceInfo
  });

  try {
    const stats = statSync(dumpPath);
    const checksum = fileSha256(dumpPath);
    await restorePostgresDump(service, dbType, dumpPath, sourceInfo);
    return {
      ok: true,
      serviceId,
      source,
      sourceLabel,
      sourceVariableKey,
      dumpSizeBytes: stats.size,
      checksum,
      importedAt: new Date().toISOString()
    } satisfies PostgresDataImportResult;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function preparePostgresDataImportFromRailway(serviceId: string, token: string) {
  const service = postgresService(serviceId);
  const dbType = databaseTypeForService(service);
  if (dbType !== "timescale") return null;

  const source = getRailwayImportSource(serviceId);
  if (!source?.externalProjectId || !source.externalEnvironmentId) return null;

  const variables = await getRailwayServiceVariables(token, source.externalProjectId, source.externalEnvironmentId, source.externalServiceId);
  const candidate = findRailwayPostgresUrl(variables);
  if (candidate.internal) return null;

  const sourceInfo = await readSourcePostgresInfo(candidate.value);
  return persistTimescaleSourceImage(service, dbType, sourceInfo);
}

function postgresUrlCandidate(key: string, value: unknown): PostgresUrlCandidate | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  return {
    key,
    value: trimmed,
    internal: isRailwayInternalHost(parsed.hostname)
  };
}

function publicUrlFromPgParts(variables: Record<string, string>) {
  const host = variables.PGHOST?.trim();
  const database = variables.PGDATABASE?.trim();
  const user = variables.PGUSER?.trim();
  const password = variables.PGPASSWORD ?? "";
  if (!host || !database || !user || isRailwayInternalHost(host)) return null;

  const port = variables.PGPORT?.trim() || "5432";
  const url = new URL(`postgresql://${host}:${port}/${database}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

export function findRailwayPostgresUrl(variables: Record<string, string>) {
  const preferredKeys = [
    "POSTGRES_PUBLIC_URL",
    "DATABASE_PUBLIC_URL",
    "POSTGRES_URL",
    "DATABASE_URL",
    "POSTGRES_PRIVATE_URL",
    "DATABASE_PRIVATE_URL"
  ];
  const candidates = preferredKeys
    .map((key) => postgresUrlCandidate(key, variables[key]))
    .filter((candidate): candidate is PostgresUrlCandidate => Boolean(candidate));
  const publicCandidate = candidates.find((candidate) => !candidate.internal);
  if (publicCandidate) return publicCandidate;

  const pgPartsUrl = publicUrlFromPgParts(variables);
  if (pgPartsUrl) return { key: "PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD", value: pgPartsUrl, internal: false };

  if (candidates.length > 0) {
    throw new Error("Railway only returned an internal Postgres URL. Enable public networking for the Railway database or use the Postgres URL option.");
  }

  throw new Error("Could not find a Postgres connection URL in the Railway service variables.");
}

export async function importPostgresDataFromUrl(serviceId: string, sourceUrl: string) {
  return importPostgresDumpedUrl(serviceId, sourceUrl, "postgres-url", "Postgres URL");
}

export async function importPostgresDataFromRailway(serviceId: string, token: string) {
  const source = getRailwayImportSource(serviceId);
  if (!source) {
    throw new Error("This service does not have a saved Railway import source.");
  }
  if (!source.externalProjectId || !source.externalEnvironmentId) {
    throw new Error("This service is missing Railway project or environment metadata.");
  }

  const variables = await getRailwayServiceVariables(token, source.externalProjectId, source.externalEnvironmentId, source.externalServiceId);
  const candidate = findRailwayPostgresUrl(variables);
  return importPostgresDumpedUrl(
    serviceId,
    candidate.value,
    "railway",
    source.externalServiceName ?? "Railway Postgres",
    candidate.key
  );
}

import { asc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { isExternalDatabase } from "./database-connections.js";
import { createDatabaseBackup } from "./database-backups.js";
import { databaseTypeForService, isDatabaseService } from "./database-urls.js";
import { db, nowIso, sqlite } from "./db.js";
import { managedEnvPath, writeManagedEnv } from "./env-file.js";
import { decryptMigrationArchive, encryptMigrationArchive } from "./migration-crypto.js";
import { restoreDatabaseDump, type MigrationDatabaseDump } from "./database-restore.js";
import { writeAndReloadCaddy } from "./caddy.js";
import { getSystemSettings, saveSystemSettings, type SystemSettings } from "./system-settings.js";
import { services, users } from "./schema.js";

const logicalTables = [
  "project_groups",
  "projects",
  "database_connections",
  "deployments",
  "deployment_logs",
  "env_vars",
  "domains",
  "database_backups",
  "database_backup_settings",
  "service_import_sources",
  "service_functions",
  "users"
] as const;

const deleteOrder = [
  "auth_sessions",
  "database_connections",
  "deployment_logs",
  "database_backups",
  "database_backup_settings",
  "service_import_sources",
  "service_functions",
  "domains",
  "env_vars",
  "deployments",
  "projects",
  "project_groups",
  "users"
] as const;

type LogicalTableName = (typeof logicalTables)[number];
type LogicalData = Record<LogicalTableName, Array<Record<string, unknown>>>;

export type MigrationImportResult = {
  importedAt: string;
  projects: number;
  services: number;
  users: number;
  restoredDatabases: number;
  databaseDumps: MigrationDatabaseDump[];
};

type MigrationManifest = {
  format: "aeroplane-migration";
  version: 1;
  createdAt: string;
  source: {
    dataDir: string;
    publicUrl: string;
    controlPlaneHostname: string;
    aeroplaneVersion: string;
  };
  databaseDumps: MigrationDatabaseDump[];
  files: {
    staticSites: boolean;
    backups: boolean;
    postgresTls: boolean;
    caddyfile: boolean;
  };
};

function currentDataDir() {
  return resolve(process.env.DATA_DIR ?? config.dataDir);
}

function currentRuntimeEnv() {
  return {
    AEROPLANE_SECRET_KEY: process.env.AEROPLANE_SECRET_KEY ?? config.secretKey,
    DATA_DIR: process.env.DATA_DIR ?? config.dataDir,
    DEPLOY_DRY_RUN: process.env.DEPLOY_DRY_RUN ?? String(config.deployDryRun),
    CADDY_CONFIG_PATH: process.env.CADDY_CONFIG_PATH ?? config.caddyConfigPath,
    CADDY_DATA_DIR: process.env.CADDY_DATA_DIR ?? config.caddyDataDir,
    CADDY_RELOAD_CMD: process.env.CADDY_RELOAD_CMD ?? config.caddyReloadCmd,
    PORT: process.env.PORT ?? String(config.port),
    HOST: process.env.HOST ?? config.host,
    PUBLIC_URL: process.env.PUBLIC_URL ?? config.publicUrl,
    CONTROL_PLANE_HOSTNAME: process.env.CONTROL_PLANE_HOSTNAME ?? config.controlPlaneHostname,
    BUILDKIT_HOST: process.env.BUILDKIT_HOST ?? config.buildkitHost,
    AEROPLANE_RUNTIME_NETWORK: process.env.AEROPLANE_RUNTIME_NETWORK ?? config.runtimeNetworkName,
    GITHUB_ACCESS_TOKEN: process.env.GITHUB_ACCESS_TOKEN ?? config.githubAccessToken,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? config.githubAppId,
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID ?? config.githubAppClientId,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG ?? config.githubAppSlug,
    GITHUB_APP_PRIVATE_KEY: (process.env.GITHUB_APP_PRIVATE_KEY ?? config.githubAppPrivateKey).replace(/\n/g, "\\n"),
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? config.githubWebhookSecret
  };
}

function runCommand(command: string, args: string[], cwd?: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
        resolvePromise();
      } else {
        reject(new Error((stderr || stdout || `${command} failed`).trim()));
      }
    });
  });
}

function readLogicalData(): LogicalData {
  return Object.fromEntries(
    logicalTables.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>])
  ) as LogicalData;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function insertRows(table: LogicalTableName, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) return;

  const columnSql = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insert = sqlite.prepare(`INSERT INTO ${table} (${columnSql}) VALUES (${placeholders})`);
  for (const row of rows) {
    insert.run(...columns.map((column) => row[column] ?? null));
  }
}

function remapBackupPaths(rows: Array<Record<string, unknown>>, sourceDataDir: string, targetDataDir: string) {
  const sourcePrefix = resolve(sourceDataDir);
  const targetPrefix = resolve(targetDataDir);
  return rows.map((row) => {
    const localPath = typeof row.local_path === "string" ? row.local_path : "";
    if (!localPath || !localPath.startsWith(sourcePrefix)) return row;
    return { ...row, local_path: join(targetPrefix, localPath.slice(sourcePrefix.length)) };
  });
}

function replaceLogicalData(data: LogicalData, sourceDataDir: string, options: { includeUsers?: boolean } = {}) {
  const targetDataDir = currentDataDir();
  const transaction = sqlite.transaction(() => {
    for (const table of deleteOrder) {
      sqlite.prepare(`DELETE FROM ${table}`).run();
    }
    for (const table of logicalTables) {
      if (table === "users" && options.includeUsers === false) continue;
      const rows = table === "database_backups" ? remapBackupPaths(data[table], sourceDataDir, targetDataDir) : data[table];
      insertRows(table, rows ?? []);
    }
  });
  transaction();
}

function restoreUsers(rows: Array<Record<string, unknown>>) {
  const transaction = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM users").run();
    insertRows("users", rows);
  });
  transaction();
}

function backfillImportedProjectOwners() {
  const owner = sqlite.prepare("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  const firstUser = sqlite.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  const fallbackUser = owner ?? firstUser;
  if (!fallbackUser?.id) return;
  sqlite
    .prepare("UPDATE project_groups SET owner_user_id = ? WHERE owner_user_id IS NULL OR owner_user_id = ''")
    .run(fallbackUser.id);
}

async function fileChecksum(localPath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(localPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function copyOptionalDir(source: string, target: string) {
  if (!existsSync(source)) return false;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return true;
}

function copyOptionalFile(source: string, target: string) {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return true;
}

async function createDatabaseDumps(payloadDir: string) {
  const dumpsDir = join(payloadDir, "database-dumps");
  const databaseServices = db.select().from(services).orderBy(asc(services.name)).all().filter((service) => isDatabaseService(service) && !isExternalDatabase(service.id));
  const dumps: MigrationDatabaseDump[] = [];

  for (const service of databaseServices) {
    const backup = await createDatabaseBackup(service.id, "disk");
    if (!backup.localPath || !existsSync(backup.localPath)) {
      throw new Error(`Could not create a backup for ${service.name}`);
    }

    const engine = databaseTypeForService(service);
    const serviceDumpDir = join(dumpsDir, service.id);
    const fileName = basename(backup.localPath);
    const bundlePath = join("database-dumps", service.id, fileName);
    mkdirSync(serviceDumpDir, { recursive: true });
    copyFileSync(backup.localPath, join(serviceDumpDir, fileName));
    dumps.push({
      serviceId: service.id,
      engine,
      format: backup.format,
      path: bundlePath,
      sizeBytes: backup.sizeBytes ?? statSync(backup.localPath).size,
      checksum: backup.checksum ?? await fileChecksum(backup.localPath)
    });
  }

  return dumps;
}

async function writePayload(payloadDir: string) {
  mkdirSync(payloadDir, { recursive: true });
  const dataDir = currentDataDir();
  const systemSettings = getSystemSettings();
  const databaseDumps = await createDatabaseDumps(payloadDir);
  const filesDir = join(payloadDir, "files");
  const caddyConfigPath = resolve(process.env.CADDY_CONFIG_PATH ?? config.caddyConfigPath);
  const files = {
    staticSites: copyOptionalDir(join(dataDir, "static-sites"), join(filesDir, "static-sites")),
    backups: copyOptionalDir(join(dataDir, "backups"), join(filesDir, "backups")),
    postgresTls: copyOptionalDir(join(dataDir, "postgres-tls"), join(filesDir, "postgres-tls")),
    caddyfile: copyOptionalFile(caddyConfigPath, join(filesDir, "Caddyfile"))
  };

  const manifest: MigrationManifest = {
    format: "aeroplane-migration",
    version: 1,
    createdAt: nowIso(),
    source: {
      dataDir,
      publicUrl: process.env.PUBLIC_URL ?? config.publicUrl,
      controlPlaneHostname: systemSettings.controlPlaneHostname,
      aeroplaneVersion: process.env.npm_package_version ?? "unknown"
    },
    databaseDumps,
    files
  };

  await writeFile(join(payloadDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(payloadDir, "runtime-env.json"), `${JSON.stringify(currentRuntimeEnv(), null, 2)}\n`, "utf8");
  await writeFile(join(payloadDir, "system-settings.json"), `${JSON.stringify(systemSettings, null, 2)}\n`, "utf8");
  await writeFile(join(payloadDir, "logical-data.json"), `${JSON.stringify(readLogicalData(), null, 2)}\n`, "utf8");
}

async function createTarGz(sourceDir: string, targetPath: string) {
  await runCommand("tar", ["-czf", targetPath, "-C", sourceDir, "."], sourceDir);
}

async function extractTarGz(sourcePath: string, targetDir: string) {
  mkdirSync(targetDir, { recursive: true });
  await runCommand("tar", ["-xzf", sourcePath, "-C", targetDir]);
}

function readJsonFile<T>(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function importedRuntimeEnv(bundleEnv: Record<string, string>): Record<string, string> {
  const current = currentRuntimeEnv();
  return {
    ...bundleEnv,
    DATA_DIR: current.DATA_DIR,
    CADDY_CONFIG_PATH: current.CADDY_CONFIG_PATH,
    CADDY_DATA_DIR: current.CADDY_DATA_DIR,
    CADDY_RELOAD_CMD: current.CADDY_RELOAD_CMD,
    PORT: current.PORT,
    HOST: current.HOST,
    PUBLIC_URL: current.PUBLIC_URL,
    BUILDKIT_HOST: current.BUILDKIT_HOST,
    AEROPLANE_RUNTIME_NETWORK: current.AEROPLANE_RUNTIME_NETWORK
  };
}

function restorePayloadFiles(payloadDir: string) {
  const filesDir = join(payloadDir, "files");
  const dataDir = currentDataDir();
  copyOptionalDir(join(filesDir, "static-sites"), join(dataDir, "static-sites"));
  copyOptionalDir(join(filesDir, "backups"), join(dataDir, "backups"));
  copyOptionalDir(join(filesDir, "postgres-tls"), join(dataDir, "postgres-tls"));

  const importedCaddyfile = join(filesDir, "Caddyfile");
  const caddyConfigPath = resolve(process.env.CADDY_CONFIG_PATH ?? config.caddyConfigPath);
  if (existsSync(importedCaddyfile)) {
    copyOptionalFile(importedCaddyfile, caddyConfigPath);
  }
}

async function restoreDatabaseDumps(payloadDir: string, dumps: MigrationDatabaseDump[]) {
  for (const dump of dumps) {
    const localPath = join(payloadDir, dump.path);
    if (!existsSync(localPath)) {
      throw new Error(`Database dump is missing: ${dump.path}`);
    }

    const checksum = await fileChecksum(localPath);
    if (checksum !== dump.checksum) {
      throw new Error(`Database dump checksum mismatch: ${dump.path}`);
    }

    await restoreDatabaseDump(dump, localPath);
  }
}

export async function createMigrationBundle(passphrase: string) {
  if (passphrase.trim().length < 8) {
    throw new Error("Use a migration passphrase with at least 8 characters.");
  }

  const workDir = await mkdtemp(join(tmpdir(), "aeroplane-export-"));
  const payloadDir = join(workDir, "payload");
  const archivePath = join(workDir, "payload.tar.gz");
  const bundlePath = join(workDir, `aeroplane-${new Date().toISOString().slice(0, 10)}-${nanoid(6)}.aeroplane`);

  try {
    await writePayload(payloadDir);
    await createTarGz(payloadDir, archivePath);
    await encryptMigrationArchive(archivePath, bundlePath, passphrase);
    return {
      workDir,
      bundlePath,
      fileName: basename(bundlePath),
      sizeBytes: statSync(bundlePath).size
    };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

export async function importMigrationBundle(bundlePath: string, passphrase: string): Promise<MigrationImportResult> {
  if (passphrase.trim().length < 8) {
    throw new Error("Migration passphrase is required.");
  }

  const workDir = await mkdtemp(join(tmpdir(), "aeroplane-import-"));
  const archivePath = join(workDir, "payload.tar.gz");
  const payloadDir = join(workDir, "payload");

  try {
    await decryptMigrationArchive(bundlePath, archivePath, passphrase);
    await extractTarGz(archivePath, payloadDir);

    const manifest = readJsonFile<MigrationManifest>(join(payloadDir, "manifest.json"));
    if (manifest.format !== "aeroplane-migration" || manifest.version !== 1) {
      throw new Error("Migration bundle format is not supported");
    }

    const runtimeEnv = importedRuntimeEnv(readJsonFile<Record<string, string>>(join(payloadDir, "runtime-env.json")));
    writeManagedEnv(runtimeEnv);
    config.secretKey = runtimeEnv.AEROPLANE_SECRET_KEY ?? "";
    config.controlPlaneHostname = runtimeEnv.CONTROL_PLANE_HOSTNAME ?? "";

    const systemSettings = readJsonFile<SystemSettings>(join(payloadDir, "system-settings.json"));
    saveSystemSettings(systemSettings);

    const logicalData = readJsonFile<LogicalData>(join(payloadDir, "logical-data.json"));
    replaceLogicalData(logicalData, manifest.source.dataDir, { includeUsers: false });
    restorePayloadFiles(payloadDir);
    await restoreDatabaseDumps(payloadDir, manifest.databaseDumps);
    await writeAndReloadCaddy();
    restoreUsers(logicalData.users);
    backfillImportedProjectOwners();

    const importedServices = db.select().from(services).all();
    return {
      importedAt: nowIso(),
      projects: logicalData.project_groups.length,
      services: importedServices.length,
      users: db.select().from(users).all().length,
      restoredDatabases: manifest.databaseDumps.length,
      databaseDumps: manifest.databaseDumps
    };
  } finally {
    sqlite.prepare("DELETE FROM auth_sessions").run();
    rmSync(workDir, { recursive: true, force: true });
  }
}

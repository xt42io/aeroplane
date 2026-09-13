import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { isMongoDatabase, isPostgresFamilyDatabase } from "./database-engine.js";
import { databaseTypeForService, isDatabaseService } from "./database-urls.js";
import { runDockerExec, type DatabaseContext } from "./database-viewer-shared.js";
import { containerNameForService, getServiceById } from "./deploy.js";
import { db, nowIso, sqlite } from "./db.js";
import { restoreDatabaseDump } from "./database-restore.js";
import { deleteR2Object, downloadR2ObjectToFile, uploadFileToR2 } from "./r2-storage.js";
import { databaseBackups, databaseBackupSettings, envVars, projectGroups, services, type DatabaseBackup, type DatabaseBackupSettings, type Service } from "./schema.js";
import { backupSchedulesEnabled, getSystemSettings, normalizeDatabaseBackupScheduleDefaults, type R2Settings, type SystemSettings } from "./system-settings.js";
import { getUserR2Settings } from "./user-settings.js";

export type BackupStorageTarget = "disk" | "r2" | "disk+r2";
export type BackupTrigger = "manual" | "daily" | "weekly" | "monthly";
export type ScheduledBackupTrigger = Exclude<BackupTrigger, "manual">;
export type BackupScheduleSettings = Record<ScheduledBackupTrigger, boolean>;

export type PublicDatabaseBackupSettings = {
  storage: BackupStorageTarget;
  automaticEnabled: boolean;
  defaultStorage: BackupStorageTarget;
  schedules: Array<{
    trigger: ScheduledBackupTrigger;
    intervalHours: number;
    retentionDays: number;
    enabled: boolean;
  }>;
  scheduleEnabled: BackupScheduleSettings;
};

const backupSchedules = [
  { trigger: "daily" as const, intervalMs: 24 * 60 * 60 * 1000, intervalHours: 24, retentionDays: 6 },
  { trigger: "weekly" as const, intervalMs: 7 * 24 * 60 * 60 * 1000, intervalHours: 7 * 24, retentionDays: 31 },
  { trigger: "monthly" as const, intervalMs: 30 * 24 * 60 * 60 * 1000, intervalHours: 30 * 24, retentionDays: 90 }
];

const validStorageTargets = new Set<BackupStorageTarget>(["disk", "r2", "disk+r2"]);
const activeAutomaticBackups = new Set<string>();
let schedulerStarted = false;

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

function runDocker(args: string[]) {
  return new Promise<void>((resolvePromise, reject) => {
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
        resolvePromise();
      } else {
        reject(new Error((stderr || stdout || "Docker command failed").trim()));
      }
    });
  });
}

function shellQuote(value: string | number) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function localBackupDir(serviceId: string) {
  const dir = resolve(config.dataDir, "backups", serviceId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function backupBaseName(ctx: DatabaseContext, backupId: string, extension: string) {
  return `${safeTimestamp()}-${ctx.service.slug}-${ctx.dbType}-${backupId}.${extension}`;
}

async function copyBackupFromContainer(ctx: DatabaseContext, remotePath: string, localPath: string) {
  await runDocker(["cp", `${ctx.containerName}:${remotePath}`, localPath]);
  await runDockerExec(ctx.containerName, ["rm", "-f", remotePath]).catch(() => undefined);
}

async function fileSha256(localPath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(localPath), hash);
  return hash.digest("hex");
}

function serviceOwnerUserId(service: Service) {
  const project = db
    .select({ ownerUserId: projectGroups.ownerUserId })
    .from(projectGroups)
    .where(eq(projectGroups.id, service.projectId))
    .get();
  return project?.ownerUserId ?? null;
}

function r2SettingsForService(service: Service): R2Settings | null {
  const ownerUserId = serviceOwnerUserId(service);
  return ownerUserId ? getUserR2Settings(ownerUserId) : getSystemSettings().r2 ?? null;
}

function backupSettingsForService(service: Service, settings?: SystemSettings): SystemSettings {
  return settings ?? { ...getSystemSettings(), r2: r2SettingsForService(service) };
}

function defaultStorageTarget(settings = getSystemSettings()): BackupStorageTarget {
  return settings.r2 ? "disk+r2" : "disk";
}

function defaultAutomaticBackupsEnabled(settings = getSystemSettings()) {
  return backupSchedulesEnabled(defaultScheduleSettings(settings));
}

function defaultScheduleSettings(settings = getSystemSettings()): BackupScheduleSettings {
  return normalizeDatabaseBackupScheduleDefaults(settings.databaseBackupScheduleDefaults, settings.databaseBackupsAutomaticEnabled === true);
}

function backupScheduleSettingsEnabled(scheduleEnabled: BackupScheduleSettings) {
  return backupSchedules.some((schedule) => scheduleEnabled[schedule.trigger]);
}

function scheduleSettingsFromAutomatic(enabled: boolean): BackupScheduleSettings {
  return {
    daily: enabled,
    weekly: enabled,
    monthly: enabled
  };
}

function normalizeScheduleSettings(
  input: Partial<Record<ScheduledBackupTrigger, boolean>> | undefined,
  fallback: BackupScheduleSettings
): BackupScheduleSettings {
  return {
    daily: typeof input?.daily === "boolean" ? input.daily : fallback.daily,
    weekly: typeof input?.weekly === "boolean" ? input.weekly : fallback.weekly,
    monthly: typeof input?.monthly === "boolean" ? input.monthly : fallback.monthly
  };
}

function rowScheduleSettings(row?: DatabaseBackupSettings | null): BackupScheduleSettings {
  if (!row) return scheduleSettingsFromAutomatic(false);
  return {
    daily: row.dailyEnabled,
    weekly: row.weeklyEnabled,
    monthly: row.monthlyEnabled
  };
}

function normalizeStorageTarget(value: string | null | undefined): BackupStorageTarget {
  return validStorageTargets.has(value as BackupStorageTarget) ? value as BackupStorageTarget : defaultStorageTarget();
}

function publicBackupSettings(row?: DatabaseBackupSettings | null): PublicDatabaseBackupSettings {
  const settings = getSystemSettings();
  const fallback = defaultStorageTarget(settings);
  const storedStorage = normalizeStorageTarget(row?.storage);
  const storage = fallback === "disk" && (storedStorage === "r2" || storedStorage === "disk+r2") ? "disk" : storedStorage;
  const scheduleEnabled = rowScheduleSettings(row);
  return {
    storage,
    automaticEnabled: backupScheduleSettingsEnabled(scheduleEnabled),
    defaultStorage: fallback,
    schedules: backupSchedules.map(({ trigger, intervalHours, retentionDays }) => ({
      trigger,
      intervalHours,
      retentionDays,
      enabled: scheduleEnabled[trigger]
    })),
    scheduleEnabled
  };
}

async function createPostgresBackup(ctx: DatabaseContext, backupId: string) {
  const user = ctx.envMap.get("POSTGRES_USER") || "postgres";
  const password = ctx.envMap.get("POSTGRES_PASSWORD") || "";
  const dbName = ctx.envMap.get("POSTGRES_DB") || "aeroplane";
  const localPath = resolve(localBackupDir(ctx.service.id), backupBaseName(ctx, backupId, "dump"));
  const remotePath = `/tmp/aeroplane-backup-${backupId}.dump`;

  await runDockerExec(
    ctx.containerName,
    [
      "pg_dump",
      "-h",
      "127.0.0.1",
      "-p",
      String(ctx.service.internalPort),
      "-U",
      user,
      "-d",
      dbName,
      "-Fc",
      "-f",
      remotePath
    ],
    { PGPASSWORD: password }
  );
  await copyBackupFromContainer(ctx, remotePath, localPath);
  return { localPath, format: "pg_dump custom" };
}

async function createMysqlBackup(ctx: DatabaseContext, backupId: string) {
  const user = ctx.envMap.get("MYSQL_USER") || "root";
  const password = ctx.envMap.get("MYSQL_PASSWORD") || ctx.envMap.get("MYSQL_ROOT_PASSWORD") || "";
  const dbName = ctx.envMap.get("MYSQL_DATABASE") || "aeroplane";
  const localPath = resolve(localBackupDir(ctx.service.id), backupBaseName(ctx, backupId, "sql"));
  const remotePath = `/tmp/aeroplane-backup-${backupId}.sql`;

  await runDockerExec(
    ctx.containerName,
    [
      "sh",
      "-lc",
      `mysqldump -h 127.0.0.1 -P ${Number(ctx.service.internalPort)} -u ${shellQuote(user)} --single-transaction --routines --triggers --events ${shellQuote(dbName)} > ${shellQuote(remotePath)}`
    ],
    { MYSQL_PWD: password }
  );
  await copyBackupFromContainer(ctx, remotePath, localPath);
  return { localPath, format: "mysqldump sql" };
}

async function createMongoBackup(ctx: DatabaseContext, backupId: string) {
  const user = ctx.envMap.get("MONGO_INITDB_ROOT_USERNAME") || "mongo";
  const password = ctx.envMap.get("MONGO_INITDB_ROOT_PASSWORD") || "";
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : "";
  const uri = `mongodb://${auth}127.0.0.1:${ctx.service.internalPort}/?authSource=admin`;
  const localPath = resolve(localBackupDir(ctx.service.id), backupBaseName(ctx, backupId, "archive.gz"));
  const remotePath = `/tmp/aeroplane-backup-${backupId}.archive.gz`;

  await runDockerExec(ctx.containerName, ["mongodump", `--archive=${remotePath}`, "--gzip", "--uri", uri]);
  await copyBackupFromContainer(ctx, remotePath, localPath);
  return { localPath, format: "mongodump archive.gz" };
}

async function createRedisBackup(ctx: DatabaseContext, backupId: string) {
  const password = ctx.envMap.get("REDIS_PASSWORD") || "";
  const localPath = resolve(localBackupDir(ctx.service.id), backupBaseName(ctx, backupId, "rdb"));
  const remotePath = `/tmp/aeroplane-backup-${backupId}.rdb`;
  const command = (includePassword: boolean) => [
    "redis-cli",
    "-h",
    "127.0.0.1",
    "-p",
    String(ctx.service.internalPort),
    ...(includePassword && password ? ["-a", password] : []),
    "--rdb",
    remotePath
  ];

  try {
    await runDockerExec(ctx.containerName, command(true));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!password || !/AUTH|password/i.test(message)) throw error;
    await runDockerExec(ctx.containerName, command(false));
  }

  await copyBackupFromContainer(ctx, remotePath, localPath);
  return { localPath, format: "redis rdb" };
}

async function createLocalBackup(ctx: DatabaseContext, backupId: string) {
  if (isPostgresFamilyDatabase(ctx.dbType)) return createPostgresBackup(ctx, backupId);
  if (ctx.dbType === "mysql") return createMysqlBackup(ctx, backupId);
  if (isMongoDatabase(ctx.dbType)) return createMongoBackup(ctx, backupId);
  if (ctx.dbType === "redis") return createRedisBackup(ctx, backupId);
  throw new Error(`${ctx.dbType} backups are not available yet`);
}

function publicBackup(row: DatabaseBackup) {
  return {
    id: row.id,
    serviceId: row.serviceId,
    engine: row.engine,
    status: row.status,
    trigger: row.trigger as BackupTrigger,
    storage: row.storage,
    format: row.format,
    localPath: row.localPath,
    fileName: row.localPath ? basename(row.localPath) : row.r2Key ? basename(row.r2Key) : null,
    r2Key: row.r2Key,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}

export function getDatabaseBackupSettings(serviceId: string) {
  databaseContext(serviceId);
  const settings = db.select().from(databaseBackupSettings).where(eq(databaseBackupSettings.serviceId, serviceId)).get();
  return publicBackupSettings(settings);
}

export function initializeDatabaseBackupSettings(serviceId: string, settings?: SystemSettings) {
  const ctx = databaseContext(serviceId);
  const existing = db.select().from(databaseBackupSettings).where(eq(databaseBackupSettings.serviceId, serviceId)).get();
  if (existing) return publicBackupSettings(existing);

  const resolvedSettings = backupSettingsForService(ctx.service, settings);
  const timestamp = nowIso();
  const scheduleEnabled = defaultScheduleSettings(resolvedSettings);
  db.insert(databaseBackupSettings)
    .values({
      serviceId,
      storage: defaultStorageTarget(resolvedSettings),
      automaticEnabled: defaultAutomaticBackupsEnabled(resolvedSettings),
      dailyEnabled: scheduleEnabled.daily,
      weeklyEnabled: scheduleEnabled.weekly,
      monthlyEnabled: scheduleEnabled.monthly,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .run();

  const next = db.select().from(databaseBackupSettings).where(eq(databaseBackupSettings.serviceId, serviceId)).get();
  return publicBackupSettings(next);
}

export function updateDatabaseBackupSettings(
  serviceId: string,
  input: { storage?: BackupStorageTarget; automaticEnabled?: boolean; scheduleEnabled?: Partial<Record<ScheduledBackupTrigger, boolean>> }
) {
  const ctx = databaseContext(serviceId);
  const current = getDatabaseBackupSettings(serviceId);
  const storage = input.storage ? normalizeStorageTarget(input.storage) : current.storage;
  const scheduleEnabled = input.scheduleEnabled
    ? normalizeScheduleSettings(input.scheduleEnabled, current.scheduleEnabled)
    : input.automaticEnabled === undefined
      ? current.scheduleEnabled
      : scheduleSettingsFromAutomatic(input.automaticEnabled);
  const automaticEnabled = backupScheduleSettingsEnabled(scheduleEnabled);
  if ((storage === "r2" || storage === "disk+r2") && !r2SettingsForService(ctx.service)) {
    throw new Error("Connect R2 in Storage settings before selecting R2 backups.");
  }

  const timestamp = nowIso();
  db.insert(databaseBackupSettings)
    .values({
      serviceId,
      storage,
      automaticEnabled,
      dailyEnabled: scheduleEnabled.daily,
      weeklyEnabled: scheduleEnabled.weekly,
      monthlyEnabled: scheduleEnabled.monthly,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .onConflictDoUpdate({
      target: databaseBackupSettings.serviceId,
      set: {
        storage,
        automaticEnabled,
        dailyEnabled: scheduleEnabled.daily,
        weeklyEnabled: scheduleEnabled.weekly,
        monthlyEnabled: scheduleEnabled.monthly,
        updatedAt: timestamp
      }
    })
    .run();

  const next = db.select().from(databaseBackupSettings).where(eq(databaseBackupSettings.serviceId, serviceId)).get();
  return publicBackupSettings(next);
}

export function listDatabaseBackups(serviceId: string) {
  databaseContext(serviceId);
  return db
    .select()
    .from(databaseBackups)
    .where(eq(databaseBackups.serviceId, serviceId))
    .orderBy(desc(databaseBackups.createdAt))
    .all()
    .map(publicBackup);
}

export async function createDatabaseBackup(serviceId: string, storage?: BackupStorageTarget, trigger: BackupTrigger = "manual") {
  const ctx = databaseContext(serviceId);
  const r2 = r2SettingsForService(ctx.service);
  const target = storage ?? getDatabaseBackupSettings(serviceId).storage;
  if ((target === "r2" || target === "disk+r2") && !r2) {
    throw new Error("Connect R2 in Storage settings before uploading backups.");
  }

  const backupId = nanoid(10);
  const createdAt = nowIso();
  let localBackup: Awaited<ReturnType<typeof createLocalBackup>> | null = null;
  let sizeBytes: number | null = null;
  let checksum: string | null = null;
  let r2UploadStarted = false;

  db.insert(databaseBackups)
    .values({
      id: backupId,
      serviceId,
      engine: ctx.dbType,
      status: "running",
      trigger,
      storage: target,
      format: "pending",
      localPath: null,
      r2Key: null,
      sizeBytes: null,
      checksum: null,
      error: null,
      createdAt,
      startedAt: createdAt,
      finishedAt: null
    })
    .run();

  try {
    localBackup = await createLocalBackup(ctx, backupId);
    const stats = statSync(localBackup.localPath);
    sizeBytes = stats.size;
    checksum = await fileSha256(localBackup.localPath);
    let r2Key: string | null = null;
    let localPath: string | null = localBackup.localPath;

    if (target === "r2" || target === "disk+r2") {
      if (!r2) throw new Error("R2 is not connected");
      r2Key = `database-backups/${ctx.service.projectId}/${ctx.service.slug}/${basename(localBackup.localPath)}`;
      r2UploadStarted = true;
      await uploadFileToR2(r2, localBackup.localPath, r2Key);
    }
    if (target === "r2") {
      rmSync(localBackup.localPath, { force: true });
      localPath = null;
    }

    db.update(databaseBackups)
      .set({
        status: "succeeded",
        format: localBackup.format,
        localPath,
        r2Key,
        sizeBytes,
        checksum,
        error: null,
        finishedAt: nowIso()
      })
      .where(eq(databaseBackups.id, backupId))
      .run();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Backup failed";
    const failedFields: {
      status: "failed";
      error: string;
      finishedAt: string;
      format?: string;
      localPath?: string;
      sizeBytes?: number;
      checksum?: string;
    } = {
      status: "failed",
      error: errorMessage,
      finishedAt: nowIso()
    };

    if (target === "disk+r2" && r2UploadStarted && localBackup?.localPath && existsSync(localBackup.localPath)) {
      const finalChecksum = checksum ?? (await fileSha256(localBackup.localPath));
      db.update(databaseBackups)
        .set({
          status: "succeeded",
          format: localBackup.format,
          localPath: localBackup.localPath,
          r2Key: null,
          sizeBytes: sizeBytes ?? statSync(localBackup.localPath).size,
          checksum: finalChecksum,
          error: `R2 upload failed: ${errorMessage}`,
          finishedAt: nowIso()
        })
        .where(eq(databaseBackups.id, backupId))
        .run();
    } else {
      db.update(databaseBackups)
        .set(failedFields)
        .where(eq(databaseBackups.id, backupId))
        .run();
      if (target === "r2" && localBackup?.localPath && existsSync(localBackup.localPath)) {
        rmSync(localBackup.localPath, { force: true });
      }
      throw error;
    }
  }

  const backup = db.select().from(databaseBackups).where(eq(databaseBackups.id, backupId)).get();
  if (!backup) throw new Error("Backup was not recorded");
  return publicBackup(backup);
}

export function getDatabaseBackupFile(serviceId: string, backupId: string) {
  const ctx = databaseContext(serviceId);
  const backup = db
    .select()
    .from(databaseBackups)
    .where(eq(databaseBackups.id, backupId))
    .get();
  if (!backup || backup.serviceId !== serviceId) {
    throw new Error("Backup file not found");
  }

  if (backup.localPath && existsSync(backup.localPath)) {
    return { backup: publicBackup(backup), localPath: backup.localPath, cleanup: null as null | (() => void), download: null as null | Promise<void> };
  }

  const r2 = r2SettingsForService(ctx.service);
  if (!backup.r2Key || !r2) {
    throw new Error("Backup file not found");
  }

  const tempDir = mkdtempSync(join(tmpdir(), "aeroplane-backup-download-"));
  const localPath = join(tempDir, basename(backup.r2Key));
  return {
    backup: publicBackup(backup),
    localPath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    download: downloadR2ObjectToFile(r2, backup.r2Key, localPath)
  };
}

export async function restoreDatabaseBackup(serviceId: string, backupId: string) {
  const { backup, localPath, cleanup, download } = getDatabaseBackupFile(serviceId, backupId);
  if (download) await download;
  try {
    const checksum = backup.checksum ?? (await fileSha256(localPath));
    await restoreDatabaseDump({
      serviceId,
      engine: backup.engine,
      format: backup.format,
      path: backup.fileName ?? backup.id,
      sizeBytes: backup.sizeBytes ?? statSync(localPath).size,
      checksum
    }, localPath);
  } finally {
    cleanup?.();
  }
  return { ok: true, restoredAt: nowIso(), backup };
}

export async function deleteDatabaseBackup(serviceId: string, backupId: string) {
  const ctx = databaseContext(serviceId);
  const backup = db
    .select()
    .from(databaseBackups)
    .where(eq(databaseBackups.id, backupId))
    .get();
  if (!backup || backup.serviceId !== serviceId) {
    throw new Error("Backup not found");
  }

  if (backup.localPath && existsSync(backup.localPath)) {
    rmSync(backup.localPath, { force: true });
  }

  const r2 = r2SettingsForService(ctx.service);
  if (backup.r2Key && r2) {
    await deleteR2Object(r2, backup.r2Key).catch(() => undefined);
  }

  db.delete(databaseBackups).where(eq(databaseBackups.id, backupId)).run();
  return { ok: true };
}

async function pruneScheduledBackups(serviceId: string, trigger: Exclude<BackupTrigger, "manual">) {
  const schedule = backupSchedules.find((item) => item.trigger === trigger);
  if (!schedule) return;

  const cutoff = new Date(Date.now() - schedule.retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .select()
    .from(databaseBackups)
    .where(eq(databaseBackups.serviceId, serviceId))
    .all()
    .filter((backup) => backup.trigger === trigger && backup.createdAt < cutoff);

  for (const backup of rows) {
    await deleteDatabaseBackup(serviceId, backup.id).catch(() => undefined);
  }
}

function latestScheduledBackupAt(serviceId: string, trigger: Exclude<BackupTrigger, "manual">) {
  const row = sqlite
    .prepare("SELECT created_at FROM database_backups WHERE project_id = ? AND trigger = ? AND status IN ('running', 'succeeded') ORDER BY created_at DESC LIMIT 1")
    .get(serviceId, trigger) as { created_at: string } | undefined;
  return row?.created_at ? new Date(row.created_at).getTime() : 0;
}

async function runAutomaticBackupsOnce() {
  const databaseServices = db.select().from(services).all().filter(isDatabaseService);

  for (const service of databaseServices) {
    const settings = getDatabaseBackupSettings(service.id);
    if (!settings.automaticEnabled) continue;

    for (const schedule of backupSchedules) {
      if (!settings.scheduleEnabled[schedule.trigger]) continue;
      const key = `${service.id}:${schedule.trigger}`;
      if (activeAutomaticBackups.has(key)) continue;

      const lastBackupAt = latestScheduledBackupAt(service.id, schedule.trigger);
      if (lastBackupAt && Date.now() - lastBackupAt < schedule.intervalMs) {
        await pruneScheduledBackups(service.id, schedule.trigger);
        continue;
      }

      activeAutomaticBackups.add(key);
      try {
        await createDatabaseBackup(service.id, settings.storage, schedule.trigger);
        await pruneScheduledBackups(service.id, schedule.trigger);
      } catch (error) {
        console.error(`Automatic ${schedule.trigger} backup failed for ${service.name}:`, error);
      } finally {
        activeAutomaticBackups.delete(key);
      }
    }
  }
}

export function startDatabaseBackupScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const run = () => {
    void runAutomaticBackupsOnce().catch((error) => {
      console.error("Automatic database backup scheduler failed:", error);
    });
  };
  setTimeout(run, 60_000);
  setInterval(run, 60 * 60 * 1000);
}

import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { db, nowIso } from "./db.js";
import { databaseConnections } from "./schema.js";
import { decryptSecret, encryptSecret } from "./secret-crypto.js";
import { externalPostgresEnvironment, parseExternalPostgresUrl, publicExternalPostgresConnection } from "./external-postgres-url.js";
import { runDockerExec } from "./database-viewer-shared.js";
import { containerNameForService } from "./docker-identifiers.js";

const clientImage = "postgres:18-alpine";
const probeSql = "SELECT current_database(), current_user;";

function runDocker(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    // Connection errors can contain credentials supplied by the remote server.
    child.stderr.resume();
    child.on("error", () => reject(new Error("Could not start the PostgreSQL client. Check Docker is available.")));
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error("Could not connect to PostgreSQL. Check the host, port, database, credentials and TLS settings.")));
  });
}

export function isExternalDatabase(serviceId: string) {
  return Boolean(db.select({ serviceId: databaseConnections.serviceId }).from(databaseConnections).where(eq(databaseConnections.serviceId, serviceId)).get());
}

export function externalDatabaseUrl(serviceId: string) {
  const row = db.select().from(databaseConnections).where(eq(databaseConnections.serviceId, serviceId)).get();
  return row ? decryptSecret(row.connectionUrl) : null;
}

export function externalDatabaseSummary(serviceId: string) {
  const url = externalDatabaseUrl(serviceId);
  return url ? publicExternalPostgresConnection(parseExternalPostgresUrl(url)) : null;
}

export function saveExternalDatabaseConnection(serviceId: string, url: string) {
  parseExternalPostgresUrl(url);
  const timestamp = nowIso();
  db.insert(databaseConnections).values({ serviceId, connectionUrl: encryptSecret(url.trim()), createdAt: timestamp, updatedAt: timestamp })
    .onConflictDoUpdate({ target: databaseConnections.serviceId, set: { connectionUrl: encryptSecret(url.trim()), updatedAt: timestamp } }).run();
}

export function assertManagedDatabase(serviceId: string) {
  if (isExternalDatabase(serviceId)) throw new Error("This is an existing database connection. Aeroplane does not provision, replace, restore or import into a connected database. Use its Data or SQL tab to edit data.");
}

export async function testExternalDatabaseUrl(url: string, requirePostgis = false) {
  const env = externalPostgresEnvironment(parseExternalPostgresUrl(url));
  const sql = requirePostgis ? "SELECT PostGIS_Full_Version();" : probeSql;
  await runDocker(["run", "--rm", "--network", "host", ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]), clientImage, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]);
}

export async function ensureExternalDatabaseClient(serviceId: string) {
  const name = containerNameForService(serviceId);
  const args = ["inspect", "--format", '{{index .Config.Labels "aeroplane.database-client"}}', name];
  const label = await runDocker(args).catch(() => null);
  if (label !== null) {
    if (label !== serviceId) throw new Error("The database client container name is already in use.");
    await runDocker(["start", name]);
    return;
  }
  await runDocker(["run", "-d", "--restart", "unless-stopped", "--name", name, "--label", `aeroplane.database-client=${serviceId}`, "--network", "host", "--read-only", "--tmpfs", "/tmp", "--tmpfs", "/var/lib/postgresql", clientImage, "sleep", "infinity"]);
}

export async function checkExternalDatabaseConnection(serviceId: string) {
  const url = externalDatabaseUrl(serviceId);
  if (!url) throw new Error("Existing database connection not found.");
  const env = externalPostgresEnvironment(parseExternalPostgresUrl(url));
  await ensureExternalDatabaseClient(serviceId);
  try {
    await runDockerExec(containerNameForService(serviceId), ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", probeSql], env);
  } catch {
    throw new Error("Could not connect to PostgreSQL. Check the host, port, database, credentials and TLS settings.");
  }
}

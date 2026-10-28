import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config } from "./config.js";
import { isPostgresFamilyDatabase } from "./database-engine.js";
import { db } from "./db.js";
import { domains, services } from "./schema.js";
import { ensureDefaultDomainsForExistingServices } from "./service-domains.js";
import { configuredControlPlaneHostname } from "./system-settings.js";
import { isDatabaseService } from "../shared/service-source.js";
import { isWorkerService } from "../shared/service-runtime.js";

function shellWords(command: string) {
  return command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function caddyTlsConfig(hostname: string) {
  return isLocalHostname(hostname) ? "  tls internal\n" : "";
}

function staticSiteDirForService(serviceId: string) {
  return resolve(process.env.CADDY_DATA_DIR ?? config.caddyDataDir, "static-sites", serviceId);
}

function currentControlPlaneHostname() {
  return configuredControlPlaneHostname();
}

function currentCaddyConfigPath() {
  return resolve(process.env.CADDY_CONFIG_PATH ?? config.caddyConfigPath);
}

function currentCaddyReloadCmd() {
  return process.env.CADDY_RELOAD_CMD ?? config.caddyReloadCmd;
}

function caddyReloadDetail(output: string, code: number | null) {
  const trimmed = output.trim();
  if (/localhost:2019\/load|dial tcp .*:2019: connect: connection refused/i.test(trimmed)) {
    return "Caddy config was written, but Caddy's admin API is not reachable. Start Caddy or set CADDY_RELOAD_CMD to the reload command for your running Caddy instance.";
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line && /^error:/i.test(line)) return line;
  }
  return lines[lines.length - 1] ?? `caddy reload exited with ${code}`;
}

function controlPlaneBlock() {
  const hostname = currentControlPlaneHostname();
  if (!hostname) return null;

  return `${hostname} {
${caddyTlsConfig(hostname)}  encode zstd gzip
  reverse_proxy 127.0.0.1:${config.port}
}`;
}

export function renderCaddyfile() {
  ensureDefaultDomainsForExistingServices();
  const routableService = or(inArray(services.status, ["active", "building"]), isNotNull(services.activePort));
  const domainMappings = db
    .select({
      serviceId: services.id,
      hostname: domains.hostname,
      hostPort: services.hostPort,
      activePort: services.activePort,
      staticOutput: services.staticOutput,
      runtimeMode: services.runtimeMode,
      repoUrl: services.repoUrl,
      repoFullName: services.repoFullName
    })
    .from(domains)
    .innerJoin(services, eq(services.id, domains.serviceId))
    .where(and(inArray(domains.status, ["active", "pending"]), routableService))
    .all();
  const databaseMappings = db
    .select({
      hostname: services.databasePublicHostname,
      hostPort: services.hostPort,
      repoUrl: services.repoUrl,
      repoFullName: services.repoFullName
    })
    .from(services)
    .where(and(eq(services.databasePublicEnabled, true), isNotNull(services.databasePublicHostname)))
    .all();

  const blocks: string[] = [];
  const blockHostnames = new Set<string>();
  function addHostnameBlock(hostname: string, block: string) {
    if (blockHostnames.has(hostname)) return;
    blockHostnames.add(hostname);
    blocks.push(block);
  }

  const controlPlane = controlPlaneBlock();
  if (controlPlane) {
    const hostname = currentControlPlaneHostname();
    if (hostname) addHostnameBlock(hostname, controlPlane);
  }
  const controlPlaneHostname = currentControlPlaneHostname();

  for (const row of domainMappings) {
    const isDatabase = isDatabaseService(row);
    if (isDatabase) continue;
    if (isWorkerService(row)) continue;
    if (controlPlaneHostname && row.hostname === controlPlaneHostname) continue;

    if (row.staticOutput) {
      addHostnameBlock(row.hostname, `${row.hostname} {
${caddyTlsConfig(row.hostname)}  root * ${staticSiteDirForService(row.serviceId)}
  try_files {path} {path}/ /index.html
  file_server
}`);
      continue;
    }

    const targetPort = row.activePort ?? row.hostPort;
    addHostnameBlock(row.hostname, `${row.hostname} {
${caddyTlsConfig(row.hostname)}  encode zstd gzip
  reverse_proxy 127.0.0.1:${targetPort}
}`);
  }

  for (const row of databaseMappings) {
    if (!row.hostname) continue;
    const isDatabase = isDatabaseService(row);
    const dbType = row.repoFullName?.split(":")[1] || "postgres";
    if (!isDatabase || !isPostgresFamilyDatabase(dbType)) continue;
    if (controlPlaneHostname && row.hostname === controlPlaneHostname) continue;

    addHostnameBlock(row.hostname, `${row.hostname} {
${caddyTlsConfig(row.hostname)}  respond "Aeroplane ${dbType === "timescale" ? "TimescaleDB" : dbType === "postgis" ? "PostgreSQL with PostGIS" : "Postgres"} is available on TCP ${row.hostPort}." 200
}`);
  }

  if (blocks.length === 0) {
    blocks.push(`http://127.0.0.1:65535 {
  respond "No active Aeroplane routes." 404
}`);
  }

  return [`# Managed by Aeroplane. Manual changes may be overwritten.`, ...blocks].join("\n\n") + "\n";
}

export async function writeAndReloadCaddy() {
  const caddyConfigPath = currentCaddyConfigPath();
  mkdirSync(dirname(caddyConfigPath), { recursive: true });
  writeFileSync(caddyConfigPath, renderCaddyfile(), "utf8");

  const [cmd, ...args] = shellWords(currentCaddyReloadCmd());
  if (!cmd) {
    return { ok: false, detail: "CADDY_RELOAD_CMD is empty" };
  }

  return new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error) => resolve({ ok: false, detail: error.message }));
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        detail: caddyReloadDetail(output, code)
      });
    });
  });
}

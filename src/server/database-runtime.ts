import { isPostgresFamilyDatabase } from "./database-engine.js";

export const databaseVolumeHelperImage = "alpine:3.20";

function safeDockerIdentifier(value: string, fallback: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || fallback;
}

export function databaseImage(dbType: string) {
  if (dbType === "postgis") return "postgis/postgis:18-3.6";
  if (dbType === "timescale") return "timescale/timescaledb:latest-pg18";
  if (isPostgresFamilyDatabase(dbType)) return "postgres:18-alpine";
  if (dbType === "mysql") return "mysql:8";
  if (dbType === "redis") return "redis:7-alpine";
  if (dbType === "mongodb" || dbType === "mongo") return "mongo:6";
  if (dbType === "clickhouse") return "clickhouse/clickhouse-server:latest";
  return "postgres:18-alpine";
}

export function assertDatabasePlatform(dbType: string, architecture: string) {
  if (dbType === "postgis" && !["amd64", "x86_64"].includes(architecture.trim())) {
    throw new Error("The PostGIS image currently supports x86-64 servers only. No database containers or volumes were changed.");
  }
}

export function databaseDataVolumeName(serviceId: string) {
  return `aeroplane-db-data-${safeDockerIdentifier(serviceId, "service")}`;
}

export function databaseDataMountPath(dbType: string) {
  if (isPostgresFamilyDatabase(dbType)) return "/var/lib/postgresql";
  if (dbType === "mysql") return "/var/lib/mysql";
  if (dbType === "redis") return "/data";
  if (dbType === "mongodb" || dbType === "mongo") return "/data/db";
  if (dbType === "clickhouse") return "/var/lib/clickhouse";
  return "/var/lib/postgresql";
}

export function databaseDataMountCandidates(dbType: string) {
  const primary = databaseDataMountPath(dbType);
  if (isPostgresFamilyDatabase(dbType)) return [primary, "/var/lib/postgresql/data", "/var/lib/postgresql/18/docker"];
  return [primary];
}

export function databaseDataVolumeArg(serviceId: string, dbType: string) {
  return `${databaseDataVolumeName(serviceId)}:${databaseDataMountPath(dbType)}`;
}

export function databaseContainerCommandArgs(dbType: string, env: Map<string, string> | Record<string, string>) {
  const value = env instanceof Map ? env.get("REDIS_PASSWORD") : env.REDIS_PASSWORD;
  if (dbType === "redis" && value) {
    return ["redis-server", "--appendonly", "yes", "--requirepass", value];
  }
  return [];
}

import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { externalDatabaseUrl, isExternalDatabase } from "./database-connections.js";
import { isPostgresFamilyDatabase } from "./database-engine.js";
import { buildDatabaseConnectionUrl, databaseTypeForService, isDatabaseService } from "./database-urls.js";
import { db, nowIso } from "./db.js";
import { envVars, services } from "./schema.js";

export type DatabaseConnectionEnvSuggestion = {
  key: string;
  sourceKey: string;
  value: string;
  label: string;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  dbType: string;
};

function upsertEnvVar(serviceId: string, key: string, value: string, timestamp = nowIso()) {
  db.insert(envVars)
    .values({
      id: nanoid(10),
      serviceId,
      key,
      value,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .onConflictDoUpdate({
      target: [envVars.serviceId, envVars.key],
      set: { value, updatedAt: timestamp }
    })
    .run();
}

function mapEnvRows(serviceIds: string[]) {
  const envsByServiceId = new Map<string, Map<string, string>>();
  for (const serviceId of serviceIds) {
    envsByServiceId.set(serviceId, new Map());
  }

  const rows = serviceIds.length > 0
    ? db.select().from(envVars).where(inArray(envVars.serviceId, serviceIds)).all()
    : [];

  for (const row of rows) {
    envsByServiceId.get(row.serviceId)?.set(row.key, row.value);
  }

  return envsByServiceId;
}

function databaseConnectionSuggestionKey(dbType: string, primaryKey: string) {
  if (dbType === "mongodb") return "MONGO_URI";
  return primaryKey;
}

function normalizeKey(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function keyDatabaseType(key: string) {
  const normalized = normalizeKey(key);
  if (normalized.includes("REDIS")) return "redis";
  if (normalized.includes("MONGO")) return "mongodb";
  if (normalized.includes("MYSQL") || normalized.includes("MARIA")) return "mysql";
  if (normalized.includes("CLICKHOUSE")) return "clickhouse";
  if (normalized.includes("TIMESCALE")) return "timescale";
  if (normalized.includes("POSTGRES") || normalized.includes("PG_")) return "postgres";
  if (normalized === "DATABASE_URL" || normalized.endsWith("_DATABASE_URL")) return "relational";
  return null;
}

function keyMatchesDatabaseService(key: string, databaseService: { name: string; slug: string }) {
  const normalizedKey = normalizeKey(key);
  const names = [databaseService.name, databaseService.slug]
    .flatMap((value) => normalizeKey(value).split("_"))
    .filter((part) => part.length >= 3);
  return names.some((part) => normalizedKey.includes(part));
}

function databaseConnectionEnvSuggestionsForProjectServices(projectId: string, excludeServiceId?: string) {
  const projectServices = db.select().from(services).where(eq(services.projectId, projectId)).all();
  const databaseServices = projectServices.filter((projectService) => projectService.id !== excludeServiceId && isDatabaseService(projectService));
  if (databaseServices.length === 0) return [];

  const envsByServiceId = mapEnvRows(databaseServices.map((databaseService) => databaseService.id));
  const suggestions: DatabaseConnectionEnvSuggestion[] = [];

  for (const databaseService of databaseServices) {
    const dbType = databaseTypeForService(databaseService);
    const envMap = envsByServiceId.get(databaseService.id) ?? new Map<string, string>();
    const connectionUrl = buildDatabaseConnectionUrl({
      dbType,
      envMap,
      host: databaseService.slug,
      port: databaseService.internalPort
    });

    suggestions.push({
      key: databaseConnectionSuggestionKey(dbType, connectionUrl.key),
      sourceKey: connectionUrl.key,
      value: externalDatabaseUrl(databaseService.id) ?? connectionUrl.value,
      label: `${databaseService.name} ${dbType} connection`,
      serviceId: databaseService.id,
      serviceName: databaseService.name,
      serviceSlug: databaseService.slug,
      dbType
    });
  }

  return suggestions;
}

export function databaseConnectionEnvSuggestionsForProject(projectId: string) {
  return databaseConnectionEnvSuggestionsForProjectServices(projectId);
}

export function databaseConnectionEnvSuggestionsForService(serviceId: string) {
  const service = db.select().from(services).where(eq(services.id, serviceId)).get();
  if (!service) return [];
  return databaseConnectionEnvSuggestionsForProjectServices(service.projectId, service.id);
}

export function syncProjectDatabaseConnectionEnv(projectId: string) {
  const projectServices = db.select().from(services).where(eq(services.projectId, projectId)).all();
  const databaseServices = projectServices.filter((service) => isDatabaseService(service));
  if (databaseServices.length === 0) {
    return { linked: 0 };
  }

  const timestamp = nowIso();
  const serviceIds = projectServices.map((service) => service.id);
  const envsByServiceId = mapEnvRows(serviceIds);
  let synced = 0;

  for (const databaseService of databaseServices) {
    const dbType = databaseTypeForService(databaseService);
    const envMap = envsByServiceId.get(databaseService.id) ?? new Map<string, string>();
    const connectionUrl = buildDatabaseConnectionUrl({
      dbType,
      envMap,
      host: databaseService.slug,
      port: databaseService.internalPort
    });

    if (isExternalDatabase(databaseService.id)) continue;
    if (envMap.get(connectionUrl.key) !== connectionUrl.value) {
      upsertEnvVar(databaseService.id, connectionUrl.key, connectionUrl.value, timestamp);
      envMap.set(connectionUrl.key, connectionUrl.value);
      synced += 1;
    }
  }

  return { linked: 0, synced };
}

export function linkProjectAppDatabaseConnectionEnv(projectId: string) {
  const projectServices = db.select().from(services).where(eq(services.projectId, projectId)).all();
  const databaseServices = projectServices.filter((service) => isDatabaseService(service));
  const appServices = projectServices.filter((service) => !isDatabaseService(service));
  if (databaseServices.length === 0 || appServices.length === 0) {
    return { linked: 0 };
  }

  const serviceIds = projectServices.map((service) => service.id);
  const envsByServiceId = mapEnvRows(serviceIds);
  const databaseConnections = databaseServices.map((databaseService) => {
    const dbType = databaseTypeForService(databaseService);
    const envMap = envsByServiceId.get(databaseService.id) ?? new Map<string, string>();
    const connectionUrl = buildDatabaseConnectionUrl({
      dbType,
      envMap,
      host: databaseService.slug,
      port: databaseService.internalPort
    });

    return {
      service: databaseService,
      dbType,
      key: databaseConnectionSuggestionKey(dbType, connectionUrl.key),
      value: externalDatabaseUrl(databaseService.id) ?? connectionUrl.value
    };
  });

  const timestamp = nowIso();
  let linked = 0;

  for (const appService of appServices) {
    const envMap = envsByServiceId.get(appService.id) ?? new Map<string, string>();
    for (const [key, currentValue] of envMap) {
      const requestedType = keyDatabaseType(key);
      if (!requestedType) continue;

      const candidates = databaseConnections.filter((connection) => {
        if (requestedType === "relational") {
          return isPostgresFamilyDatabase(connection.dbType) || connection.dbType === "mysql";
        }
        if (requestedType === "postgres") {
          return isPostgresFamilyDatabase(connection.dbType);
        }
        return connection.dbType === requestedType;
      });
      if (candidates.length === 0) continue;

      const connection = candidates.find((candidate) => keyMatchesDatabaseService(key, candidate.service)) ?? candidates[0];
      if (!connection || currentValue === connection.value) continue;

      upsertEnvVar(appService.id, key, connection.value, timestamp);
      envMap.set(key, connection.value);
      linked += 1;
    }
  }

  return { linked };
}

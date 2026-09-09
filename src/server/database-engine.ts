export const postgresFamilyDatabaseTypes = new Set(["postgres", "pgvector", "timescale"]);

export function isPostgresFamilyDatabase(dbType: string) {
  return postgresFamilyDatabaseTypes.has(dbType);
}

export function isMongoDatabase(dbType: string) {
  return dbType === "mongodb" || dbType === "mongo";
}

export function isRelationalDatabase(dbType: string) {
  return isPostgresFamilyDatabase(dbType) || dbType === "mysql" || dbType === "clickhouse";
}

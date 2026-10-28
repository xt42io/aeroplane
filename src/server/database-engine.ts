export const postgresFamilyDatabaseTypes = new Set(["postgres", "postgis", "timescale"]);

export function isPostgresFamilyDatabase(dbType: string) {
  return postgresFamilyDatabaseTypes.has(dbType);
}

export function isMongoDatabase(dbType: string) {
  return dbType === "mongodb" || dbType === "mongo";
}

export function isRelationalDatabase(dbType: string) {
  return isPostgresFamilyDatabase(dbType) || dbType === "mysql" || dbType === "clickhouse";
}

export type DatabaseType = "postgres" | "postgis" | "timescale" | "mysql" | "redis" | "mongodb" | "clickhouse";

export type DatabaseOption = {
  key: DatabaseType;
  name: string;
  logoUrl: null | string;
  logoClassName?: string;
  defaultPort: number;
};

export type EnvEntry = {
  key: string;
  value: string;
};

export type DatabaseCredentialField = {
  key: string;
  label: string;
  placeholder: string;
};

function databaseIconUrl(slug: string) {
  return `/api/assets/framework-icons/${slug}.svg`;
}

export function isPostgresFamilyDatabase(dbType: string) {
  return dbType === "postgres" || dbType === "postgis" || dbType === "timescale";
}

export const DATABASE_OPTIONS: DatabaseOption[] = [
  {
    key: "postgres",
    name: "PostgreSQL",
    logoUrl: databaseIconUrl("postgres"),
    defaultPort: 5432
  },
  {
    key: "timescale",
    name: "TimescaleDB",
    logoUrl: databaseIconUrl("timescale"),
    defaultPort: 5432
  },
  {
    key: "mysql",
    name: "MySQL",
    logoUrl: databaseIconUrl("mysql"),
    defaultPort: 3306
  },
  {
    key: "redis",
    name: "Redis",
    logoUrl: databaseIconUrl("redis"),
    defaultPort: 6379
  },
  {
    key: "mongodb",
    name: "MongoDB",
    logoUrl: databaseIconUrl("mongodb"),
    logoClassName: "h-6 w-6 object-contain",
    defaultPort: 27017
  },
  {
    key: "clickhouse",
    name: "ClickHouse",
    logoUrl: databaseIconUrl("clickhouse"),
    defaultPort: 8123
  }
];

export function getDatabaseOption(dbType: DatabaseType) {
  if (dbType === "postgis") return { ...DATABASE_OPTIONS[0], key: dbType, name: "PostgreSQL with PostGIS" };
  return DATABASE_OPTIONS.find((option) => option.key === dbType) ?? DATABASE_OPTIONS[0];
}

export function getDatabaseCredentialFields(dbType: DatabaseType): DatabaseCredentialField[] {
  if (dbType === "mysql") {
    return [
      { key: "MYSQL_DATABASE", label: "Database name", placeholder: "aeroplane" },
      { key: "MYSQL_USER", label: "Username", placeholder: "mysql" },
      { key: "MYSQL_PASSWORD", label: "Password", placeholder: "password" },
      { key: "MYSQL_ROOT_PASSWORD", label: "Root password", placeholder: "root password" }
    ];
  }

  if (dbType === "redis") {
    return [
      { key: "REDIS_PASSWORD", label: "Password", placeholder: "password" }
    ];
  }

  if (dbType === "mongodb") {
    return [
      { key: "MONGO_INITDB_ROOT_USERNAME", label: "Root username", placeholder: "mongo" },
      { key: "MONGO_INITDB_ROOT_PASSWORD", label: "Root password", placeholder: "password" }
    ];
  }

  if (dbType === "clickhouse") {
    return [
      { key: "CLICKHOUSE_DB", label: "Database name", placeholder: "aeroplane" },
      { key: "CLICKHOUSE_USER", label: "Username", placeholder: "clickhouse" },
      { key: "CLICKHOUSE_PASSWORD", label: "Password", placeholder: "password" }
    ];
  }

  const postgresFields = [
    { key: "POSTGRES_DB", label: "Database name", placeholder: "aeroplane" },
    { key: "POSTGRES_USER", label: "Username", placeholder: "postgres" },
    { key: "POSTGRES_PASSWORD", label: "Password", placeholder: "password" }
  ];
  if (dbType === "timescale") {
    return [
      ...postgresFields,
      { key: "TIMESCALEDB_TELEMETRY", label: "Telemetry", placeholder: "off" }
    ];
  }
  return postgresFields;
}

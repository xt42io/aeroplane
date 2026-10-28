export type ExternalPostgresConnection = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: string;
};

const sslModes = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);

export function parseExternalPostgresUrl(value: string): ExternalPostgresConnection {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid postgres:// or postgresql:// connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.hash) {
    throw new Error("Use a PostgreSQL connection URL with a hostname, username and database name.");
  }
  if (Array.from(url.searchParams.keys()).some((key) => key !== "sslmode")) {
    throw new Error("Only the sslmode connection parameter is supported. Certificate and service file paths are not accepted.");
  }
  if (url.searchParams.getAll("sslmode").length > 1) throw new Error("Specify sslmode only once.");
  const sslMode = url.searchParams.get("sslmode") || "prefer";
  if (!sslModes.has(sslMode)) throw new Error("Use a valid PostgreSQL sslmode.");
  let database: string;
  let user: string;
  let password: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error("The connection URL contains invalid percent encoding.");
  }
  if (!database || [database, user, password, url.hostname].some((part) => /[\x00-\x1f\x7f]/.test(part))) {
    throw new Error("Use a database name and credentials without control characters.");
  }
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Use a valid database port.");
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port, database, user, password, sslMode };
}

export function externalPostgresEnvironment(connection: ExternalPostgresConnection) {
  return {
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGDATABASE: connection.database,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGSSLMODE: connection.sslMode,
    ...(["verify-ca", "verify-full"].includes(connection.sslMode) ? { PGSSLROOTCERT: "/etc/ssl/certs/ca-certificates.crt" } : {}),
    PGCONNECT_TIMEOUT: "5",
    PGAPPNAME: "aeroplane-browser",
    PGOPTIONS: "-c statement_timeout=15000"
  };
}

export function publicExternalPostgresConnection(connection: ExternalPostgresConnection) {
  const { password: _password, ...summary } = connection;
  return summary;
}

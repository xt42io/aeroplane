import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import { AppIcon, FieldLabel, FormInput } from "../ui/primitives";
import { SquareSwitch } from "../ui/square-switch";
import { getDatabaseOption, isPostgresFamilyDatabase, type DatabaseType, type EnvEntry } from "./database-service-options";
import { generateDatabaseHostname } from "./database-hostname";

interface DatabaseConfigureStepProps {
  dbType: DatabaseType;
  onBack: () => void;
  onSubmit: (payload: {
    name: string;
    repoFullName: string;
    repoUrl: string;
    branch: string;
    internalPort: number;
    databasePublicEnabled: boolean;
    databasePublicHostname?: string;
    postgresLogicalReplicationEnabled: boolean;
    env: EnvEntry[];
  }) => Promise<void>;
  busy: boolean;
}

function generateRandomPassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let pwd = "";
  for (let i = 0; i < 16; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

export function DatabaseConfigureStep({ dbType, onBack, onSubmit, busy }: DatabaseConfigureStepProps) {
  const [name, setName] = useState("");
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [rootDomain, setRootDomain] = useState("");
  const [publicHostname, setPublicHostname] = useState("");
  const [pgVectorEnabled, setPgVectorEnabled] = useState(dbType === "pgvector");

  const effectiveDbType: DatabaseType = dbType === "postgres" && pgVectorEnabled ? "pgvector" : dbType;
  const dbOption = getDatabaseOption(dbType);
  const effectiveDbOption = getDatabaseOption(effectiveDbType);
  const defaultPort = effectiveDbOption.defaultPort;
  const dbLabel = effectiveDbOption.name;
  const isPostgres = dbType === "postgres" || dbType === "pgvector";

  // Pre-populate defaults
  useEffect(() => {
    setName(`${effectiveDbType}-db`);
    const password = generateRandomPassword();
    const list: EnvEntry[] = [];

    if (isPostgresFamilyDatabase(effectiveDbType)) {
      list.push({ key: "POSTGRES_DB", value: "aeroplane" });
      list.push({ key: "POSTGRES_USER", value: "postgres" });
      list.push({ key: "POSTGRES_PASSWORD", value: password });
      if (effectiveDbType === "timescale") {
        list.push({ key: "TIMESCALEDB_TELEMETRY", value: "off" });
      }
    } else if (effectiveDbType === "mysql") {
      const userPassword = generateRandomPassword();
      list.push({ key: "MYSQL_DATABASE", value: "aeroplane" });
      list.push({ key: "MYSQL_USER", value: "mysql" });
      list.push({ key: "MYSQL_PASSWORD", value: userPassword });
      list.push({ key: "MYSQL_ROOT_PASSWORD", value: password });
    } else if (effectiveDbType === "redis") {
      list.push({ key: "REDIS_PASSWORD", value: password });
    } else if (effectiveDbType === "mongodb") {
      list.push({ key: "MONGO_INITDB_ROOT_USERNAME", value: "mongo" });
      list.push({ key: "MONGO_INITDB_ROOT_PASSWORD", value: password });
    } else if (effectiveDbType === "clickhouse") {
      list.push({ key: "CLICKHOUSE_DB", value: "aeroplane" });
      list.push({ key: "CLICKHOUSE_USER", value: "clickhouse" });
      list.push({ key: "CLICKHOUSE_PASSWORD", value: password });
      list.push({ key: "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT", value: "1" });
    }

    setEnvEntries(list);
    setPublicHostname("");
  }, [effectiveDbType]);

  useEffect(() => {
    let cancelled = false;
    void api.systemSettings()
      .then((result) => {
        if (!cancelled) setRootDomain(result.settings.rootDomain);
      })
      .catch(() => {
        if (!cancelled) setRootDomain("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPublicHostname(generateDatabaseHostname(name, rootDomain));
  }, [name, rootDomain]);

  function updateEnvValue(key: string, value: string) {
    setEnvEntries((current) => {
      const next = new Map(current.map((entry) => [entry.key, entry.value]));
      next.set(key, value);
      return Array.from(next.entries()).map(([entryKey, entryValue]) => ({ key: entryKey, value: entryValue }));
    });
  }

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    void onSubmit({
      name: name.trim(),
      repoFullName: `database:${effectiveDbType}`,
      repoUrl: "database",
      branch: "main",
      internalPort: defaultPort,
      databasePublicEnabled: true,
      databasePublicHostname: publicHostname.trim().toLowerCase() || undefined,
      postgresLogicalReplicationEnabled: isPostgresFamilyDatabase(effectiveDbType),
      env: envEntries
    });
  }

  return (
    <form onSubmit={handleFormSubmit} className="flex min-h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 border border-white/10 px-3 py-2.5">
            <span className="text-xs text-zinc-300">{dbLabel}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">New database</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <FieldLabel>Service name</FieldLabel>
              <FormInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={`${effectiveDbType}-db`}
                required
                disabled={busy}
                variant="monochrome"
                className="!h-9 border-white/15 bg-black text-xs"
              />
            </div>
            <div>
              <FieldLabel>Internal port</FieldLabel>
              <div className="flex h-9 items-center border border-white/10 px-3 font-mono text-xs text-zinc-500">
                {defaultPort}
              </div>
            </div>
          </div>

          {isPostgres ? (
            <div className="border border-white/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-300">pgvector extension</div>
                  <div className="mt-1 font-mono text-[9px] tracking-[0.08em] text-zinc-500">Use pgvector/pgvector:pg18 image with vector support</div>
                </div>
                <SquareSwitch checked={pgVectorEnabled} onCheckedChange={setPgVectorEnabled} disabled={busy} label="Enable pgvector" />
              </div>
            </div>
          ) : null}

          <div className="grid border border-white/10 md:grid-cols-2">
            <div>
              <div className="border-b border-white/10 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600 md:border-r">Public hostname</div>
              <div className="flex h-9 min-w-0 items-center px-3 font-mono text-xs text-zinc-300 md:border-r">
                <span className="truncate">{publicHostname || "Set root domain first"}</span>
              </div>
            </div>
            <div>
              <div className="border-b border-white/10 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">Public URL variable</div>
              <div className="flex h-9 min-w-0 items-center px-3 font-mono text-xs text-zinc-300">
                <span className="truncate">{isPostgresFamilyDatabase(effectiveDbType) ? "POSTGRES_PUBLIC_URL" : `${effectiveDbType.toUpperCase()}_PUBLIC_URL`}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">Database variables</span>
              <span className="font-mono text-[9px] text-zinc-700">{envEntries.length} generated</span>
            </div>

            <div className="overflow-hidden border border-white/10">
              {envEntries.length === 0 ? (
                <div className="px-3 py-5 text-xs text-zinc-500">No database variables configured.</div>
              ) : (
                envEntries.map((item) => (
                  <div
                    key={item.key}
                    className="grid gap-2 border-b border-white/10 px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:items-center"
                  >
                    <span className="truncate font-mono text-[10px] tracking-[0.08em] text-zinc-400">{item.key}</span>
                    <FormInput
                      value={item.value}
                      onChange={(event) => updateEnvValue(item.key, event.target.value)}
                      disabled={busy}
                      autoComplete="off"
                      variant="monochrome"
                      className="!h-8 border-white/15 bg-black font-mono text-xs"
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-white/10 pt-4">
        <button type="button" className="inline-flex h-8 items-center justify-center gap-2 px-3 text-xs text-zinc-500 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-40" onClick={onBack} disabled={busy}>
          <AppIcon icon={ArrowLeft01Icon} size={16} />
          Back
        </button>
        <button type="submit" className="inline-flex h-8 items-center justify-center bg-white px-4 text-xs text-black transition hover:bg-zinc-200 disabled:opacity-40" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create database"}
        </button>
      </div>
    </form>
  );
}

import type { Service } from "../../api";
import type { ServiceTab } from "./service-tabs";

export function DatabaseConnectionOverview({ service, busy, onCheck, onTabChange }: { service: Service; busy: boolean; onCheck: () => void; onTabChange: (tab: ServiceTab) => void }) {
  const connection = service.databaseConnection!;
  return <div className="space-y-4">
    <section className="border border-white/10 bg-black p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg text-white">{service.name}</h2><p className="mt-1 text-xs text-zinc-500">Existing PostgreSQL connection{service.repoFullName === "database:postgis" ? " · PostGIS" : ""}</p></div><span className={service.reachable ? "text-xs text-emerald-300" : "text-xs text-rose-300"}>{service.reachable ? "Reachable" : "Check connection"}</span></div>
      <dl className="mt-5 grid gap-4 text-xs sm:grid-cols-2"><div><dt className="text-zinc-500">Endpoint</dt><dd className="mt-1 break-all text-zinc-200">{connection.host}:{connection.port}</dd></div><div><dt className="text-zinc-500">Database</dt><dd className="mt-1 text-zinc-200">{connection.database}</dd></div><div><dt className="text-zinc-500">Database user</dt><dd className="mt-1 text-zinc-200">{connection.user}</dd></div><div><dt className="text-zinc-500">TLS mode</dt><dd className="mt-1 text-zinc-200">{connection.sslMode}</dd></div></dl>
      <div className="mt-5 flex flex-wrap gap-3 border-t border-white/10 pt-4"><button type="button" onClick={() => onTabChange("data")} className="bg-white px-4 py-2 text-xs text-black">Browse data</button><button type="button" onClick={() => onTabChange("sql")} className="border border-white/15 px-4 py-2 text-xs text-zinc-200">Open SQL console</button><button type="button" disabled={busy} onClick={onCheck} className="border border-white/15 px-4 py-2 text-xs text-zinc-200 disabled:opacity-40">{busy ? "Checking…" : "Check connection"}</button></div>
    </section>
    <p className="text-xs text-zinc-500">Edits and SQL use this database user's permissions. Aeroplane stores the connection and runs a PostgreSQL client; the existing database keeps its current hosting, deployment and backup configuration.</p>
  </div>;
}

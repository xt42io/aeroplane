import { useState, type FormEvent } from "react";
import { api, type Service } from "../../api";
import { FieldLabel, FormInput } from "../ui/primitives";

export function DatabaseConnectionSettings({ service, onUpdated, onRemove }: { service: Service; onUpdated: () => Promise<void>; onRemove: () => void }) {
  const [name, setName] = useState(service.name);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const connection = service.databaseConnection;

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await action();
      await onUpdated();
      setMessage(success);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the database connection.");
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      if (url.trim()) await api.updateDatabaseConnection(service.id, url.trim());
      if (name.trim() !== service.name) await api.updateService(service.id, { name: name.trim() });
      setUrl("");
    }, "Connection settings saved.");
  }

  return <form onSubmit={save} className="mx-auto w-full max-w-[1100px] space-y-5 border border-white/10 bg-black p-5">
    <header><h2 className="text-lg text-white">Database connection</h2><p className="mt-1 text-xs text-zinc-500">Aeroplane connects to your existing database. Table edits and SQL run with the database user's permissions.</p></header>
    {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
    <div><FieldLabel>Connection name</FieldLabel><FormInput aria-label="Connection name" value={name} onChange={(event) => setName(event.target.value)} required disabled={busy} variant="monochrome" /></div>
    <dl className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-2"><div><dt>Host</dt><dd className="mt-1 text-zinc-200">{connection?.host}:{connection?.port}</dd></div><div><dt>Database / user</dt><dd className="mt-1 text-zinc-200">{connection?.database} / {connection?.user}</dd></div></dl>
    <div><FieldLabel>Replace connection URL</FieldLabel><FormInput aria-label="Replace connection URL" type="password" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Leave blank to keep the saved connection" autoComplete="off" disabled={busy} variant="monochrome" /><p className="mt-2 text-xs text-zinc-500">The saved URL is encrypted and is never returned by this settings page.</p></div>
    <footer className="flex flex-wrap gap-3 border-t border-white/10 pt-4">
      <button type="submit" disabled={busy} className="bg-white px-4 py-2 text-xs text-black disabled:opacity-40">{busy ? "Working…" : "Save connection"}</button>
      <button type="button" disabled={busy} onClick={() => void perform(() => api.checkDatabaseConnection(service.id), "Database connection is working.")} className="border border-white/15 px-4 py-2 text-xs text-zinc-300 disabled:opacity-40">Check connection</button>
      <button type="button" disabled={busy} onClick={onRemove} className="border border-rose-400/40 px-4 py-2 text-xs text-rose-300 disabled:opacity-40">Remove connection</button>
    </footer>
    <p className="text-xs text-zinc-500">Removing this connection removes its Aeroplane client only. Your existing database and its data remain in place. Database deployment and backup management stay with its current host.</p>
  </form>;
}

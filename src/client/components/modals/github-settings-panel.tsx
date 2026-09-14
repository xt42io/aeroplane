import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  GithubIcon,
  LinkSquare02Icon,
  PencilEdit02Icon
} from "@hugeicons/core-free-icons";
import { FormEvent, useEffect, useState } from "react";
import { api, type GitHubSettingsStatus } from "../../api";
import { startGitHubAppManifestFlow } from "../../lib/github-app-manifest";
import { AppIcon, FieldLabel, FormInput } from "../ui/primitives";

type GitHubFormState = {
  githubAccessToken: string;
  githubAppId: string;
  githubAppClientId: string;
  githubAppSlug: string;
  githubAppPrivateKey: string;
  githubWebhookSecret: string;
};

const emptyGithubSettings: GitHubSettingsStatus = {
  status: {
    appConfigured: false,
    connected: false,
    installationCount: 0,
    installed: false,
    installUrl: null,
    mode: "none"
  },
  statusError: "",
  settings: {
    githubAccessTokenSuffix: "",
    githubAppId: "",
    githubAppClientId: "",
    githubAppSlug: "",
    githubAppPrivateKeyConfigured: false,
    githubWebhookSecretSuffix: "",
    envPath: ""
  }
};

function formFromSettings(settings: GitHubSettingsStatus): GitHubFormState {
  return {
    githubAccessToken: settings.settings.githubAccessTokenSuffix ? `******${settings.settings.githubAccessTokenSuffix}` : "",
    githubAppId: settings.settings.githubAppId,
    githubAppClientId: settings.settings.githubAppClientId,
    githubAppSlug: settings.settings.githubAppSlug,
    githubAppPrivateKey: "",
    githubWebhookSecret: settings.settings.githubWebhookSecretSuffix ? `******${settings.settings.githubWebhookSecretSuffix}` : ""
  };
}

function modeLabel(settings: GitHubSettingsStatus) {
  if (settings.status.mode === "app") return settings.status.installed ? "GitHub App installed" : "GitHub App configured";
  if (settings.status.mode === "token") return "Access token connected";
  return "Not connected";
}

export function GitHubSettingsPanel({ open }: { open: boolean }) {
  const [github, setGithub] = useState<GitHubSettingsStatus>(emptyGithubSettings);
  const [form, setForm] = useState<GitHubFormState>(() => formFromSettings(emptyGithubSettings));
  const [editing, setEditing] = useState(false);
  const [manualConfigurationOpen, setManualConfigurationOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const connected = github.status.connected || github.status.installed || github.status.mode === "token";
  const appConfigured = github.status.appConfigured || Boolean(github.settings.githubAppId || github.settings.githubAppPrivateKeyConfigured);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setSuccess("");

    void api.githubSettings()
      .then((result) => {
        if (cancelled) return;
        setGithub(result);
        setForm(formFromSettings(result));
        setEditing(!result.status.connected && !result.status.installed && result.status.mode !== "token");
        setManualConfigurationOpen(false);
        setDisconnecting(false);
      })
      .catch((issue) => {
        if (!cancelled) setError(issue instanceof Error ? issue.message : "Could not load GitHub settings");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await api.updateGithubSettings({
        githubAccessToken: form.githubAccessToken,
        githubAppId: form.githubAppId,
        githubAppClientId: form.githubAppClientId,
        githubAppSlug: form.githubAppSlug,
        githubAppPrivateKey: form.githubAppPrivateKey,
        githubWebhookSecret: form.githubWebhookSecret
      });
      setGithub(result);
      setForm(formFromSettings(result));
      setEditing(false);
      setManualConfigurationOpen(false);
      setDisconnecting(false);
      setSuccess(result.statusError ? `GitHub settings saved. ${result.statusError}` : "GitHub settings saved.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save GitHub settings");
    } finally {
      setBusy(false);
    }
  }

  async function connectOneClick() {
    setConnecting(true);
    setError("");
    setSuccess("");

    try {
      const result = await startGitHubAppManifestFlow({ redirectTo: "settings" });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const refreshed = await api.githubSettings();
      setGithub(refreshed);
      setForm(formFromSettings(refreshed));
      setEditing(false);
      setManualConfigurationOpen(false);
      setDisconnecting(false);
      setSuccess("GitHub App created and connected. Install it on your repositories to finish.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not connect to GitHub");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await api.disconnectGithub();
      setGithub(result);
      setForm(formFromSettings(result));
      setEditing(true);
      setManualConfigurationOpen(false);
      setDisconnecting(false);
      setSuccess("GitHub configuration removed.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not disconnect GitHub");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl overflow-hidden border border-white/10 bg-black">
      {!editing ? (
        <div className="p-5 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-4">
              <AppIcon icon={GithubIcon} size={32} className="shrink-0 text-white" />
              <div>
                <h2 className="text-2xl tracking-[-0.03em] text-white">{modeLabel(github)}</h2>
                <div className="mt-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em]">
                  <span
                    className={`h-1.5 w-1.5 ${
                      connected
                        ? "bg-emerald-400"
                        : appConfigured
                          ? "bg-amber-400"
                          : "border border-zinc-600"
                    }`}
                  />
                  <span className={connected ? "text-emerald-300" : appConfigured ? "text-amber-300" : "text-zinc-500"}>
                    {connected ? "Connected" : appConfigured ? "Needs install" : "Not configured"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center border border-white/15 text-zinc-400 transition hover:border-white/35 hover:bg-white/[0.06] hover:text-white"
                onClick={() => {
                  setEditing(true);
                  setManualConfigurationOpen(false);
                }}
                title="Edit GitHub settings"
                aria-label="Edit GitHub settings"
              >
                <AppIcon icon={PencilEdit02Icon} size={15} />
              </button>
              {connected || appConfigured ? (
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center border border-white/15 text-zinc-500 transition hover:border-rose-400/60 hover:bg-rose-400/10 hover:text-rose-300"
                  onClick={() => setDisconnecting(true)}
                  title="Disconnect GitHub"
                  aria-label="Disconnect GitHub"
                >
                  <AppIcon icon={Delete02Icon} size={15} />
                </button>
              ) : null}
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-sm leading-6 text-zinc-500">
            GitHub provides repository access, branch discovery, and deployment webhooks.
          </p>

          <div className="mt-7 max-w-2xl border-y border-white/10">
            <div className="grid gap-2 border-b border-white/10 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">Mode</div>
              <div className="text-sm capitalize text-zinc-300">{github.status.mode}</div>
            </div>
            <div className="grid gap-2 border-b border-white/10 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">Installations</div>
              <div className="text-sm text-zinc-300">{github.status.installationCount}</div>
            </div>
          </div>

          {github.status.mode === "app" && github.status.installUrl ? (
            <a
              href={github.status.installUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex min-h-10 w-fit items-center justify-center gap-2 bg-white px-4 text-sm text-black transition hover:bg-zinc-200"
            >
              <AppIcon icon={GithubIcon} size={15} />
              {github.status.installed ? "Install on another account" : "Install GitHub App"}
            </a>
          ) : null}

          {disconnecting ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-l-2 border-rose-400 bg-rose-400/10 px-4 py-3">
              <div>
                <div className="text-sm text-rose-100">Disconnect GitHub?</div>
                <div className="mt-1 text-xs text-rose-200/70">Repository browsing and webhooks will stop.</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center border border-rose-400/50 text-rose-200 transition hover:bg-rose-400/10"
                  onClick={() => void disconnect()}
                  disabled={busy}
                  title="Confirm disconnect"
                  aria-label="Confirm disconnect"
                >
                  <AppIcon icon={CheckmarkCircle02Icon} size={16} />
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center border border-white/15 text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05]"
                  onClick={() => setDisconnecting(false)}
                  disabled={busy}
                  title="Cancel"
                  aria-label="Cancel"
                >
                  <AppIcon icon={Cancel01Icon} size={16} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <form onSubmit={saveSettings} className="p-5 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-4">
              <AppIcon icon={GithubIcon} size={32} className="shrink-0 text-white" />
              <div>
                <h2 className="text-2xl tracking-[-0.03em] text-white">Configure GitHub</h2>
                <p className="mt-1.5 text-sm text-zinc-500">Connect with a GitHub App or enter credentials manually.</p>
              </div>
            </div>
            {connected || appConfigured ? (
              <button
                type="button"
                className="inline-flex min-h-10 w-fit items-center justify-center border border-white/15 px-4 text-sm text-zinc-400 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white"
                onClick={() => {
                  setForm(formFromSettings(github));
                  setManualConfigurationOpen(false);
                  setEditing(false);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            ) : null}
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-y border-white/10 py-5">
            <div className="min-w-0">
              <div className="text-sm text-zinc-200">Connect automatically</div>
              <div className="mt-1 text-xs text-zinc-500">Create and configure the GitHub App in one step.</div>
            </div>
            <button
              type="button"
              onClick={() => void connectOneClick()}
              disabled={connecting || busy}
              className="inline-flex min-h-10 w-fit items-center justify-center gap-2 bg-white px-4 text-sm text-black transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-50"
            >
              <AppIcon icon={GithubIcon} size={15} />
              {connecting ? "Connecting…" : "Connect with GitHub"}
            </button>
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 border-b border-white/10 py-5 text-left text-sm text-zinc-300 transition hover:text-white"
            onClick={() => setManualConfigurationOpen((current) => !current)}
            aria-expanded={manualConfigurationOpen}
          >
            <span>Manual configuration</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
              {manualConfigurationOpen ? "Hide" : "Open"}
            </span>
          </button>

          {manualConfigurationOpen ? (
            <div className="max-w-xl pt-6">
              <a
                href="https://github.com/settings/apps/new"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 w-fit items-center justify-center gap-2 border border-white/15 px-3.5 text-sm text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05] hover:text-white"
              >
                <AppIcon icon={LinkSquare02Icon} size={14} />
                Create GitHub App
              </a>

              <div className="mt-6 grid gap-5">
                <div>
                  <FieldLabel>GITHUB_ACCESS_TOKEN</FieldLabel>
                  <FormInput
                    type="password"
                    value={form.githubAccessToken}
                    onChange={(event) => setForm({ ...form, githubAccessToken: event.target.value })}
                    placeholder="GitHub personal access token"
                    autoComplete="off"
                    variant="monochrome"
                    className="border-white/15 bg-white/[0.03]"
                  />
                </div>
                <div>
                  <FieldLabel>GITHUB_WEBHOOK_SECRET</FieldLabel>
                  <FormInput
                    type="password"
                    value={form.githubWebhookSecret}
                    onChange={(event) => setForm({ ...form, githubWebhookSecret: event.target.value })}
                    placeholder="Webhook secret"
                    autoComplete="off"
                    variant="monochrome"
                    className="border-white/15 bg-white/[0.03]"
                  />
                </div>
                <div>
                  <FieldLabel>GITHUB_APP_ID</FieldLabel>
                  <FormInput
                    value={form.githubAppId}
                    onChange={(event) => setForm({ ...form, githubAppId: event.target.value })}
                    placeholder="123456"
                    variant="monochrome"
                    className="border-white/15 bg-white/[0.03]"
                  />
                </div>
                <div>
                  <FieldLabel>GITHUB_APP_CLIENT_ID</FieldLabel>
                  <FormInput
                    value={form.githubAppClientId}
                    onChange={(event) => setForm({ ...form, githubAppClientId: event.target.value })}
                    placeholder="Iv1.xxxxx"
                    variant="monochrome"
                    className="border-white/15 bg-white/[0.03]"
                  />
                </div>
                <div>
                  <FieldLabel>GITHUB_APP_SLUG</FieldLabel>
                  <FormInput
                    value={form.githubAppSlug}
                    onChange={(event) => setForm({ ...form, githubAppSlug: event.target.value })}
                    placeholder="aeroplane"
                    variant="monochrome"
                    className="border-white/15 bg-white/[0.03]"
                  />
                </div>
                <div>
                  <FieldLabel>GITHUB_APP_PRIVATE_KEY</FieldLabel>
                  <textarea
                    value={form.githubAppPrivateKey}
                    onChange={(event) => setForm({ ...form, githubAppPrivateKey: event.target.value })}
                    placeholder={github.settings.githubAppPrivateKeyConfigured ? "Leave blank to keep current private key" : "-----BEGIN PRIVATE KEY-----"}
                    className="min-h-32 w-full resize-y border border-white/15 bg-white/[0.03] px-3 py-3 font-mono text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white focus:ring-2 focus:ring-white/10"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-zinc-500">
                Leave masked secrets unchanged to keep existing values.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  className="inline-flex min-h-10 w-fit items-center justify-center bg-white px-4 text-sm text-black transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-50"
                  disabled={busy}
                >
                  {busy ? "Saving..." : "Save GitHub settings"}
                </button>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}

      {github.statusError || error || success ? (
        <div className="border-t border-white/10 px-5 pb-5 sm:px-7 sm:pb-7 lg:px-8 lg:pb-8">
          {github.statusError ? (
            <div className="mt-5 border-l-2 border-amber-400 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              {github.statusError}
            </div>
          ) : null}
          {error ? (
            <div className="mt-5 border-l-2 border-rose-400 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="mt-5 flex items-center gap-2 border-l-2 border-emerald-400 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
              <AppIcon icon={CheckmarkCircle02Icon} size={14} />
              {success}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

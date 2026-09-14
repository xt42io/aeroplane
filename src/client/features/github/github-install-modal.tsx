import { GithubIcon } from "@hugeicons/core-free-icons";
import type { GitHubStatus } from "../../api";
import { ModalShell } from "../../components/modals/modal-shell";
import { AppIcon, shellButton } from "../../components/ui/primitives";

export function GitHubInstallModal({
  open,
  status,
  onClose
}: {
  open: boolean;
  status: null | GitHubStatus;
  onClose: () => void;
}) {
  if (!open || !status || status.mode !== "app" || !status.installUrl) {
    return null;
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      icon={GithubIcon}
      title={status.installed ? "Add GitHub account" : "Install GitHub App"}
      meta={
        status.installed
          ? "Repos from every connected account or organization show up together when creating a service."
          : "Connect the app to at least one repository before creating a service."
      }
      width="max-w-2xl"
    >
      <div className="space-y-5">
        <div className="border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm leading-6 text-zinc-300">
          {status.installed
            ? "Install the app on another GitHub account or organization to browse and deploy from its repositories too."
            : "The server is configured, but the GitHub App is not installed on any repositories yet. Install it once, then new services can browse repos, pick branches, and choose deployment directories directly."}
        </div>
        <div className="flex justify-end">
          <a href={status.installUrl} target="_blank" rel="noreferrer" className={shellButton("primary")}>
            <AppIcon icon={GithubIcon} size={16} />
            {status.installed ? "Install on another account" : "Install GitHub App"}
          </a>
        </div>
      </div>
    </ModalShell>
  );
}

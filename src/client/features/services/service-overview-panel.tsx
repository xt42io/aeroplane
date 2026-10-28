import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DatabaseIcon,
  FunctionIcon,
  GithubIcon,
  PackageIcon,
  Settings01Icon,
  VariableIcon
} from "@hugeicons/core-free-icons";
import type { Deployment, Domain, EnvVar, Service } from "../../api";
import { DeployPlaneIcon } from "../../components/icons/deploy-plane-icon";
import { AppIcon, FrameworkMark } from "../../components/ui/primitives";
import { deploymentIsPending, displayDeploymentStatus } from "../../lib/deployment-status";
import { formatRelativeTime, formatTime, shortSha } from "../../lib/format";
import { formatBuildDuration } from "./service-format";
import type { ServiceTab } from "./service-tabs";
import { dockerImageForService, isDockerImageService } from "../../../shared/service-source";
import { functionRuntimeLabels, isFunctionService } from "../../../shared/service-functions";
import { DatabaseConnectionOverview } from "./database-connection-overview";

type ServiceOverviewPanelProps = {
  service: Service;
  deployments: Deployment[];
  env: EnvVar[];
  domains: Domain[];
  pageServices: Service[];
  isDatabase: boolean;
  databaseEngine: string;
  busy: string;
  nowMs: number;
  onDeploy: () => void;
  onTabChange: (tab: ServiceTab) => void;
};

type OverviewStatProps = {
  label: string;
  value: string;
  meta?: string;
};

function repoLabel(service: Service, isDatabase: boolean, databaseEngine: string) {
  if (isDatabase) return databaseEngine ? `${databaseEngine} database` : "database";
  if (isFunctionService(service)) return `${functionRuntimeLabels[service.functionRuntime ?? "node"]} function`;
  if (isDockerImageService(service)) return service.dockerImage || dockerImageForService(service) || "Docker image";
  return service.repoFullName ?? service.repoUrl.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

function serviceLink(service: Service, isDatabase: boolean) {
  if (isDatabase) {
    if (service.databaseConnection) return { label: `${service.databaseConnection.host}:${service.databaseConnection.port}`, href: "" };
    const publicHost = service.databasePublicEnabled && service.databasePublicHostname
      ? `${service.databasePublicHostname}:${service.hostPort}`
      : "";
    return {
      label: publicHost || `${service.slug}:${service.internalPort}`,
      href: ""
    };
  }

  if (service.runtimeMode === "worker") {
    return {
      label: "Background worker",
      href: ""
    };
  }

  const href = service.primaryUrl || service.localUrl;
  return {
    label: href ? href.replace(/^https?:\/\//, "") : "No service link",
    href
  };
}

function valueOrAuto(value: null | string) {
  return value?.trim() || "auto";
}

function buildMethodLabel(service: Service) {
  const dockerfile = service.dockerfilePath?.trim() || "Dockerfile";
  if (service.buildMethod === "dockerfile") return dockerfile;
  if (service.buildMethod === "railpack") return "Railpack";
  if (service.detectedBuildMethod === "dockerfile") return `${dockerfile} (detected)`;
  if (service.detectedBuildMethod === "railpack") return "Railpack (detected)";
  return "auto";
}

function linkedServiceSlugs(env: EnvVar[]) {
  const slugs = new Set<string>();
  const referenceRegex = /\${([a-zA-Z0-9_.-]+)\.[a-zA-Z0-9_.-]+}/g;

  for (const item of env) {
    const source = `${item.value ?? ""}\n${item.resolvedValue ?? ""}`;
    for (const match of source.matchAll(referenceRegex)) {
      if (match[1]) slugs.add(match[1]);
    }
  }

  return slugs;
}

function warningItems({
  service,
  deployments,
  env,
  domains,
  isDatabase,
  isDockerImage
}: {
  service: Service;
  deployments: Deployment[];
  env: EnvVar[];
  domains: Domain[];
  isDatabase: boolean;
  isDockerImage: boolean;
}) {
  const warnings: string[] = [];
  const latest = deployments[0];
  const isWorker = service.runtimeMode === "worker";
  const isFunction = isFunctionService(service);

  if (!latest) warnings.push("No deployment has run yet.");
  if (latest?.status === "failed") warnings.push("Latest deployment failed.");
  if (!service.reachable && !deploymentIsPending(service.status)) warnings.push("Runtime is not reachable.");
  if (!isDatabase && !isWorker && domains.some((domain) => domain.status !== "active")) warnings.push("One or more domains still need DNS verification.");
  if (!isDatabase && !isDockerImage && !isFunction && !service.repoFullName && !service.repoUrl) warnings.push("No source repository is connected.");

  return warnings;
}

function OverviewStat({ label, value, meta }: OverviewStatProps) {
  return (
    <div className="min-w-0 py-1">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">{label}</div>
      <div className="mt-1.5 truncate text-sm text-zinc-200">{value}</div>
      {meta ? <div className="mt-1 truncate text-xs text-zinc-600">{meta}</div> : null}
    </div>
  );
}

function SectionHeader({ icon, title, meta }: { icon: unknown; title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <AppIcon icon={icon} size={15} className="text-zinc-500" />
        <h3 className="truncate text-sm text-zinc-200">{title}</h3>
      </div>
      {meta ? <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">{meta}</span> : null}
    </div>
  );
}

function DefinitionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 border-b border-white/10 py-2.5 last:border-b-0 sm:grid-cols-[130px_minmax(0,1fr)]">
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="min-w-0 truncate font-mono text-xs text-zinc-200">{value}</div>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const tone =
    status === "active" || status === "running" || status === "deployed" || status === "success"
      ? { text: "text-emerald-300", dot: "bg-emerald-400" }
      : status === "building" || status === "queued"
        ? { text: "text-amber-300", dot: "animate-pulse bg-amber-400" }
        : status === "failed" || status === "crashed"
          ? { text: "text-rose-300", dot: "bg-rose-400" }
          : { text: "text-zinc-500", dot: "bg-zinc-600" };

  return (
    <span className={`inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] ${tone.text}`}>
      <span className={`h-1.5 w-1.5 ${tone.dot}`} />
      {status}
    </span>
  );
}

export function ServiceOverviewPanel({
  service,
  deployments,
  env,
  domains,
  pageServices,
  isDatabase,
  databaseEngine,
  busy,
  nowMs,
  onDeploy,
  onTabChange
}: ServiceOverviewPanelProps) {
  if (service.databaseConnection) return <DatabaseConnectionOverview service={service} busy={busy === "deploy"} onCheck={onDeploy} onTabChange={onTabChange} />;
  const latestDeployment = deployments[0] ?? null;
  const latestStatus = latestDeployment ? displayDeploymentStatus(latestDeployment.status) : "none";
  const latestDuration = latestDeployment
    ? formatBuildDuration(latestDeployment.startedAt ?? latestDeployment.createdAt, latestDeployment.finishedAt, nowMs)
    : null;
  const isDockerImage = isDockerImageService(service);
  const isFunction = isFunctionService(service);
  const isWorker = service.runtimeMode === "worker";
  const rootDir = service.rootDir || ".";
  const sourceLabel = repoLabel(service, isDatabase, databaseEngine);
  const sourceMeta = isDatabase ? "Managed database" : isFunction ? "Function source" : isWorker ? "Background worker" : isDockerImage ? "Docker image" : service.branch;
  const link = serviceLink(service, isDatabase);
  const warnings = warningItems({ service, deployments, env, domains, isDatabase, isDockerImage });
  const linkedSlugs = linkedServiceSlugs(env);
  const linkedServices = pageServices.filter((candidate) => candidate.id !== service.id && linkedSlugs.has(candidate.slug));

  return (
    <div className="space-y-4 pb-6">
      <section className="overflow-hidden border border-white/10 bg-black">
        <header className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center border border-white/15 bg-white/[0.03] p-2">
              <FrameworkMark framework={service.framework} size={22} fallback={<AppIcon icon={isDatabase ? DatabaseIcon : isFunction ? FunctionIcon : isDockerImage ? PackageIcon : GithubIcon} size={19} className="text-zinc-300" />} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="truncate text-xl tracking-[-0.03em] text-zinc-100">{service.name}</h2>
                <StatusIndicator status={displayDeploymentStatus(service.status)} />
              </div>
              {link.href ? (
                <a className="mt-1 block truncate text-xs text-zinc-500 transition hover:text-white" href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ) : (
                <div className="mt-1 truncate font-mono text-[10px] text-zinc-600">{link.label}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-fit items-center justify-center gap-2 bg-white px-4 text-sm text-black transition hover:bg-zinc-200 disabled:opacity-50"
            onClick={onDeploy}
            disabled={busy === "deploy"}
          >
            <DeployPlaneIcon size={14} />
            {service.databaseConnection ? busy === "deploy" ? "Checking…" : "Check connection" : busy === "deploy" ? "Deploying…" : "Deploy"}
          </button>
        </header>

        <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewStat label="Source" value={sourceLabel} meta={sourceMeta} />
              <OverviewStat label="Last deploy" value={service.lastDeployedAt ? formatRelativeTime(service.lastDeployedAt) : "Never"} meta={formatTime(service.lastDeployedAt)} />
              <OverviewStat label="Environment" value={`${env.length} variable${env.length === 1 ? "" : "s"}`} meta={env.length ? "Configured for deploy" : "No variables yet"} />
              <OverviewStat
                label={isDatabase ? "Engine" : isWorker ? "Mode" : "App port"}
                value={isDatabase ? databaseEngine || "database" : isWorker ? "Worker" : String(service.internalPort)}
                meta={isDatabase ? `Internal ${service.internalPort}` : isWorker ? "Process health" : `Host ${service.hostPort}`}
              />
        </div>
      </section>

      {warnings.length > 0 ? (
        <section className="border-l-2 border-amber-400 bg-amber-400/[0.08] px-4 py-3">
          <div className="grid gap-2 md:grid-cols-2">
            {warnings.map((warning) => (
              <div key={warning} className="flex items-center gap-2 text-sm text-amber-200">
                <AppIcon icon={Alert02Icon} size={14} className="shrink-0 text-amber-300" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="border-l-2 border-emerald-400 bg-emerald-400/[0.07] px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-200">
            <AppIcon icon={CheckmarkCircle02Icon} size={15} className="text-emerald-300" />
            <span>Service health looks good.</span>
          </div>
        </section>
      )}

      <section className="border border-white/10 bg-black">
        <SectionHeader icon={PackageIcon} title="Latest Deployment" meta={latestStatus} />
        {latestDeployment ? (
          <div>
            <div className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-3">
              <OverviewStat label="Status" value={latestStatus} meta={latestDeployment.trigger} />
              <OverviewStat label={isDockerImage ? "Image" : "Commit"} value={isDockerImage ? latestDeployment.imageTag ?? sourceLabel : shortSha(latestDeployment.commitSha)} meta={isDockerImage ? latestDeployment.trigger : latestDeployment.imageTag ?? "image pending"} />
              <OverviewStat label="Duration" value={latestDuration ?? "Unknown"} meta={formatTime(latestDeployment.createdAt)} />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-3">
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center border border-white/15 px-3 text-xs text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05]"
                onClick={() => onTabChange("deployments")}
              >
                View deploy output
              </button>
              {latestDeployment.status === "failed" ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center bg-white px-3 text-xs text-black transition hover:bg-zinc-200 disabled:opacity-50"
                  onClick={onDeploy}
                  disabled={busy === "deploy"}
                >
                  Redeploy
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-zinc-600">No deployments yet.</div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="border border-white/10 bg-black">
          <SectionHeader icon={VariableIcon} title="Environment Readiness" />
          <div className="space-y-3 p-4">
            <OverviewStat label="Configured" value={`${env.length} variable${env.length === 1 ? "" : "s"}`} meta={env.length ? `${env.filter((item) => item.hasValue).length} with values` : "No variables yet"} />
            <div className="flex flex-wrap gap-2">
              {env.slice(0, 8).map((item) => (
                <span key={item.id} className="border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-400">
                  {item.key}
                </span>
              ))}
              {env.length > 8 ? <span className="border border-white/10 px-2 py-1 font-mono text-[9px] text-zinc-500">+{env.length - 8}</span> : null}
            </div>
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center border border-white/15 px-3 text-xs text-zinc-300 transition hover:border-white/35 hover:bg-white/[0.05]"
              onClick={() => onTabChange("environment")}
            >
              Edit variables
            </button>
          </div>
        </section>

        <section className="border border-white/10 bg-black">
          <SectionHeader icon={Settings01Icon} title="Runtime Config" />
          <div className="px-4 py-1.5">
          {isDatabase ? (
            <div>
              <DefinitionRow label="Engine" value={databaseEngine || "database"} />
              <DefinitionRow label="Internal port" value={String(service.internalPort)} />
              <DefinitionRow label="Host port" value={String(service.hostPort)} />
              <DefinitionRow label="Public access" value={service.databasePublicEnabled ? "Enabled" : "Disabled"} />
            </div>
          ) : isDockerImage ? (
            <div>
              <DefinitionRow label="Mode" value={isWorker ? "Background worker" : "Web service"} />
              <DefinitionRow label="Docker image" value={sourceLabel} />
              {!isWorker ? <DefinitionRow label="Internal port" value={String(service.internalPort)} /> : null}
              {!isWorker ? <DefinitionRow label="Host port" value={String(service.hostPort)} /> : null}
            </div>
          ) : (
            <div>
              <DefinitionRow label="Mode" value={isDatabase ? "Database" : isWorker ? "Background worker" : "Web service"} />
              <DefinitionRow label="Root directory" value={rootDir} />
              {!isDatabase ? <DefinitionRow label="Builder" value={buildMethodLabel(service)} /> : null}
              <DefinitionRow label="Install" value={valueOrAuto(service.installCommand)} />
              <DefinitionRow label="Prebuild" value={service.prebuildCommand?.trim() || "none"} />
              <DefinitionRow label="Build" value={valueOrAuto(service.buildCommand)} />
              <DefinitionRow label="Start" value={valueOrAuto(service.startCommand)} />
              {!isWorker ? <DefinitionRow label="Static output" value={valueOrAuto(service.staticOutput)} /> : null}
            </div>
          )}
          </div>
        </section>

        <section className="border border-white/10 bg-black">
          <SectionHeader icon={DatabaseIcon} title="Linked Services" meta={`${linkedServices.length}`} />
          {linkedServices.length > 0 ? (
            <div className="divide-y divide-white/10 px-4">
              {linkedServices.map((linkedService) => (
                <div key={linkedService.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center p-1.5">
                      <FrameworkMark framework={linkedService.framework} size={16} fallback={<AppIcon icon={DatabaseIcon} size={14} className="text-zinc-400" />} />
                    </span>
                    <span className="truncate text-sm text-zinc-200">{linkedService.name}</span>
                  </div>
                  <StatusIndicator status={displayDeploymentStatus(linkedService.status)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-sm leading-6 text-zinc-600">
              No <code className="font-mono text-zinc-400">{"${service.variable}"}</code> references detected in this service’s variables.
            </div>
          )}
        </section>
      </div>

      <section className="border border-white/10 bg-black">
        <SectionHeader icon={Clock01Icon} title="Recent Activity" meta={`${deployments.length} deployments`} />
        {deployments.length > 0 ? (
          <div className="divide-y divide-white/10 px-4">
            {deployments.slice(0, 5).map((deployment) => (
              <div key={deployment.id} className="grid gap-3 py-3 md:grid-cols-[120px_minmax(0,1fr)_120px_110px] md:items-center">
                <StatusIndicator status={displayDeploymentStatus(deployment.status)} />
                <div className="min-w-0 truncate font-mono text-xs text-zinc-300">{isDockerImage ? deployment.imageTag ?? sourceLabel : shortSha(deployment.commitSha)}</div>
                <div className="font-mono text-xs text-zinc-500">{deployment.trigger}</div>
                <div className="font-mono text-xs text-zinc-500">{formatRelativeTime(deployment.createdAt)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-zinc-600">No deployment activity yet.</div>
        )}
      </section>
    </div>
  );
}

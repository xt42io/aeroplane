// Docker repository components permit dots, underscores and hyphens only in
// particular combinations. Preserve the deployment engine's existing naming.
function normalizeDockerSeparators(value: string) {
  return value.replace(/[._-]+/g, (separator) => {
    if (/^-+$/.test(separator) || separator === "_" || separator === "__" || separator === ".") return separator;
    return "-";
  });
}

export function safeDockerIdentifier(value: string, fallback: string) {
  return normalizeDockerSeparators(value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-")).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || fallback;
}

export function safeSlug(value: string) {
  return safeDockerIdentifier(value, "app").slice(0, 48);
}

export function containerNameForService(serviceId: string) {
  return `deploy-${safeDockerIdentifier(serviceId, "service")}`;
}

export const postgisExtensions = ["postgis", "postgis_topology", "postgis_raster", "postgis_sfcgal", "postgis_tiger_geocoder"] as const;

export function assertPostgisImportCompatible(source: Record<string, string>, available: Record<string, string>) {
  for (const name of postgisExtensions) {
    if (!source[name]) continue;
    if (!available[name]) throw new Error(`The source uses ${name}, but this target image does not provide it. Create PostgreSQL with Include PostGIS enabled, or use a compatible PostGIS image.`);
    const sourceVersion = source[name].split(/[.-]/).slice(0, 3).map(Number);
    const targetVersion = available[name].split(/[.-]/).slice(0, 3).map(Number);
    for (let i = 0; i < 3; i++) {
      const targetPart = targetVersion[i] || 0;
      const sourcePart = sourceVersion[i] || 0;
      if (targetPart > sourcePart) break;
      if (targetPart < sourcePart) throw new Error(`The source uses ${name} ${source[name]}, newer than target ${available[name]}. Upgrade the target PostGIS image before importing.`);
    }
  }
}

export function skipPostgisExtensionEntry(line: string) {
  // Keep spatial tables and extension configuration data. Existing PostGIS
  // extensions cannot be dropped independently of their installed dependants.
  // The official image also installs tiger/topology and their fuzzystrmatch
  // dependency. Keep their schemas, while restoring the objects/data within them.
  const extensions = [...postgisExtensions, "fuzzystrmatch"];
  return extensions.some((name) => new RegExp(`\\b(?:EXTENSION - |COMMENT - EXTENSION )${name}(?:\\s|$)`).test(line.trim()))
    || /\b(?:SCHEMA - |COMMENT - SCHEMA )(?:tiger|topology)(?:\s|$)/.test(line.trim());
}

import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

const socialImage = "https://cdn.byteship.cloud/f/p_vId3Rhgf/og.png";

export default defineConfig({
  integrations: [
    starlight({
      title: "Aeroplane Docs",
      description:
        "Documentation for installing and running Aeroplane, a self-hosted deployment control plane for apps and databases.",
      favicon: "/favicon.svg",
      head: [
        { tag: "meta", attrs: { property: "og:image", content: socialImage } },
        { tag: "meta", attrs: { property: "og:image:alt", content: "Aeroplane docs preview" } },
        { tag: "meta", attrs: { name: "twitter:image", content: socialImage } },
        { tag: "meta", attrs: { name: "twitter:image:alt", content: "Aeroplane docs preview" } },
      ],
      customCss: ["./src/styles/docs.css"],
      disable404Route: true,
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/xt42io/aeroplane",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            "docs",
            "docs/getting-started/install",
            "docs/getting-started/onboarding",
            "docs/getting-started/first-project",
          ],
        },
        {
          label: "Core concepts",
          items: [
            "docs/core-concepts/architecture",
            "docs/core-concepts/projects-and-services",
          ],
        },
        {
          label: "Deployments",
          items: [
            "docs/deployments/source-services",
            "docs/deployments/docker-image-services",
            "docs/deployments/static-sites-and-workers",
            "docs/deployments/environment-variables",
            "docs/deployments/deployment-lifecycle",
          ],
        },
        {
          label: "Migration",
          items: [
            "docs/migration/railway-import",
            "docs/migration/aeroplane-bundles",
          ],
        },
        {
          label: "Databases",
          items: [
            "docs/databases/overview",
            "docs/databases/postgis",
            "docs/databases/data-browser",
            "docs/databases/data-imports",
            "docs/databases/public-access-and-tls",
          ],
        },
        {
          label: "Storage and backups",
          items: [
            "docs/storage-and-backups/r2-storage",
            "docs/storage-and-backups/database-backups",
            "docs/storage-and-backups/restore-and-download",
          ],
        },
        {
          label: "Operations",
          items: [
            "docs/operations/domains",
            "docs/operations/dns-providers",
            "docs/operations/system-maintenance",
            "docs/operations/system-updates",
            "docs/operations/troubleshooting",
          ],
        },
        {
          label: "Reference",
          items: [
            "docs/reference/system-settings",
            "docs/reference/api-access",
            "docs/reference/api-projects",
            "docs/reference/api-services",
            "docs/reference/api-deployments",
            "docs/reference/api-databases",
            "docs/reference/api-environment-and-domains",
          ],
        },
      ],
      components: {
        SiteTitle: "./src/components/docs-site-title.astro",
        ThemeSelect: "./src/components/docs-theme-select.astro",
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});

export type FrameworkIconCatalogEntry = {
  dependencyPrefixes?: string[];
  dependencies?: string[];
  name: string;
  search: string;
  slug: string;
  sourceUrl?: string;
  sourcePath?: string;
  titleAliases?: string[];
  website?: string;
};

export const FRAMEWORK_ICON_CATALOG: FrameworkIconCatalogEntry[] = [
  { slug: "nextjs", name: "Next.js", search: "Next.js", sourcePath: "nextjs_icon_dark.svg", dependencies: ["next"], website: "https://nextjs.org/" },
  { slug: "nuxt", name: "Nuxt", search: "Nuxt", sourcePath: "nuxt.svg", dependencies: ["nuxt"], website: "https://nuxt.com/" },
  { slug: "sveltekit", name: "SvelteKit", search: "Svelte", sourcePath: "svelte.svg", dependencies: ["@sveltejs/kit"], website: "https://kit.svelte.dev/" },
  { slug: "solidstart", name: "SolidStart", search: "SolidJS", sourcePath: "solidjs.svg", dependencies: ["@solidjs/start"], website: "https://start.solidjs.com/" },
  { slug: "remix", name: "Remix", search: "Remix", sourcePath: "remix_dark.svg", dependencies: ["@remix-run/dev", "@remix-run/react"], website: "https://remix.run/" },
  { slug: "astro", name: "Astro", search: "Astro", sourcePath: "astro-icon-dark.svg", dependencies: ["astro"], website: "https://astro.build/" },
  { slug: "tanstack", name: "TanStack", search: "TanStack", sourcePath: "tanstack.svg", dependencies: ["@tanstack/start", "@tanstack/react-start"], website: "https://tanstack.com/" },
  { slug: "expo", name: "Expo", search: "Expo", sourcePath: "expo.svg", dependencies: ["expo"], website: "https://expo.dev/" },
  { slug: "react-native", name: "React Native", search: "React", sourcePath: "react_light.svg", dependencies: ["react-native"], titleAliases: ["React"], website: "https://reactnative.dev/" },
  { slug: "vite", name: "Vite", search: "Vite", sourcePath: "vite.svg", dependencies: ["vite"], website: "https://vite.dev/" },
  { slug: "react", name: "React", search: "React", sourcePath: "react_light.svg", dependencies: ["react"], website: "https://react.dev/" },
  { slug: "vue", name: "Vue", search: "Vue", sourcePath: "vue.svg", dependencies: ["vue"], titleAliases: ["Vue.js"], website: "https://vuejs.org/" },
  { slug: "svelte", name: "Svelte", search: "Svelte", sourcePath: "svelte.svg", dependencies: ["svelte"], website: "https://svelte.dev/" },
  { slug: "angular", name: "Angular", search: "Angular", sourcePath: "angular.svg", dependencies: ["@angular/core"], website: "https://angular.dev/" },
  { slug: "qwik", name: "Qwik", search: "Qwik", sourcePath: "qwik.svg", dependencies: ["@builder.io/qwik"], website: "https://qwik.dev/" },
  { slug: "gatsby", name: "Gatsby", search: "Gatsby", sourcePath: "gatsby.svg", dependencies: ["gatsby"], website: "https://www.gatsbyjs.com/" },
  { slug: "ember", name: "Ember", search: "Ember", sourcePath: "ember.svg", dependencies: ["ember-source"], website: "https://emberjs.com/" },
  { slug: "redwoodjs", name: "RedwoodJS", search: "RedwoodJS", sourcePath: "redwoodjs.svg", dependencyPrefixes: ["@redwoodjs/"], website: "https://redwoodjs.com/" },
  { slug: "electron", name: "Electron", search: "Electron", sourcePath: "electron.svg", dependencies: ["electron"], website: "https://www.electronjs.org/" },
  { slug: "tauri", name: "Tauri", search: "Tauri", sourcePath: "tauri.svg", dependencies: ["@tauri-apps/api", "@tauri-apps/cli"], website: "https://tauri.app/" },
  { slug: "hono", name: "Hono", search: "Hono", sourcePath: "hono.svg", dependencies: ["hono"], dependencyPrefixes: ["@hono/"], website: "https://hono.dev/" },
  { slug: "elysia", name: "Elysia", search: "Elysia", sourcePath: "elysiajs.svg", dependencies: ["elysia"], dependencyPrefixes: ["@elysiajs/"], website: "https://elysiajs.com/" },
  { slug: "nestjs", name: "NestJS", search: "NestJS", sourcePath: "nestjs.svg", dependencies: ["@nestjs/core"], website: "https://nestjs.com/" },
  { slug: "fastify", name: "Fastify", search: "Fastify", sourcePath: "fastify_dark.svg", dependencies: ["fastify"], website: "https://fastify.dev/" },
  { slug: "express", name: "Express", search: "Express", sourcePath: "expressjs_dark.svg", dependencies: ["express"], website: "https://expressjs.com/" },
  { slug: "koa", name: "Koa", search: "Koa", sourceUrl: "https://cdn.simpleicons.org/koa/FFFFFF", dependencies: ["koa"], website: "https://koajs.com/" },
  { slug: "adonisjs", name: "AdonisJS", search: "AdonisJS", sourceUrl: "https://cdn.simpleicons.org/adonisjs/5A45FF", dependencyPrefixes: ["@adonisjs/"], website: "https://adonisjs.com/" },
  { slug: "strapi", name: "Strapi", search: "Strapi", sourcePath: "strapi.svg", dependencies: ["@strapi/strapi"], dependencyPrefixes: ["@strapi/"], website: "https://strapi.io/" },
  { slug: "payload", name: "Payload", search: "Payload", sourcePath: "payload_dark.svg", dependencies: ["payload"], website: "https://payloadcms.com/" },
  { slug: "prisma", name: "Prisma", search: "Prisma", sourcePath: "prisma_dark.svg", dependencies: ["prisma", "@prisma/client"], website: "https://www.prisma.io/" },
  { slug: "trpc", name: "tRPC", search: "tRPC", sourcePath: "trpc.svg", dependencies: ["@trpc/server", "@trpc/client"], dependencyPrefixes: ["@trpc/"], website: "https://trpc.io/" },
  { slug: "graphql", name: "GraphQL", search: "GraphQL", sourcePath: "graphql.svg", dependencies: ["graphql"], website: "https://graphql.org/" },
  { slug: "tailwindcss", name: "Tailwind CSS", search: "Tailwind CSS", sourcePath: "tailwindcss.svg", dependencies: ["tailwindcss"], website: "https://tailwindcss.com/" },
  { slug: "typescript", name: "TypeScript", search: "TypeScript", sourcePath: "typescript.svg", dependencies: ["typescript"], website: "https://www.typescriptlang.org/" },
  { slug: "nodejs", name: "Node.js", search: "Node.js", sourcePath: "nodejs.svg", dependencies: ["@types/node"], titleAliases: ["Node.js"], website: "https://nodejs.org/" },
  { slug: "bun", name: "Bun", search: "Bun", sourcePath: "bun.svg", dependencies: ["bun-types"], website: "https://bun.sh/" },
  { slug: "deno", name: "Deno", search: "Deno", sourcePath: "deno.svg", dependencies: ["@deno/shim-deno"], website: "https://deno.com/" },
  { slug: "vitest", name: "Vitest", search: "Vitest", sourcePath: "vitest.svg", dependencies: ["vitest"], website: "https://vitest.dev/" },
  { slug: "jest", name: "Jest", search: "Jest", sourcePath: "jest.svg", dependencies: ["jest"], website: "https://jestjs.io/" },
  { slug: "playwright", name: "Playwright", search: "Playwright", sourcePath: "playwright.svg", dependencies: ["@playwright/test", "playwright"], website: "https://playwright.dev/" },
  { slug: "laravel", name: "Laravel", search: "Laravel", sourcePath: "laravel.svg", website: "https://laravel.com/" },
  { slug: "django", name: "Django", search: "Django", sourcePath: "django.svg", website: "https://www.djangoproject.com/" },
  { slug: "flask", name: "Flask", search: "Flask", sourcePath: "flask-light.svg", website: "https://flask.palletsprojects.com/" },
  { slug: "spring", name: "Spring", search: "Spring", sourcePath: "spring.svg", website: "https://spring.io/" },
  { slug: "python", name: "Python", search: "Python", sourcePath: "python.svg", website: "https://www.python.org/" },
  { slug: "ruby", name: "Ruby", search: "Ruby", sourcePath: "ruby.svg", website: "https://www.ruby-lang.org/" },
  { slug: "php", name: "PHP", search: "PHP", sourcePath: "php_dark.svg", website: "https://www.php.net/" },
  { slug: "fiber", name: "Fiber", search: "Fiber", sourceUrl: "https://gofiber.io/img/logo-dark.svg", dependencies: ["github.com/gofiber/fiber/v2", "github.com/gofiber/fiber/v3"], website: "https://gofiber.io/" },
  { slug: "golang", name: "Go", search: "Go", sourcePath: "golang.svg", website: "https://go.dev/" },
  { slug: "rust", name: "Rust", search: "Rust", sourcePath: "rust.svg", website: "https://www.rust-lang.org/" },
  { slug: "java", name: "Java", search: "Java", sourcePath: "java.svg", website: "https://www.java.com/" },
  { slug: "dotnet", name: ".NET", search: ".NET", sourcePath: "dotnet.svg", website: "https://dotnet.microsoft.com/" },
  { slug: "docker", name: "Docker", search: "Docker", sourcePath: "docker.svg", website: "https://www.docker.com/" },
  { slug: "kubernetes", name: "Kubernetes", search: "Kubernetes", sourcePath: "kubernetes.svg", website: "https://kubernetes.io/" },
  { slug: "firebase", name: "Firebase", search: "Firebase", sourcePath: "firebase.svg", website: "https://firebase.google.com/" },
  { slug: "supabase", name: "Supabase", search: "Supabase", sourcePath: "supabase.svg", website: "https://supabase.com/" },
  { slug: "vercel", name: "Vercel", search: "Vercel", sourcePath: "vercel_dark.svg", website: "https://vercel.com/" },
  { slug: "netlify", name: "Netlify", search: "Netlify", sourcePath: "netlify.svg", website: "https://www.netlify.com/" }
];

export const DATABASE_ICON_CATALOG: FrameworkIconCatalogEntry[] = [
  { slug: "postgis", name: "PostgreSQL with PostGIS", search: "PostGIS", sourcePath: "postgresql.svg", titleAliases: ["PostGIS"], website: "https://postgis.net/" },
  { slug: "postgres", name: "PostgreSQL", search: "PostgreSQL", sourcePath: "postgresql.svg", titleAliases: ["PostgreSQL"], website: "https://www.postgresql.org/" },
  {
    slug: "timescale",
    name: "TimescaleDB",
    search: "TimescaleDB",
    sourceUrl: "https://assets.tigerdata.com/timescale-web/brand/tiger-data/flat-logos/logo-badge-yellow.svg",
    titleAliases: ["TimescaleDB", "Timescale", "Tiger Data"],
    website: "https://www.tigerdata.com/"
  },
  { slug: "mysql", name: "MySQL", search: "MySQL", sourcePath: "mysql-icon-dark.svg", titleAliases: ["MySQL"], website: "https://www.mysql.com/" },
  { slug: "redis", name: "Redis", search: "Redis", sourcePath: "redis.svg", titleAliases: ["Redis"], website: "https://redis.io/" },
  { slug: "mongodb", name: "MongoDB", search: "MongoDB", sourcePath: "mongodb-icon-dark.svg", titleAliases: ["MongoDB"], website: "https://www.mongodb.com/" },
  {
    slug: "clickhouse",
    name: "ClickHouse",
    search: "ClickHouse",
    sourceUrl: "https://cdn.simpleicons.org/clickhouse/FFCC01",
    titleAliases: ["ClickHouse"],
    website: "https://clickhouse.com/"
  }
];

export function frameworkIconEntryForSlug(slug: string) {
  return [...FRAMEWORK_ICON_CATALOG, ...DATABASE_ICON_CATALOG].find((entry) => entry.slug === slug) ?? null;
}

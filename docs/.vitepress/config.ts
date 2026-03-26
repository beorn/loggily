import { defineConfig } from "vitepress"

export default defineConfig({
  title: "Loggily",
  description: "Clarity without the clutter. Ergonomic unified logs, spans, and debugs for modern TypeScript.",
  base: "/loggily/",

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/loggily/logo.svg" }],
    ["script", { defer: "", src: "https://static.cloudflareinsights.com/beacon.min.js", "data-cf-beacon": '{"token": "26d824c9dc3a41a4aea222d9c42cf9fa"}' }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Loggily",

    nav: [
      { text: "Guide", link: "/guide/journey" },
      { text: "API", link: "/api/" },
      { text: "GitHub", link: "https://github.com/beorn/loggily" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "The Journey", link: "/guide/journey" },
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Why Loggily?", link: "/guide/why" },
          ],
        },
        {
          text: "Features",
          items: [
            { text: "Near-Zero Cost Logging", link: "/guide/zero-overhead" },
            { text: "Spans", link: "/guide/spans" },
            { text: "Worker Threads", link: "/guide/workers" },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "Benchmarks", link: "/guide/benchmarks" },
            { text: "Comparison", link: "/guide/comparison" },
            { text: "Conditional Logging Research", link: "/guide/conditional-logging-research" },
          ],
        },
        {
          text: "Migration",
          items: [
            { text: "From debug", link: "/guide/migration-from-debug" },
            { text: "From Pino", link: "/guide/migration-from-pino" },
            { text: "From Winston", link: "/guide/migration-from-winston" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "Logger", link: "/api/logger" },
            { text: "Configuration", link: "/api/configuration" },
            { text: "Tracing", link: "/api/tracing" },
            { text: "Context Propagation", link: "/api/context" },
            { text: "Writers", link: "/api/writers" },
            { text: "Worker Thread", link: "/api/worker" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/beorn/loggily" }],

    outline: { level: [2, 3] },

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright &copy; 2026 Bj&oslash;rn Stabell",
    },
  },
})

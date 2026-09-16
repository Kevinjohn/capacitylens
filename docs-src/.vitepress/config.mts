import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";
import { imageLightbox } from "./lightbox.mts";
import { BASE } from "./base.mjs";
import { generateDocumentationComponentId } from "./generateDocumentationComponentId.mts";
import { ports } from "../../scripts/ports.mjs";

// The docs site. Built with `pnpm run docs:build` into the committed docs/ folder.
// Each task track has its own ordered sidebar. The longest matching path is
// listed first where two tracks reuse an existing reference page.
// Escape closes an open screenshot lightbox. Opening, closing by click, and all
// the styling are pure CSS (see lightbox.mts); this one keystroke is the only
// part CSS cannot express, so it is the only script the standalone build keeps —
// hence the data-cl-keep marker that scripts/docs-standalone.mjs looks for.
//
// It is a pure enhancement, deliberately: it adds a way to close the lightbox
// and takes nothing away, so a reader with JavaScript off, or a copy of the
// pages that lost the script somewhere, still gets the click-to-close lightbox
// exactly as before. Inline rather than a bundle, because a separate .js file
// would be a network request the file:// build cannot rely on.
// Read measured source at build time; the generated page still contains this one inline script.
const escapeClosesLightbox = readFileSync(new URL("../../scripts/docs-lightbox.js", import.meta.url), "utf8").trimEnd();

// VitePress is Vite, so `docs:dev` would default to 5173 and `docs:preview` to 4173 — the exact
// ports the application dev server and the E2E suite bind. Writing documentation would then quietly
// block a test run in another worktree, and the collision surfaces as an unrelated E2E failure.
// Pin both to the documentation lane instead (scripts/ports.mjs).
const lanePorts = ports();

const usingSidebar = [
  {
    text: "Day-to-day usage",
    items: [
      { text: "Start here", link: "/using/" },
      { text: "Join your team", link: "/using/join-your-team" },
      { text: "Read the schedule", link: "/using/read-the-schedule" },
      { text: "Find available capacity", link: "/using/find-capacity" },
      { text: "Schedule work", link: "/using/schedule-work" },
      { text: "Change or remove work", link: "/using/change-work" },
      { text: "Record time off", link: "/using/record-time-off" },
      { text: "Application page tour", link: "/guide/application-pages" },
      { text: "Day-to-day FAQ", link: "/using/faq" },
    ],
  },
];

const ownerSidebar = [
  {
    text: "Owner setup",
    items: [
      { text: "Start here", link: "/owner/" },
      { text: "Create your company", link: "/owner/create-your-company" },
      { text: "Appoint an Admin", link: "/owner/appoint-an-admin" },
      { text: "Owner responsibilities", link: "/owner/responsibilities" },
      { text: "Roles and permissions", link: "/getting-started/roles-and-permissions" },
      { text: "Owner FAQ", link: "/owner/faq" },
    ],
  },
];

const adminSidebar = [
  {
    text: "Admin and settings",
    items: [
      { text: "Start here", link: "/admin/" },
      { text: "Invite teammates", link: "/admin/invite-teammates" },
      { text: "Add people to the schedule", link: "/admin/add-people" },
      { text: "Choose company settings", link: "/admin/company-settings" },
      { text: "Prepare clients and work", link: "/admin/prepare-work" },
      { text: "Make the first booking", link: "/admin/first-booking" },
      { text: "Ongoing administration", link: "/admin/ongoing-administration" },
      { text: "Admin FAQ", link: "/admin/faq" },
    ],
  },
];

const installationSidebar = [
  {
    text: "Technical installation",
    items: [
      { text: "Start here", link: "/installation/" },
      { text: "Choose how to install", link: "/getting-started/install" },
      { text: "Install with Docker", link: "/self-hosting/install-with-docker" },
      { text: "Install without Docker", link: "/self-hosting/install-without-docker" },
      {
        text: "Deploy on a managed VPS",
        link: "/self-hosting/managed-vps/",
        items: [
          { text: "Choose the release source", link: "/self-hosting/managed-vps/choose-the-release-source" },
          { text: "Create and build the site", link: "/self-hosting/managed-vps/create-and-build-the-site" },
          { text: "Configure the API and nginx", link: "/self-hosting/managed-vps/configure-the-api-and-nginx" },
          { text: "Deploy and upgrade safely", link: "/self-hosting/managed-vps/deploy-and-upgrade-safely" },
          { text: "Finish and hand over", link: "/self-hosting/managed-vps/finish-and-operate-the-installation" },
        ],
      },
      { text: "Configure the service", link: "/installation/configure-the-service" },
      { text: "Secure the connection", link: "/installation/secure-the-connection" },
      { text: "Verify and hand over", link: "/installation/verify-and-hand-over" },
      { text: "Installation FAQ", link: "/installation/faq" },
    ],
  },
];

const operationsSidebar = [
  {
    text: "Self-hosted operations",
    items: [
      { text: "Start here", link: "/operations/" },
      { text: "Backups and restore", link: "/self-hosting/backups-and-restore" },
      { text: "Upgrades", link: "/self-hosting/upgrades" },
      { text: "Monitoring and health checks", link: "/self-hosting/monitoring" },
      { text: "Configuration", link: "/self-hosting/configuration" },
      { text: "Company login", link: "/company-login/" },
      { text: "Ownership-transfer recovery", link: "/self-hosting/ownership-transfer-recovery" },
      { text: "When something goes wrong", link: "/self-hosting/incidents" },
      { text: "Operations FAQ", link: "/operations/faq" },
    ],
  },
];

const referenceSidebar = [
  {
    text: "Reference",
    items: [
      { text: "Glossary", link: "/reference/glossary" },
      { text: "Security and privacy", link: "/security/" },
      { text: "Privacy", link: "/security/privacy" },
      { text: "Reviews and compliance", link: "/security/reviews" },
      { text: "Threat model", link: "/security/threat-model" },
      { text: "OpenSSF Baseline assessment", link: "/security/OpenSSF-best-practices-dev" },
      { text: "Control inventories", link: "/security/control-inventories" },
      { text: "Development guide", link: "/reference/development" },
      { text: "Code conventions", link: "/reference/conventions" },
      { text: "Open source and contributing", link: "/open-source" },
    ],
  },
];

const introductionSidebar = [
  {
    text: "Start here",
    items: [
      { text: "What is CapacityLens?", link: "/getting-started/what-is-capacitylens" },
      { text: "Quick start", link: "/getting-started/quick-start" },
      { text: "Getting-started FAQ", link: "/getting-started/faq" },
    ],
  },
];

export default defineConfig({
  vue: {
    features: {
      componentIdGenerator: generateDocumentationComponentId,
    },
  },
  vite: {
    server: { port: lanePorts.docsDev, strictPort: true },
    preview: { port: lanePorts.docsPreview, strictPort: true },
  },
  head: [["script", { "data-cl-keep": "" }, escapeClosesLightbox]],
  title: "CapacityLens",
  description:
    "Documentation for CapacityLens — a self-hosted helicopter view of who is busy, free, or overworked, week by week.",
  lang: "en-GB",
  base: BASE,
  // Keep real .html extensions in links: the postbuild step (scripts/docs-standalone.mjs)
  // turns the build into standalone pages that open straight from disk, where
  // extensionless URLs would need a server to rewrite them.
  cleanUrls: false,
  // The built pages are a committed artifact in the repo-root docs/ folder,
  // not an ignored .vitepress/dist — rebuild with `pnpm run docs:build` after
  // editing anything under docs-src/.
  outDir: "../docs",
  // Off, because it cannot work in this build and was rendering as a defect:
  // VitePress emits `Last updated: <time datetime="…"></time>` and fills the
  // text in client-side, but docs-standalone.mjs strips every script — so each
  // page shipped a "Last updated:" label followed by nothing at all.
  //
  // It also made the build unreproducible: the baked timestamp is the last
  // commit touching that page's .md, so the same sources built on a CI runner
  // (where the checkout is shallow and every file maps to one ephemeral merge
  // commit) produced different bytes than the same build run locally. That is
  // what the docs workflow's freshness check exists to catch, and it cannot
  // distinguish a genuinely stale commit from this. Restoring the date means
  // rendering it at build time, not turning this back on.
  lastUpdated: false,

  // Deliberately light-only: plain white page, dark text, like classic docs sites.
  appearance: false,

  // Code blocks are the one dark element on the light page: terminals and code
  // read as terminals. The background/label colours to match live in
  // theme/custom.css (--vp-code-block-bg and friends).
  // Screenshots get a JavaScript-free click-to-enlarge lightbox; see lightbox.mts
  // for why it has to be build-time markup rather than a library.
  markdown: { theme: "github-dark", config: imageLightbox },

  // Internal records that live in docs-src/ but are not part of the site.
  srcExclude: ["STYLE.md", "sso-cutover-design.md", "account-boundary.md", "README.md"],

  themeConfig: {
    siteTitle: "CapacityLens",
    outline: { level: [2, 3], label: "On this page" },

    search: { provider: "local" },

    nav: [
      { text: "What is CapacityLens?", link: "/getting-started/what-is-capacitylens" },
      { text: "Quick start", link: "/getting-started/quick-start" },
      { text: "Choose your guide", link: "/#choose-your-guide" },
      { text: "GitHub", link: "https://github.com/Kevinjohn/capacitylens" },
    ],

    sidebar: {
      "/guide/settings": adminSidebar,
      "/using/": usingSidebar,
      "/guide/": usingSidebar,
      "/owner/": ownerSidebar,
      "/getting-started/set-up-your-company": ownerSidebar,
      "/getting-started/roles-and-permissions": ownerSidebar,
      "/getting-started/invite-your-team": adminSidebar,
      "/admin/": adminSidebar,
      "/installation/": installationSidebar,
      "/getting-started/install": installationSidebar,
      "/getting-started/try-the-demo": installationSidebar,
      "/self-hosting/managed-vps/": installationSidebar,
      "/self-hosting/install-with-docker": installationSidebar,
      "/self-hosting/install-without-docker": installationSidebar,
      "/operations/": operationsSidebar,
      "/self-hosting/": operationsSidebar,
      "/company-login/": operationsSidebar,
      "/reference/": referenceSidebar,
      "/security/": referenceSidebar,
      "/open-source": referenceSidebar,
      "/getting-started/": introductionSidebar,
    },

    docFooter: { prev: "Previous", next: "Next" },

    socialLinks: [{ icon: "github", link: "https://github.com/Kevinjohn/capacitylens" }],

    footer: {
      message: "CapacityLens is open source under AGPL-3.0.",
      copyright: "Screenshots are captured from the running app — see docs-src/STYLE.md in the repository.",
    },
  },
});

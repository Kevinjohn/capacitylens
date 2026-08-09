<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

// Builds a Home / Section / Page trail by finding the current page in the
// sidebar config, so the trail always matches the navigation structure.
const { page, theme } = useData();

interface Crumb {
  text: string;
  link?: string;
}

const crumbs = computed<Crumb[]>(() => {
  // page.relativePath is e.g. "self-hosting/backups-and-restore.md"
  const current = "/" + page.value.relativePath.replace(/\.md$/, "").replace(/(^|\/)index$/, "$1");
  if (current === "/") return [];

  const trail: Crumb[] = [{ text: "Home", link: withBase("/") }];
  const sidebar = theme.value.sidebar;
  if (Array.isArray(sidebar)) {
    for (const section of sidebar) {
      const match = (section.items ?? []).find(
        (item: { link?: string }) => item.link?.replace(/\/$/, "") === current.replace(/\/$/, ""),
      );
      if (match) {
        const first = section.items?.[0]?.link;
        trail.push({ text: section.text, link: first ? withBase(first) : undefined });
        if (match.text !== section.text) trail.push({ text: match.text });
        return trail;
      }
    }
  }
  trail.push({ text: page.value.title });
  return trail;
});
</script>

<template>
  <nav v-if="crumbs.length" class="breadcrumbs" aria-label="Breadcrumb">
    <ol>
      <li v-for="(crumb, i) in crumbs" :key="i">
        <a v-if="crumb.link && i < crumbs.length - 1" :href="crumb.link">{{ crumb.text }}</a>
        <span v-else aria-current="page">{{ crumb.text }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.breadcrumbs {
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
}
.breadcrumbs ol {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.breadcrumbs li {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--vp-c-text-2);
}
.breadcrumbs li + li::before {
  content: "/";
  color: var(--vp-c-text-3);
}
.breadcrumbs a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}
.breadcrumbs a:hover {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}
.breadcrumbs span[aria-current] {
  color: var(--vp-c-text-1);
  font-weight: 500;
}
</style>

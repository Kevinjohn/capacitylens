<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
import { BASE } from "../base.mjs";

/** Public address of the published guide; the offline copy reports the same page URL. */
const PUBLIC_SITE = `https://kevinjohn.github.io${BASE}`;
const FEEDBACK_FORM = "https://github.com/Kevinjohn/capacitylens/issues/new?template=documentation.yml";

const { page } = useData();

// Built from the route alone, so no local path, query string or account detail reaches the form.
const pageUrl = computed(
  () => PUBLIC_SITE + page.value.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, ".html"),
);
const href = computed(() => `${FEEDBACK_FORM}&page=${encodeURIComponent(pageUrl.value)}`);
</script>

<template>
  <p class="page-feedback">
    <a :href="href" target="_blank" rel="noopener">Report a problem with this page</a>
  </p>
</template>

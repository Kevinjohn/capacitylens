<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
import { SITE_URL } from "../base.mjs";

const FEEDBACK_FORM = "https://github.com/Kevinjohn/capacitylens/issues/new?template=documentation.yml";

const { page } = useData();

// Built from the route and the public site address, so the offline copy reports the public URL and
// no local path, query string or account detail reaches the form.
const pageUrl = computed(
  () => SITE_URL + page.value.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, ".html"),
);
const href = computed(() => `${FEEDBACK_FORM}&page=${encodeURIComponent(pageUrl.value)}`);
</script>

<template>
  <p class="page-feedback">
    <a :href="href" target="_blank" rel="noopener">Report a problem with this page</a>
  </p>
</template>

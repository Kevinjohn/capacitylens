// The standalone build writes docs as static pages opened from file://. Its postbuild step removes
// JavaScript bundles and ordinary scripts, while preserving explicitly marked data-cl-keep inline
// handlers. The lightbox markup and presentation must therefore work in CSS alone.
//
// A checkbox stores the open state without changing the URL or browser history. It also avoids
// VitePress's same-page hash handling, which does not re-evaluate :target after pushState. Adjacent
// checkbox, inline-image, and overlay siblings keep each screenshot bound to its own ID.
//
// The checkbox opens with Space but not Enter and cannot be deep-linked. Focus stays on it; Tab or
// clicking the overlay closes it. The overlay is not a modal, so it never traps focus or hides the
// article from assistive technology. The retained inline handler adds Escape and Tab closing.
//
// Both image copies use the same src so the browser reuses the download. The overlay image is
// decorative because the inline image already announces its alt text.

interface Token {
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
  children: Token[] | null;
  content: string;
}

interface Renderer {
  renderToken(tokens: Token[], idx: number, options: unknown): string;
  rules: Record<string, RenderRule | undefined>;
}

type RenderRule = (
  tokens: Token[],
  idx: number,
  options: unknown,
  env: unknown,
  self: Renderer,
) => string;

interface MarkdownItRenderer {
  renderer: Renderer;
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// IDs are counted per render environment so repeated renders keep page-local IDs stable.
// Without an environment, a separate counter could collide with another page, so the image stays inline.
const counters = new WeakMap<object, number>();

const incrementPageImageCounter = (env: unknown): number | null => {
  if (typeof env !== "object" || env === null) return null;
  const next = (counters.get(env) ?? 0) + 1;
  counters.set(env, next);
  return next;
};

/** Adds a CSS lightbox to eligible Markdown images while leaving linked or unidentifiable images inline. */
export function imageLightbox(md: MarkdownItRenderer): void {
  const renderToken: RenderRule = (tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options);

  const renderImage = md.renderer.rules.image ?? renderToken;
  const renderLinkOpen = md.renderer.rules.link_open ?? renderToken;
  const renderLinkClose = md.renderer.rules.link_close ?? renderToken;

  // Leave linked images unchanged because nesting an interactive label inside a link is invalid.
  // Track both Markdown link tokens and raw inline HTML anchors while rendering.
  const linkDepth = new WeakMap<object, number>();
  const depthOf = (env: unknown) =>
    typeof env === "object" && env !== null ? (linkDepth.get(env) ?? 0) : 0;
  const setDepth = (env: unknown, depth: number) => {
    if (typeof env === "object" && env !== null) linkDepth.set(env, depth);
  };

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    setDepth(env, depthOf(env) + 1);
    return renderLinkOpen(tokens, idx, options, env, self);
  };

  md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
    setDepth(env, Math.max(0, depthOf(env) - 1));
    return renderLinkClose(tokens, idx, options, env, self);
  };

  const renderHtmlInline = md.renderer.rules.html_inline ?? renderToken;

  md.renderer.rules.html_inline = (tokens, idx, options, env, self) => {
    const html = tokens[idx].content ?? "";
    const opened = (html.match(/<a[\s>]/gi) ?? []).length;
    const closed = (html.match(/<\/a\s*>/gi) ?? []).length;
    if (opened !== closed) setDepth(env, Math.max(0, depthOf(env) + opened - closed));
    return renderHtmlInline(tokens, idx, options, env, self);
  };

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const index = incrementPageImageCounter(env);

    // Defer below-fold screenshots, but load the first image eagerly because it is often the LCP element.
    // Apply lazy loading only to the inline copy; the hidden overlay copy is not fetched until opened.
    if (index !== 1) token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");

    const inline = renderImage(tokens, idx, options, env, self);

    // src is read after rendering, not before: VitePress's own image rule (the
    // one `renderImage` calls into) rewrites the token's src, `./`-prefixing
    // it and percent-decoding it, and that rewritten form is what Vue's
    // transformAssetUrls recognises as a bundled asset. Reading it first would
    // give the overlay the raw authored path, so a screenshot written without a
    // leading `./` would render inline but 404 in the enlarged view.
    const src = token.attrGet("src");
    if (depthOf(env) > 0 || src === null || index === null) return inline;

    const id = `cl-zoom-${index}`;

    // Keep the overlay image decorative so its alt text is announced only by the inline image.
    return (
      `<input type="checkbox" class="cl-toggle" id="${id}" aria-label="View this image full size">` +
      `<label class="cl-zoom" for="${id}">${inline}</label>` +
      `<label class="cl-lightbox" for="${id}">` +
      `<img src="${escapeAttr(src)}" alt="" decoding="async"></label>`
    );
  };
}

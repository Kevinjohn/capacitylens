// Click-to-enlarge for every screenshot in the docs, with no JavaScript.
//
// The shipped site in docs/ is a standalone build: scripts/docs-standalone.mjs
// deletes every <script> tag and every .js bundle so the pages open straight
// from disk. That rules out the usual lightbox libraries (GLightbox,
// medium-zoom and friends) — our own build would strip them back out. So the
// lightbox is pure CSS, and this markdown-it plugin emits the markup it needs
// at build time:
//
//   <input type="checkbox" class="cl-toggle" id="cl-zoom-1" aria-label="View this image full size">
//   <label class="cl-zoom" for="cl-zoom-1"><img src="…" alt="…"></label>   <- inline screenshot
//   <label class="cl-lightbox" for="cl-zoom-1"><img src="…" alt=""></label> <- overlay
//
// The three elements are adjacent siblings and the CSS matches them that way
// (`:checked + .cl-zoom + .cl-lightbox`), so two screenshots in one paragraph
// cannot open each other's overlay.
//
// The overlay is display:none until the checkbox is checked; both labels point
// at the same checkbox, so clicking the screenshot opens it and clicking
// anywhere on the overlay closes it. Styling lives in theme/custom.css.
//
// A checkbox rather than the more obvious :target/#hash trick, for two reasons:
//
//   1. History. With :target, opening pushes a history entry and closing pushes
//      a second one, so Back walks the reader back INTO the lightbox they just
//      closed — after three screenshots it takes six Backs to leave the page.
//      Checkbox state is not history at all, so Back does what it should.
//   2. VitePress's client router intercepts same-page hash links and moves the
//      hash with history.pushState, which does not re-evaluate :target — a hash
//      lightbox silently does nothing under `pnpm run docs:dev`. A checkbox
//      never involves the router, so the authoring preview matches the shipped
//      pages.
//
// The trade-off is that the control is a checkbox rather than a link: it is
// focusable and toggles with Space, but not with Enter, and it cannot be deep
// linked. Neither matters for "let me see that screenshot properly".
//
// Known keyboard limitation: opening leaves focus on the checkbox, so Space
// closes again — but the overlay is not a modal. Tabbing while it is open moves
// focus into the article behind the backdrop, where the focus ring cannot be
// seen, and there is no Escape binding. Both fixes (focus trapping, a key
// handler) need JavaScript, which the standalone build strips, so the escape
// hatch is Shift+Tab back to the checkbox and Space.
//
// Both <img> tags carry the same src, so the browser reuses the one download —
// the overlay shows the image at its natural size, which for our screenshots
// (1512–2560px wide) is well beyond the ~690px text column.

// markdown-it is not a direct dependency (VitePress bundles it), so there is no
// resolvable module to import types from. These are the pieces of its renderer
// this plugin actually touches.
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

// Ids only have to be unique within a page, and VitePress renders each page with
// its own `env` object, so counting against that keeps them stable across the
// server render and any later re-render of the same page. An image reaching the
// rule without an env would have to draw from a separate counter, which could
// collide with the per-page one and give two elements the same id — a duplicate
// `for`/`id` pair silently opens the wrong screenshot. Rather than risk that,
// such an image is left unwrapped (see below): no lightbox beats a wrong one.
const counters = new WeakMap<object, number>();

const pageCounter = (env: unknown): number | null => {
  if (typeof env !== "object" || env === null) return null;
  const next = (counters.get(env) ?? 0) + 1;
  counters.set(env, next);
  return next;
};

export function imageLightbox(md: MarkdownItRenderer): void {
  const renderToken: RenderRule = (tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options);

  const renderImage = md.renderer.rules.image ?? renderToken;
  const renderLinkOpen = md.renderer.rules.link_open ?? renderToken;
  const renderLinkClose = md.renderer.rules.link_close ?? renderToken;

  // An image that is already a link is left alone: a <label> nested inside an
  // <a> is interactive content inside a link, which is invalid and behaves
  // unpredictably (the browser fires the label and follows the href at once).
  // Rendering is strictly sequential, so tracking open links as they are
  // emitted is enough to spot those images — but they arrive as two different
  // token kinds: `[![alt](img)](href)` produces link_open/link_close, while a
  // hand-written <a href="…">![alt](img)</a> produces raw html_inline, which
  // those rules never see. Both are counted here.
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
    const index = pageCounter(env);

    // Screenshots are heavy (up to 290KB each, several per page) and most sit
    // below the fold, so let the browser defer the ones the reader may never
    // reach — except the first on the page, which is usually in the opening
    // viewport and is often the LCP element; deferring that one delays the
    // paint it is measured by. This goes on the INLINE copy: the overlay copy
    // lives inside display:none and is not fetched until it is opened, so
    // lazy-loading it would save nothing.
    if (index !== 1) token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");

    const inline = renderImage(tokens, idx, options, env, self);

    // src is read AFTER rendering, not before: VitePress's own image rule (the
    // one `renderImage` calls into) rewrites the token's src — `./`-prefixing
    // it and percent-decoding it — and that rewritten form is what Vue's
    // transformAssetUrls recognises as a bundled asset. Reading it first would
    // give the overlay the raw authored path, so a screenshot written without a
    // leading `./` would render inline but 404 in the enlarged view.
    const src = token.attrGet("src");
    if (depthOf(env) > 0 || src === null || index === null) return inline;

    const id = `cl-zoom-${index}`;

    // The control is described generically, and the overlay copy is marked
    // decorative, so the screenshot's alt text is announced exactly once — by
    // the inline image itself. Repeating the alt in the checkbox's label would
    // make every screenshot read out twice.
    return (
      `<input type="checkbox" class="cl-toggle" id="${id}" aria-label="View this image full size">` +
      `<label class="cl-zoom" for="${id}">${inline}</label>` +
      `<label class="cl-lightbox" for="${id}">` +
      `<img src="${escapeAttr(src)}" alt="" decoding="async"></label>`
    );
  };
}

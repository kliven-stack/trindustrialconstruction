# trindustrialconstruction.com — Astro clone

A static [Astro](https://astro.build) rebuild of the WordPress/Elementor site at
`https://trindustrialconstruction.com`, cloned to match the original's rendering.
Built and verified per `../MIGRATION-PLAYBOOK.md`.

**44 URLs migrated** — the 43 pages Yoast's sitemap lists, plus the theme's 404
template, which WordPress served and a static clone would otherwise drop. The site
has no posts (`/wp-json/wp/v2/posts` returns `[]`, `post-sitemap.xml` is empty), so
there is no blog, no archive and no feed to migrate.

```bash
npm install
npm run dev            # http://localhost:4321
npm run build          # → dist/
```

---

## How the clone works

The site's design lives in Elementor's compiled CSS. Rather than re-deriving those
rules by hand, the build **ships them verbatim in the original cascade order** and
ports the rendered markup — the approach the playbook prescribes for Breakdance
(§7.1–7.2), which applies cleanly here because this install emits one external file
per WordPress stylesheet handle. Fidelity is structural, not re-derived.

```
src/
  data/pages.json        one record per URL: path, title, body class, stylesheet
                         order, Yoast's SEO block, and which fragments to assemble
  fragments/*.html       Elementor's rendered markup — 44 page bodies, plus 18
                         deduplicated header/footer variants
  layouts/BaseLayout.astro   reproduces the original <head>, including the exact
                         stylesheet cascade
  pages/[...slug].astro  one route renders every cloned URL
  pages/404.astro        the theme's 404 template → dist/404.html
  scripts/elementor.js   replaces all of the WordPress JavaScript
public/
  wp/css/                86 stylesheet handles + inline blocks, unmodified apart
                         from url() targets (see below)
  wp/fonts/              Elementor's own local Google Fonts woff2, latin only
  wp/js/                 the LeadConnector embed loader that lives in the markup
  wp-content/            every image the pages and stylesheets reference, plus the
                         Font Awesome and eicons webfonts, at their original paths
```

### Two things the stylesheets needed

Shipping Elementor's CSS "verbatim" is not quite literal — its URLs have to be
repointed, and getting that wrong is invisible until you measure:

- **Section backgrounds are absolute URLs.** `elementor-post-*.css` paints hero and
  section backgrounds with `url(https://trindustrialconstruction.com/…)`. Left
  alone, the clone keeps fetching its own images from the WordPress site it
  replaces. `scripts/fetch-css.mjs` rewrites them to the original root-relative
  path and mirrors the files there.
- **Icon fonts are relative URLs.** Font Awesome and eicons address their webfonts
  as `../webfonts/fa-solid-900.woff2`, which resolves against `/wp/css/` here and
  404s. Every icon then fell back to default metrics — enough to make the header nav
  render 5px wider than production. Same fix; the webfonts are mirrored at their
  original paths.

### The JavaScript

`src/scripts/elementor.js` (~515 lines, no dependencies) replaces jQuery,
elementor-frontend, elementor-pro-frontend, SmartMenus, e-sticky and the Essential
Addons frontend (Isotope + imagesLoaded). It reproduces the **DOM contract** those
bundles created — the classes, inline styles and injected nodes the compiled CSS
depends on — rather than re-inventing the behaviour. Every contract was read off
the live site's post-init DOM with `scripts/inspect-live.mjs`:

| Feature | Contract reproduced |
| --- | --- |
| Sticky header | `elementor-sticky--active`, inline `position:fixed`/`width`/`top`, a visibility-hidden `elementor-sticky__spacer` clone, `elementor-sticky--effects` past the 30px offset |
| Nav menu | SmartMenus' `data-smartmenus-id`, `has-submenu` and `aria-*` annotations, 250 ms hover-open, **500 ms close delay** so the pointer can cross the gap (playbook §3.11), click toggle, outside-click close |
| Burger menu | `elementor-active` on the toggle, `--menu-height` on the panel, Elementor's "stretch" width/left placement |
| Background lazy-load | `e-lazyloaded` via IntersectionObserver — Elementor prints a stylesheet that blanks backgrounds on the 4th+ container until JS lifts it |
| Background video | sets `src` on the `<video>` Elementor's JS fills in, prepends the `.elementor-background-video-container` the same way, then scales the player from its container so it covers rather than letterboxes |
| Entrance animations | drops `elementor-invisible` and adds `animated fadeInDown` after each element's `_animation_delay`, on intersection |
| Filterable gallery | Isotope's contract: `position:relative` container with an explicit height, tiles `position:absolute` at a percentage `left` and pixel `top`, laid out as fitRows; category controls toggle `active` and re-flow |
| Environment | Elementor's `.e--ua-*` body classes, which `e-apple-webkit.css` keys 61 rules off |

### Environment

| Variable | Purpose |
| --- | --- |
| `PUBLIC_SITE_URL` | canonical URLs, the Yoast block's origin, and the sitemap. Defaults to the production domain. |

See `.env.example`.

---

## The form

Every page's footer embeds a **LeadConnector / GoHighLevel** form widget in an
iframe, served from `verified.trustymail.co` — the "Contact Us Form". `/contact/`
embeds a second copy in its own content and hides the footer one with a
`page-id-54` rule in the theme's custom CSS.

**It ships exactly as WordPress serves it, and is not rebuilt.** The widget is a
GoHighLevel-hosted flow rather than a WordPress plugin, so unlike playbook §7.5's
case it does not die with the install — the embed *is* the working form, and it
keeps working after cutover; it just stops being ours to route.

It ships with its `form_embed.js` resizer, and that detail is load-bearing rather
than incidental: the iframe is served with `style="height:100%"`, which on a
block-level iframe resolves to the default 150px. The resizer is what receives the
rendered height from inside the frame and rewrites the inline style to it — 1,144px
on `/contact/`, measured on production. Drop it and the form renders clipped to a
sliver. `npm run functional` asserts the embed on both placements and the loader.

`npm run form:inspect` reads what the widget actually renders — seven fields, their
labels, order and styling — which is how you check the embed still works after
cutover without clicking through the site.

---

## Verification

Measured, not eyeballed (playbook §2).

```bash
npm run build
node scripts/serve.mjs &      # serves dist/ on :4321, like production

npm run compare               # computed-style + bounding-box diff vs production
npm run functional            # behaviour the style diff cannot see
npm run audit                 # every internal link and asset resolves in dist/
```

`compare` loads each page from production and from the clone at **1440 / 900 /
390 px** and diffs position, size, font, colour, background, display, padding,
margin and text-align for every element with an Elementor `data-id`, plus the page
landmarks and total document height. Results land in `_extract/compare-report.json`.

Two adjustments make that diff trustworthy on this site:

- measurement waits for `document.fonts.ready`, since text wraps against fallback
  metrics until the real faces land;
- the LeadConnector widget host is blocked on production **and** the mirrored copy
  of its loader is blocked on the clone. Blocking only production would leave the
  clone running the iframe resizer while production did not, which reported the
  footer as 36px short and shifted every element below it.

`npm run functional` covers what geometry cannot: hover menus including the
pointer's trip across the gap to the submenu, the burger panel at two widths,
sticky behaviour, the background video's cover fit at three widths, the filterable
gallery's layout, filtering and re-flow, the entrance animations, and the form.

### Where it currently stands

Last full run, against production on 2026-08-19:

| Check | Result |
| --- | --- |
| `npm run compare` | **132 comparisons — 44 URLs × 3 widths, 9,249 landmark nodes, 0 differences** |
| `npm run functional` | 47/47 passed |
| `npm run audit` | 3,551 references across 44 pages and 86 stylesheets; no broken link beyond the 17 production already has |

The uploads are re-compressed in place at identical pixel dimensions (28.4 MB →
19.4 MB), so none of those numbers move when `npm run images` runs.

---

## Rebuilding the source data from the live site

The generated data is committed, so a plain `npm run build` needs none of this. To
re-pull from WordPress:

```bash
npm run crawl      # every sitemap URL + everything linked from a crawled page
npm run css        # download each stylesheet handle and what it references
npm run extract    # split pages into fragments + src/data/pages.json
npm run fonts      # mirror Elementor's local Google Fonts
npm run media      # mirror every image the markup references
npm run images     # re-compress the uploaded JPEG/PNG in place
```

`_extract/html/` (the crawl cache) and `_extract/live-dom/` are deliberately
untracked; `npm run crawl` and `scripts/inspect-live.mjs` restore them.

---

## Deviations from the playbook, and why

- **Astro 7, not Astro 5.** Astro 5 is two majors behind; the sibling projects in
  this folder are already on 7. Same `output: 'static'` architecture.
- **Elementor's compiled CSS is shipped verbatim** instead of being re-derived as
  Tailwind rules. See "How the clone works" above. Tailwind v4 is still installed
  and carries the Elementor kit tokens in `src/styles/global.css`, and styles the
  one component we author (the contact form).
- **Tailwind's content detection is scoped to `src/components` and `src/pages`**
  (`source(none)` + explicit `@source`). This is not optional for a markup port:
  with the default scan Tailwind generates utilities for class names it shares with
  WordPress — `.size-full`, `.hidden`, `.container`, `.block`, `.table`, `.static`.
- **Fonts are Elementor's own files, not fontsource.** This install runs
  Elementor's "local Google Fonts" feature, so the origin already serves real woff2
  with per-subset `unicode-range`. Mirroring those is more faithful than
  substituting a package; the only edit is the playbook's latin-subset rule, which
  drops blocks the browser's `unicode-range` gating meant it never fetched.
- **Images use the original `<img>`/`srcset` markup**, not `astro:assets`. Porting
  rendered markup rules out build-time image components; the uploads are instead
  re-compressed in place (`npm run images`) at identical pixel dimensions, so
  nothing about the rendering changes.

## Original-site bugs, cloned as-is

Reproduced faithfully rather than quietly fixed (playbook §2). Each has a short fix
if the client wants it.

| Bug | Detail |
| --- | --- |
| **Dead links to the old WP Engine host** | 17 distinct URLs on `trindustrial.wpengine.com` — the site's pre-launch address, which now 404s on every path. Six are in the footer's Services and Company columns, so they appear on all 44 pages; the rest are body links on the location and building pages. **Fix:** rewrite the host to `trindustrialconstruction.com`. Note that only some would then resolve — five of them point at `/industries/…` paths that do not exist under that prefix (they live under `/buildings/…`), so those need re-pointing too. |
| Gallery hides two of its images | `/buildings/car-wash/` has 8 gallery images but Essential Addons renders only its first page of 6, and no "load more" control is printed — the last two are unreachable. **Fix:** set the widget's images-per-page to 8, or enable the load-more button. |
| Misspelled location slugs | `/locations/hunstville-al/` (the page is titled "Huntsville") and `/locations/athen-al/` ("Athens"). Both are live URLs, so changing them needs redirects. |
| No meta description on 34 of 44 pages | Yoast only has one for 9 pages plus the home page; the rest fall back to whatever the search engine picks. |
| Heading structure | The home page and `/services/design-build/` have no `<h1>` at all; `/buildings/`, `/buildings/warehouse/`, `/buildings/hazardous-material-facility/` and `/services/self-performance/` have two. |
| Every image has an empty `alt` | All 92 `<img>` elements carry `alt=""`, including the ones that carry meaning (project photography, the logo). |
| Duplicate DOM ids on `/contact/` | The page embeds the contact widget in its content while the footer embeds it again, both as `id="inline-QkHUoEsI0wB7n2egM9ao"`. The footer copy is hidden by a `page-id-54` rule in the theme's custom CSS rather than being removed, so it still loads and still runs the widget. Our own form is rendered twice for the same reason, but its field ids are namespaced per region. |
| The hero background video is a `.mov` | `/wp-content/uploads/2023/05/1089827977-hd.mov`, 5.8 MB of QuickTime in a `<video>`. It plays in Chrome and Safari and is unreliable elsewhere; an MP4 would be safer. |
| The contact form is slow to appear | The LeadConnector iframe ships at `height:100%`, which resolves to a ~150px box, and only reaches its real 1,144px after the widget's resizer completes a postMessage handshake — several seconds on a cold load, and the section stays visibly empty until it does. This is the widget's own behaviour and the clone reproduces it. *Fix:* give the wrapper a `min-height` of 1,144px so the space is reserved before the handshake, or ask GoHighLevel for a fixed-height embed. Either changes the section's collapsed height, so the client should sign it off. |
| Gallery tiles are not clickable | The filterable galleries carry a "buttons" popup setting, but the buttons container renders empty and no lightbox is loaded, so clicking a photo does nothing. Cloned as-is; the hover caption is the whole interaction. |
| An empty category archive is still served | `/category/uncategorized/` returns 200 on WordPress with no posts behind it. Nothing links to it and it is not in the sitemap, so it is not migrated — worth noting only because it disappears at cutover. |

## Deployment

Import at vercel.com/new; the standard config needs no settings. `vercel.json`
carries the security headers plus the redirects WordPress used to handle: the five
`/building/…` (singular) URLs the location pages link to, which WordPress 301s to
`/buildings/…`, and the old Yoast sitemap addresses.

There is nothing to configure for the form — it ships as WordPress serves it. A
human should submit it once end to end; it posts to GoHighLevel, not to this site,
so it behaves identically before and after cutover.

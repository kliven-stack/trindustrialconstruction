import pagesData from '../data/pages.json';

export interface CssRef { type: 'file'; name: string }
export interface Favicon { rel: string; href: string; sizes: string | null }

export interface PageRecord {
  slug: string;
  path: string;
  title: string;
  description: string | null;
  robots: string | null;
  bodyClass: string;
  lang: string;
  hasSkipLink: boolean;
  header: string | null;
  footer: string | null;
  popups: string[];
  content: string;
  css: CssRef[];
  favicons: Favicon[];
  /** msapplication-TileImage, as WordPress printed it. */
  tile: string | null;
  /** Yoast's Open Graph / Twitter / schema.org block, origin templated out. */
  seoHead: string;
}

export const pages = pagesData as PageRecord[];

/** Raw Elementor markup, keyed by fragment name (`page-index`, `header-162-…`). */
const fragmentModules = import.meta.glob<string>('../fragments/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const fragments = new Map<string, string>(
  Object.entries(fragmentModules).map(([file, html]) => [
    file.replace(/^.*\/([^/]+)\.html$/, '$1'),
    html,
  ]),
);

export function fragment(name: string | null): string {
  if (!name) return '';
  const html = fragments.get(name);
  if (html === undefined) throw new Error(`Missing fragment: ${name}`);
  return html;
}

export const pageByPath = new Map(pages.map((p) => [p.path, p]));

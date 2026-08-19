/** Site-wide switches that a project lead may want to flip without touching markup. */

/**
 * How the lead-capture form renders.
 *
 * - `growthmap`  — our own static form, POSTing to `PUBLIC_CONTACT_ENDPOINT`
 *                  (playbook §4b). This is the migration target.
 * - `embed`      — the original LeadConnector / GoHighLevel iframe, byte-identical
 *                  to the WordPress site. It is served from `verified.trustymail.co`,
 *                  a GoHighLevel host that outlives the WordPress install, so it is
 *                  a safe fallback until the Growthmap endpoint exists.
 *
 * With no endpoint configured the embed is kept regardless, so a deploy that
 * happens before the endpoint is created never ships a form that goes nowhere.
 */
export const FORM_MODE: 'growthmap' | 'embed' =
  (import.meta.env.PUBLIC_FORM_MODE as 'growthmap' | 'embed') || 'growthmap';

/** Growthmap lead endpoint (public by design — it is read in the browser). */
export const CONTACT_ENDPOINT = import.meta.env.PUBLIC_CONTACT_ENDPOINT || '';

export const SITE_NAME = 'TR industrial Construction';

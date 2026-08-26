/** Site-wide switches that a project lead may want to flip without touching markup. */

/**
 * There is no form switch on this site, and that is the decision rather than an
 * omission: the one lead form ships exactly as WordPress serves it.
 *
 * The "Contact Us Form" is a LeadConnector / GoHighLevel iframe on
 * `verified.trustymail.co`, shown by the footer on every page and repeated in the
 * contact page's own content. That host outlives the WordPress install, so the
 * embed *is* the working form and it keeps working after cutover; it just stops
 * being ours to route. It ships with the `form_embed.js` resizer that sizes it.
 */

export const SITE_NAME = 'TR industrial Construction';

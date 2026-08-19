import { createHash } from 'node:crypto';

/** Stable local filename for a mirrored in-region script. */
export const scriptFileName = (url) =>
  `${createHash('sha1').update(url.split('?')[0]).digest('hex').slice(0, 12)}.js`;

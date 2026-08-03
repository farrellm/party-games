import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * §10: everything is vendored into the bundle. No CDN, no Google Fonts, no
 * analytics. A single stray <script src="https://…"> silently breaks the entire
 * premise of the project — the app is meant to work on a hotspot with no data
 * plan, and it would keep working right up until the one party where it didn't.
 *
 * The doc says this is "worth enforcing in review". A test is better than a
 * reviewer, because it never gets tired.
 */

const ROOT = new URL('..', import.meta.url).pathname;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx|css|html)$/.test(entry)) found.push(path);
  }
  return found;
}

/** Remote references. Protocol-relative //host counts; a bare // comment does not. */
const REMOTE = /(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/gi;

/** Documentation and spec links in comments are not fetches. */
const ALLOWED = [
  'http://www.d-project.com',
  'https://www.rfc-editor.org',
  'http://localhost',
  'https://localhost',
];

describe('nothing is fetched from the network', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'src')),
    join(ROOT, 'index.html'),
    join(ROOT, 'vite.config.ts'),
  ];

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [f.replace(ROOT, ''), f]))('%s', (_label, path) => {
    const source = readFileSync(path, 'utf8');

    const offenders = [...source.matchAll(REMOTE)]
      .map((m) => m[0])
      .filter((url) => !ALLOWED.some((ok) => url.startsWith(ok)))
      // In-code comment prose that happens to name a domain is fine; what
      // matters is anything the browser would actually go and get.
      .filter((url) => {
        const line = source.split('\n').find((l) => l.includes(url)) ?? '';
        return !/^\s*(\*|\/\/)/.test(line);
      });

    expect(offenders).toEqual([]);
  });
});

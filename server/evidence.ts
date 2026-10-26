import fs from 'node:fs/promises';
import path from 'node:path';
import type { Source } from '../shared/types.js';
import { readImagePart } from './argon.js';
export const demoUrl =
  'https://www.zillow.com/homedetails/200-Brannan-St-APT-114-San-Francisco-CA-94107/69817820_zpid/';
const planUrl =
  'https://photos.zillowstatic.com/fp/21958f3c18cd9d4bf09f57b38b339f90-uncropped_scaled_within_1536_1152.png';
export function validateListing(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('Enter a valid property listing URL.');
  }
  if (
    u.protocol !== 'https:' ||
    !['www.zillow.com', 'zillow.com'].includes(u.hostname) ||
    !u.pathname.includes('69817820_zpid')
  )
    throw new Error(
      'This hackathon adapter supports the Brannan demonstration listing. Other listings need a source adapter.',
    );
  return demoUrl;
}
async function download(url: string, name: string): Promise<{ localUrl: string; cached: boolean }> {
  const destination = path.join('public/evidence', name);
  try {
    await readImagePart(destination);
    return { localUrl: '/evidence/' + name, cached: true };
  } catch {}
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'photos.zillowstatic.com')
    throw new Error('Unsupported image host.');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Image unavailable (' + response.status + ')');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10_000_000) throw new Error('Image exceeds source limit.');
  await readImagePart('data:image/jpeg;base64,' + bytes.toString('base64'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return { localUrl: '/evidence/' + name, cached: false };
}
export async function collectEvidence(
  url: string,
  knownSources: Source[],
): Promise<{ sources: Source[]; mode: string; detail: string; imagePaths: string[] }> {
  validateListing(url);
  const sources: Source[] = knownSources.length
    ? structuredClone(knownSources)
    : [
        { id: 'listing', kind: 'listing', label: 'Brannan listing', url: demoUrl },
        { id: 'plan', kind: 'plan', label: 'Source floor plan', url: planUrl },
      ];
  let pageLive = false;
  try {
    const page = await fetch(demoUrl, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!page.ok) throw new Error('Listing returned ' + page.status);
    const html = await page.text();
    if (!html.includes('69817820') || /captcha|access to this page has been denied/i.test(html))
      throw new Error('Listing evidence unavailable.');
    await fs.mkdir('runtime', { recursive: true });
    await fs.writeFile('runtime/listing.html', html);
    pageLive = true;
    if (!sources.some((s) => s.kind === 'photo')) {
      const urls = [
        ...new Set(
          html.match(
            /https:\/\/photos\.zillowstatic\.com\/fp\/[a-f0-9]+-[^"'<>\\\s]+?\.(?:jpg|webp|png)/g,
          ) || [],
        ),
      ].filter((u) => !u.includes('21958f3c'));
      for (const [i, image] of urls.slice(0, 4).entries())
        sources.push({
          id: 'listing-photo-' + i,
          kind: 'photo',
          label: 'Listing photo ' + (i + 1) + ' (unclassified)',
          url: image,
        });
    }
  } catch {}
  let cachedCount = 0,
    liveCount = 0,
    failedCount = 0;
  for (const source of sources.filter((s) => s.kind !== 'listing').slice(0, 40)) {
    try {
      if (
        source.localUrl &&
        /^\/evidence\/[A-Za-z0-9_/-]+\.(png|jpg|webp)$/.test(source.localUrl)
      ) {
        await readImagePart(path.join('public', source.localUrl));
        cachedCount++;
        continue;
      }
      const result = await download(
        source.url,
        'zillow-69817820/' +
          source.id.replace(/[^a-zA-Z0-9_-]/g, '-') +
          (source.url.includes('.png') ? '.png' : '.jpg'),
      );
      source.localUrl = result.localUrl;
      result.cached ? cachedCount++ : liveCount++;
    } catch {
      delete source.localUrl;
      failedCount++;
    }
  }
  const usable = sources.filter((s) => s.localUrl);
  if (!usable.some((s) => s.kind === 'plan'))
    throw new Error('The floor-plan image is unavailable; source inspection cannot proceed.');
  if (!usable.some((s) => s.kind === 'photo'))
    throw new Error(
      'No interior source photo could be read; visual reconstruction cannot proceed.',
    );
  const mode = pageLive && cachedCount === 0 ? 'live' : liveCount === 0 ? 'cached' : 'mixed';
  const detail =
    (pageLive
      ? 'Listing page retrieved. '
      : 'Live listing extraction unavailable; using the curated Brannan reference set. ') +
    liveCount +
    ' source images downloaded; ' +
    cachedCount +
    ' cached images reused.' +
    (failedCount ? ' ' + failedCount + ' image(s) unavailable.' : '');
  const imagePaths = usable.map((s) => path.join('public', s.localUrl!));
  await fs.mkdir('runtime', { recursive: true });
  await fs.writeFile(
    'runtime/evidence.json',
    JSON.stringify({ url, sources, mode, collectedAt: new Date().toISOString() }, null, 2),
  );
  return { sources, mode, detail, imagePaths };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import type { IntakeReport } from '../shared/types.js';
import {
  allowedImageUrl,
  assessEvidence,
  extractGallery,
  inspectListing,
  propertyKey,
  validateClassification,
  validateReconstruction,
  registerFloorOrigins,
  reconstructionDiagnostics,
  type ImageClassification,
} from '../server/intake.js';

const url = 'https://www.zillow.com/homedetails/Example-Home/12345_zpid/';
const img = (hash: string, suffix = 'uncropped_scaled_within_1536_1152.jpg') =>
  `https://photos.zillowstatic.com/fp/${hash.repeat(32)}-${suffix}`;
const classification = (id: string, kind: ImageClassification['kind']): ImageClassification => ({
  sourceId: id,
  kind,
  privateInterior: kind === 'interior',
  readable: true,
  hasScale: kind === 'floorplan',
  scaleEvidence: kind === 'floorplan' ? 'Living 12 ft x 15 ft' : '',
  roomHints: kind === 'floorplan' ? ['living', 'kitchen'] : ['living'],
  floorHint: null,
  confidence: 'high',
  detail: 'Visible source content',
});
const report = (): IntakeReport => ({
  id: 'zillow-12345',
  url,
  title: 'Independent home',
  status: 'ready',
  summary: 'Enough evidence',
  checks: [],
  sources: [{ id: 'plan', kind: 'plan', label: 'Plan', url: img('a') }],
  roomHints: ['living'],
  createdAt: new Date().toISOString(),
});
function shell() {
  const points = [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ] as [number, number][];
  return {
    rooms: [
      {
        id: 'independent-room',
        name: 'Independent room',
        polygon: points,
        floorZ: 0,
        ceilingHeight: 2.7,
      },
    ],
    walls: points.map((start, i) => ({
      id: `wall-${i}`,
      start,
      end: points[(i + 1) % 4],
      floorZ: 0,
      height: 2.7,
      thickness: 0.12,
      color: '#fefefe',
      openings: [] as any[],
    })),
    stairs: [],
    cameras: [{ id: 'view', label: 'View', position: [1, 1, 1.6], target: [3, 3, 1], floorZ: 0 }],
    navigation: {
      start: [1, 1],
      targets: [{ id: 'living-target', label: 'Living', point: [4, 4] }],
      clearance: 0.65,
      levels: [] as any[],
    },
    notes: ['Scale label transcribed from the source; polygon coordinates remain inferred.'],
  };
}

test('property keys accept arbitrary Zillow zpids but reject unsupported hosts, credentials and search URLs', () => {
  assert.equal(propertyKey(url + '?utm_source=demo'), 'zillow-12345');
  assert.equal(propertyKey('https://zillow.com/homedetails/9876_zpid/'), 'zillow-9876');
  for (const invalid of [
    'http://www.zillow.com/homedetails/X/123_zpid/',
    'https://www.zillow.com.evil.test/homedetails/X/123_zpid/',
    'https://localhost/homedetails/X/123_zpid/',
    'https://user:pass@www.zillow.com/homedetails/X/123_zpid/',
    'https://www.zillow.com:444/homedetails/X/123_zpid/',
    'https://www.zillow.com/homes/for_sale/',
    'not-a-url',
  ])
    assert.throws(() => propertyKey(invalid));
});

test('image allowlist excludes arbitrary URLs and supports only Zillow property-image files', () => {
  assert.equal(allowedImageUrl(img('a')), img('a'));
  for (const invalid of [
    'https://localhost/secret.png',
    'https://photos.zillowstatic.com.evil.test/fp/a.jpg',
    'https://user:pass@photos.zillowstatic.com/fp/a.jpg',
    'https://photos.zillowstatic.com/fp/a.svg',
    'https://photos.zillowstatic.com:444/fp/a.jpg',
    'file:///tmp/a.png',
  ])
    assert.equal(allowedImageUrl(invalid), undefined);
});

test('gallery reads nested serialized NEXT_DATA, unescapes URLs and deduplicates image resolutions', () => {
  const data = {
    props: {
      pageProps: {
        cache: JSON.stringify({
          photos: [{ url: img('a', 'p_c.jpg') }, { url: img('a') }, { url: img('b') }],
        }),
      },
    },
  };
  const html = `<title>Example &amp; Home | Zillow</title><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  const gallery = extractGallery(html);
  assert.equal(gallery.title, 'Example & Home | Zillow');
  assert.deepEqual(gallery.urls, [img('a'), img('b')]);
  assert.equal(gallery.total, 2);
  assert.deepEqual(extractGallery(`<img src="${img('c').replaceAll('/', '\\u002F')}">`).urls, [
    img('c'),
  ]);
});

test('large galleries retain late floor-plan candidates within the bounded sample', () => {
  const images = Array.from({ length: 45 }, (_, i) => img(i.toString(16).padStart(2, '0')));
  const result = extractGallery(images.join(' '));
  assert.equal(result.total, 45);
  assert.equal(result.urls.length, 30);
  assert.equal(result.urls.at(-1), images.at(-1));
  assert.equal(result.urls[0], images[0]);
});

test('property-scoped gallery excludes nearby-listing photos and unrelated page images', () => {
  const data = {
    props: {
      cache: JSON.stringify({
        property: {
          zpid: 12345,
          responsivePhotos: [{ url: img('a') }],
          nearbyHomes: [{ zpid: 99999, originalPhotos: [{ url: img('b') }] }],
        },
      }),
    },
  };
  const html = `<img src="${img('c')}"><script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`;
  assert.deepEqual(extractGallery(html, 'zillow-12345').urls, [img('a')]);
  assert.deepEqual(extractGallery(html, '99999').urls, [img('b')]);
  assert.deepEqual(extractGallery(html, '11111').urls, []);
  assert.deepEqual(extractGallery(`<img src="${img('c')}">`, '12345').urls, []);
});

test('sufficiency needs a readable scaled plan plus three interiors, never counts exteriors or unclear images', () => {
  const inputs = [
    classification('plan', 'floorplan'),
    ...['one', 'two', 'three'].map((id) => classification(id, 'interior')),
  ];
  assert.equal(assessEvidence(inputs).ready, true);
  assert.equal(assessEvidence(inputs).checks.find((c) => c.id === 'room-coverage')!.passed, false);
  assert.equal(assessEvidence(inputs.slice(0, 3)).ready, false);
  assert.equal(
    assessEvidence(inputs.map((i) => (i.sourceId === 'three' ? { ...i, kind: 'exterior' } : i)))
      .ready,
    false,
  );
  assert.equal(
    assessEvidence(
      inputs.map((i) => (i.sourceId === 'plan' ? { ...i, scaleEvidence: 'seems scaled' } : i)),
    ).ready,
    false,
  );
  assert.equal(
    assessEvidence(inputs.map((i) => (i.sourceId === 'plan' ? { ...i, confidence: 'low' } : i)))
      .ready,
    false,
  );
  assert.equal(
    assessEvidence(
      inputs.map((i) => (i.sourceId === 'three' ? { ...i, privateInterior: false } : i)),
    ).ready,
    false,
  );
  assert.equal(
    assessEvidence(
      inputs.map((i) => (i.sourceId === 'three' ? { ...i, roomHints: ['shared gym'] } : i)),
    ).ready,
    false,
  );
});

test('classification validates exact batch IDs and rejects invented or duplicated image results', () => {
  const image = classification('one', 'interior');
  assert.equal(validateClassification({ images: [image] }, ['one']).length, 1);
  assert.throws(() => validateClassification({ images: [image] }, ['two']), /exactly once/);
  assert.throws(
    () => validateClassification({ images: [image, image] }, ['one', 'two']),
    /exactly once/,
  );
  assert.throws(() => validateClassification({ images: [{ ...image, readable: 'yes' }] }, ['one']));
});

test('independent reconstruction preserves its own coordinates and identifies all metric geometry as inferred', () => {
  const scene = validateReconstruction(shell(), report());
  assert.equal(scene.id, 'zillow-12345');
  assert.equal(scene.listingUrl, url);
  assert.deepEqual(scene.rooms[0].polygon, [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ]);
  assert.equal(scene.objects.length, 0);
  assert.ok(scene.notes.some((note) => note.includes('inferred approximations')));
  assert.equal(
    scene.rooms.some((room) => room.id === 'kitchen'),
    false,
  );
  assert.throws(
    () => validateReconstruction(shell(), { ...report(), status: 'needs-input' }),
    /not ready/,
  );
  const lowParapet = shell();
  lowParapet.walls[0].height = 1.1;
  assert.equal(validateReconstruction(lowParapet, report()).walls[0].height, 1.1);
});

test('reconstruction rejects crossed polygons, malformed numbers, invalid openings and external navigation anchors', () => {
  const crossed = shell();
  crossed.rooms[0].polygon = [
    [0, 0],
    [6, 6],
    [0, 6],
    [6, 0],
  ];
  assert.throws(() => validateReconstruction(crossed, report()), /polygon/);
  const nan = shell();
  nan.rooms[0].floorZ = NaN;
  assert.throws(() => validateReconstruction(nan, report()));
  const opening = shell();
  opening.walls[0].openings.push({
    id: 'bad-door',
    type: 'door',
    offset: 0.1,
    width: 1,
    height: 2.1,
    bottom: 0,
    basis: 'inferred',
  });
  assert.throws(() => validateReconstruction(opening, report()), /outside its wall/);
  const outside = shell();
  outside.navigation.targets[0].point = [99, 99];
  assert.throws(() => validateReconstruction(outside, report()));
  const duplicated = shell();
  duplicated.cameras[0].id = duplicated.rooms[0].id;
  assert.throws(() => validateReconstruction(duplicated, report()), /duplicate/);
  const overlapping = shell();
  overlapping.rooms.push({ ...structuredClone(overlapping.rooms[0]), id: 'overlapping-room' });
  assert.throws(() => validateReconstruction(overlapping, report()), /overlap/);
  const groundRepeated = shell();
  groundRepeated.navigation.levels = [
    {
      floorZ: 0,
      start: [1, 1],
      targets: [{ id: 'duplicate-floor-target', label: 'Duplicate', point: [4, 4] }],
    },
  ];
  assert.throws(() => validateReconstruction(groundRepeated, report()), /only upper/);
});

test('solid divider fails route verification rather than claiming a successful reconstruction', () => {
  const data = shell();
  data.walls.push({
    id: 'sealed-divider',
    start: [0, 3],
    end: [6, 3],
    floorZ: 0,
    height: 2.7,
    thickness: 0.12,
    color: '#fefefe',
    openings: [],
  });
  assert.throws(() => validateReconstruction(data, report()), /failed geometry checks/);
});

test('missing upper-floor route set and stair connection are rejected', () => {
  const data = shell();
  data.rooms.push({ ...structuredClone(data.rooms[0]), id: 'upper-room', floorZ: 2.8 });
  data.walls.push(
    ...data.walls.map((wall) => ({
      ...structuredClone(wall),
      id: 'upper-' + wall.id,
      floorZ: 2.8,
    })),
  );
  assert.throws(() => validateReconstruction(data, report()), /navigation/);
  data.navigation.levels = [
    {
      floorZ: 2.8,
      start: [1, 1],
      targets: [{ id: 'upper-target', label: 'Upper', point: [4, 4] }],
    },
  ];
  assert.throws(() => validateReconstruction(data, report()), /stair connections/);
});

test('upper walls may border a known stairwell void but cannot extend beyond supported geometry', () => {
  const data: any = shell();
  data.rooms.push({
    id: 'upper-room',
    name: 'Upper room',
    floorZ: 2.8,
    ceilingHeight: 2.7,
    polygon: [
      [0, 0],
      [6, 0],
      [6, 6],
      [2, 6],
      [2, 4],
      [0, 4],
    ],
  });
  data.walls.push(
    ...data.walls.map((wall: any) => ({
      ...structuredClone(wall),
      id: 'upper-' + wall.id,
      floorZ: 2.8,
    })),
  );
  data.stairs = [
    {
      id: 'stairs',
      position: [1, 5, 1.4],
      dimensions: [2, 2, 2.8],
      rotation: 0,
      steps: 15,
      bottom: [1, 3],
      top: [2.5, 5],
    },
  ];
  data.navigation.levels = [
    {
      floorZ: 2.8,
      start: [3, 1],
      targets: [{ id: 'upper-target', label: 'Upper', point: [4, 4] }],
    },
  ];
  data.cameras.push({
    id: 'upper-camera',
    label: 'Upper view',
    position: [3, 1, 4.4],
    target: [4, 4, 3.8],
    floorZ: 2.8,
  });
  assert.equal(validateReconstruction(data, report()).rooms.length, 2);
  const unregistered = structuredClone(data);
  unregistered.stairs[0].top = [4, 4];
  assert.throws(
    () => validateReconstruction(unregistered, report()),
    /registered at the staircase/,
  );
  const diagnostics = reconstructionDiagnostics(unregistered, report());
  assert.ok(diagnostics.some((issue) => issue.includes('entire upper floor')));
  const unsupportedLanding = structuredClone(data);
  unsupportedLanding.stairs[0].top = [1.4, 5];
  assert.throws(
    () => validateReconstruction(unsupportedLanding, report()),
    /Stair stairs top anchor \[1\.4, 5\].*floor at 2\.8m.*0\.60m away/,
  );
  assert.ok(
    reconstructionDiagnostics(unsupportedLanding, report()).some(
      (issue) => issue.includes('top anchor [1.4, 5]') && issue.includes('0.60m away'),
    ),
  );
  data.walls.find((wall: any) => wall.id === 'upper-wall-2').end = [-0.5, 6];
  assert.throws(() => validateReconstruction(data, report()), /unsupported point/);
});

test('floor registration translates one supported upper level without changing shapes, dimensions or rotations', () => {
  const data: any = shell();
  data.navigation.start = [3, 1];
  const upper = structuredClone(data.rooms[0]);
  upper.id = 'upper';
  upper.floorZ = 2.8;
  upper.polygon = upper.polygon.map(([x, y]: number[]) => [x + 10, y + 10]);
  data.rooms.push(upper);
  data.walls.push(
    ...data.walls.map((w: any) => ({
      ...structuredClone(w),
      id: 'upper-' + w.id,
      floorZ: 2.8,
      start: w.start.map((n: number) => n + 10),
      end: w.end.map((n: number) => n + 10),
    })),
  );
  data.stairs = [
    {
      id: 'straight-stair',
      position: [1, 3, 1.4],
      dimensions: [1, 4, 2.8],
      rotation: 0,
      steps: 15,
      bottom: [1, 1],
      top: [11, 10],
    },
  ];
  data.navigation.levels = [
    {
      floorZ: 2.8,
      start: [13, 11],
      targets: [{ id: 'upper-target', label: 'Upper', point: [14, 14] }],
    },
  ];
  data.cameras.push({
    id: 'upper-camera',
    label: 'Upper',
    position: [13, 11, 4.4],
    target: [14, 14, 3.8],
    floorZ: 2.8,
  });
  const before = structuredClone(data),
    result = registerFloorOrigins(data),
    after = result.draft as any;
  assert.equal(result.declined, undefined);
  assert.deepEqual(result.shifts, [{ floorZ: 2.8, delta: [-10, -5], stairId: 'straight-stair' }]);
  assert.deepEqual(data, before);
  assert.deepEqual(after.rooms[0], before.rooms[0]);
  assert.deepEqual(after.rooms[1].polygon, [
    [0, 5],
    [6, 5],
    [6, 11],
    [0, 11],
  ]);
  assert.deepEqual(after.stairs[0].dimensions, before.stairs[0].dimensions);
  assert.equal(after.stairs[0].rotation, before.stairs[0].rotation);
  assert.deepEqual(after.cameras[1].position, [3, 6, 4.4]);
  assert.deepEqual(after.navigation.levels[0].start, [3, 6]);
  assert.equal(validateReconstruction(after, report()).rooms.length, 2);
  const bad = structuredClone(before);
  bad.stairs[0].bottom = [2, 1];
  const declined = registerFloorOrigins(bad);
  assert.match(declined.declined!, /lower anchor/);
  assert.deepEqual(declined.draft, bad);
  assert.equal(declined.shifts.length, 0);
  const ambiguous = structuredClone(before);
  ambiguous.stairs.push({ ...ambiguous.stairs[0], id: 'second-stair' });
  assert.match(registerFloorOrigins(ambiguous).declined!, /ambiguous/);
  const interiorLanding = structuredClone(before);
  interiorLanding.stairs[0].top = [13, 13];
  assert.match(registerFloorOrigins(interiorLanding).declined!, /landing edge/);
});

test('blocked listing reports missing evidence without using references from a different property', async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async () => {
    count++;
    return new Response('Blocked', { status: 403 });
  }) as typeof fetch;
  try {
    const intake = await inspectListing(url, [
      {
        id: 'old-listing',
        kind: 'listing',
        label: 'Another house',
        url: 'https://www.zillow.com/homedetails/999_zpid/',
      },
      { id: 'old-plan', kind: 'plan', label: 'Another plan', url: img('a') },
    ]);
    assert.equal(count, 1);
    assert.equal(intake.status, 'needs-input');
    assert.equal(intake.sources.length, 1);
    assert.ok(intake.checks.find((c) => c.id === 'listing-access')!.detail.includes('403'));
    assert.ok(intake.summary.includes('Reconstruction has not started'));
  } finally {
    globalThis.fetch = original;
  }
});

test('listing redirect to a private host is rejected before a second request', async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async () => {
    count++;
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/internal' } });
  }) as typeof fetch;
  try {
    const intake = await inspectListing(url);
    assert.equal(count, 1);
    assert.equal(intake.status, 'needs-input');
    assert.equal(intake.checks.find((c) => c.id === 'listing-access')!.passed, false);
  } finally {
    globalThis.fetch = original;
  }
});

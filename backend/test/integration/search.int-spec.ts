/**
 * INTEGRATION spec for the FULL-TEXT SEARCH paths against a REAL Postgres
 * (`arya_test`). Exercises CatalogService.listPublicProducts({search}) and
 * ArticlesService.listPublic({search}) — both of which query the SQL-only
 * `search_vector` GENERATED tsvector columns (websearch_to_tsquery + ts_rank,
 * GIN-backed) via $queryRaw. These columns are NOT modeled in Prisma, so the
 * behaviour can ONLY be proven against real Postgres.
 *
 * The S3/PDF SDKs are mocked at the top of the file because both services
 * construct an S3Client and presign thumbnails/covers; the matching rows are
 * seeded WITHOUT media so the presign helpers short-circuit to null, but the SDKs
 * are still imported at module construction time. No DB is mocked.
 *
 * Invariants asserted:
 *  (1) PRODUCTS: a search term returns the matching product(s), ranked, and
 *      EXCLUDES non-matches.
 *  (2) PRODUCTS: a multi-word / quoted (websearch) query honors phrase semantics.
 *  (3) PRODUCTS: a term containing SQL/tsquery metacharacters does NOT error
 *      (bound parameter → injection-safe) and simply returns no spurious matches.
 *  (4) ARTICLES: the same three guarantees over articles.search_vector.
 */

// ── Mock the non-DB SDKs BEFORE the services are imported (both build an
//    S3Client in their constructors and presign read URLs for thumbnails/covers).
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/thumb.jpg'),
}));

// `uuid` ships ESM-only (`export {...}`) and Jest does not transform node_modules,
// so importing the real package throws a SyntaxError at module load. ArticlesService
// (and DocumentService) import `uuid` for media-key generation — a path the search
// tests never hit — so a deterministic CJS stub keeps the import resolvable.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));

import { randomUUID } from 'crypto';
import { ProductStatus, ArticleStatus, ArticleAuthorType } from '@prisma/client';
import { getPrisma, truncateAll, closeAll, fakeConfig } from './harness';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { ArticlesService } from '../../src/modules/articles/articles.service';
import { DocumentService } from '../../src/modules/document/document.service';

let prisma: Awaited<ReturnType<typeof getPrisma>>;
let catalog: CatalogService;
let articles: ArticlesService;

const config = fakeConfig({
  AWS_REGION: 'ap-south-1',
  AWS_ACCESS_KEY_ID: 'test-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  AWS_S3_BUCKET: 'arya-documents-test',
  NODE_ENV: 'test',
});

beforeAll(async () => {
  prisma = await getPrisma();
  // DocumentService is a real instance (its S3 client is the mocked SDK); the
  // search rows carry no media, so its presign helpers are never actually hit.
  const documents = new DocumentService(prisma as any, config);
  catalog = new CatalogService(prisma as any, config, documents);
  // ArticlesService.listPublic touches neither EmailService nor StoreAuthService
  // on the search path, so they are minimal stubs.
  const emailStub = {} as any;
  const storeAuthStub = { postDiscordArticle: jest.fn() } as any;
  articles = new ArticlesService(prisma as any, config, emailStub, storeAuthStub);
});

afterAll(async () => {
  await closeAll();
});

beforeEach(async () => {
  await truncateAll(prisma);
  await prisma.$queryRaw`SELECT 1`;
});

// ──────────────────────────────────────────────────────────────────────────
//  Seed helpers — the search_vector is a GENERATED column derived from
//  name/short_description/seo_description/brand (products) and title/excerpt
//  (articles); we just set those text fields and Postgres builds the tsvector.
// ──────────────────────────────────────────────────────────────────────────

async function seedProduct(fields: {
  name: string;
  shortDescription?: string;
  seoDescription?: string;
  brand?: string;
}): Promise<string> {
  const id = randomUUID();
  await prisma.product.create({
    data: {
      id,
      slug: `prod-${id}`,
      name: fields.name,
      shortDescription: fields.shortDescription,
      seoDescription: fields.seoDescription,
      brand: fields.brand,
      status: ProductStatus.ACTIVE, // public list only surfaces ACTIVE, non-DIGITAL
      publishedAt: new Date(),
    },
  });
  return id;
}

async function seedArticle(fields: {
  title: string;
  excerpt?: string;
}): Promise<string> {
  const id = randomUUID();
  await prisma.article.create({
    data: {
      id,
      slug: `article-${id}`,
      title: fields.title,
      body: { blocks: [] },
      excerpt: fields.excerpt,
      authorType: ArticleAuthorType.CUSTOMER,
      authorId: randomUUID(),
      authorName: 'Test Author',
      status: ArticleStatus.PUBLISHED, // public list only surfaces PUBLISHED
      publishedAt: new Date(),
    },
  });
  return id;
}

describe('Full-text search — PRODUCTS (CatalogService.listPublicProducts)', () => {
  it('(1) returns the matching product(s) ranked and EXCLUDES non-matches', async () => {
    const espId = await seedProduct({
      name: 'ESP32 WROOM Development Board',
      shortDescription: 'A microcontroller dev board with WiFi and Bluetooth',
      brand: 'Espressif',
    });
    // A name-only mention should outrank a body-only mention (A vs C weight).
    const accessoryId = await seedProduct({
      name: 'USB Cable',
      seoDescription: 'Works great with an ESP32 board for programming',
    });
    // A total non-match must never appear.
    await seedProduct({
      name: 'Raspberry Pi 5',
      shortDescription: 'Single-board computer',
      brand: 'Raspberry Pi',
    });

    const res = await catalog.listPublicProducts({ search: 'ESP32' });

    const ids = res.data.map((d) => d.id);
    expect(ids).toContain(espId);
    expect(ids).toContain(accessoryId);
    expect(ids).toHaveLength(2);
    expect(res.meta.total).toBe(2);
    // Ranking: the name-weighted (A) match ranks above the seo-only (C) match.
    expect(ids[0]).toBe(espId);
  });

  it('(2) a multi-word / quoted (websearch) query honors phrase semantics', async () => {
    const phraseId = await seedProduct({
      name: 'Soldering Iron Station',
      shortDescription: 'A temperature controlled soldering iron for electronics',
    });
    // Contains both words but NOT as the adjacent phrase "soldering iron".
    const wireSpoolId = await seedProduct({
      name: 'Wire Spool',
      shortDescription: 'Iron-core wire; useful when soldering many joints',
    });

    // Quoted phrase → websearch_to_tsquery requires the words adjacent, so only
    // the product with the real phrase matches.
    const quoted = await catalog.listPublicProducts({ search: '"soldering iron"' });
    const quotedIds = quoted.data.map((d) => d.id);
    expect(quotedIds).toContain(phraseId);
    // Symmetric exclusion: if phrase matching ever degraded to implicit AND, the
    // non-adjacent product would slip in — assert it is absent, not just count==1.
    expect(quotedIds).not.toContain(wireSpoolId);
    expect(quotedIds).toHaveLength(1);

    // Unquoted multi-word (implicit AND) still matches the phrase product at least.
    const loose = await catalog.listPublicProducts({ search: 'soldering iron' });
    expect(loose.data.map((d) => d.id)).toContain(phraseId);
  });

  it('(3) a term with SQL/tsquery metacharacters is injection-safe (no error, no spurious match)', async () => {
    await seedProduct({ name: 'Multimeter', shortDescription: 'Digital multimeter' });

    // websearch_to_tsquery tolerates these strings; the term is a BOUND parameter
    // (never interpolated), so a SQL-injection payload can neither error nor escape
    // the query — and since none of these contains the word "multimeter", none
    // matches the seeded product. (A metachar term that DID contain the keyword
    // would legitimately match — that is correct FTS parsing, not an injection.)
    for (const term of [
      "'; DROP TABLE products; --",
      'foo & | ! ( ) :*',
      "bar' OR '1'='1",
      '<script>alert(1)</script>',
    ]) {
      const res = await catalog.listPublicProducts({ search: term });
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBe(0);
    }

    // The metacharacters AROUND a real keyword are stripped by websearch parsing,
    // so the keyword still matches — proving the chars are parsed, not executed.
    const withKeyword = await catalog.listPublicProducts({
      search: 'multimeter & | ! ( ) :*',
    });
    expect(withKeyword.data).toHaveLength(1);

    // Sanity: the table still exists and a real query still works after the above.
    const ok = await catalog.listPublicProducts({ search: 'multimeter' });
    expect(ok.data).toHaveLength(1);
  });
});

describe('Full-text search — ARTICLES (ArticlesService.listPublic)', () => {
  it('(1) returns the matching article(s) ranked and EXCLUDES non-matches', async () => {
    const titleMatch = await seedArticle({
      title: 'Getting Started with Arduino',
      excerpt: 'A beginner guide to microcontrollers',
    });
    const excerptMatch = await seedArticle({
      title: 'Hobby Electronics Roundup',
      excerpt: 'We cover the Arduino ecosystem and more',
    });
    await seedArticle({
      title: 'Baking Sourdough Bread',
      excerpt: 'A guide to wild yeast starters',
    });

    const res = await articles.listPublic({ search: 'Arduino' });
    const ids = res.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(titleMatch);
    expect(ids).toContain(excerptMatch);
    expect(ids).toHaveLength(2);
    expect(res.meta.total).toBe(2);
    // Title (A weight) outranks excerpt-only (B weight).
    expect(ids[0]).toBe(titleMatch);
  });

  it('(2) a quoted (websearch) phrase query honors phrase semantics', async () => {
    const phraseId = await seedArticle({
      title: 'Machine Learning for Beginners',
      excerpt: 'An intro to machine learning concepts',
    });
    await seedArticle({
      title: 'Heavy Machine Maintenance',
      excerpt: 'Learning to service industrial machines',
    });

    const quoted = await articles.listPublic({ search: '"machine learning"' });
    const quotedIds = quoted.data.map((d: { id: string }) => d.id);
    expect(quotedIds).toContain(phraseId);
    expect(quotedIds).toHaveLength(1);
  });

  it('(3) a term with SQL/tsquery metacharacters is injection-safe (no error, no spurious match)', async () => {
    await seedArticle({ title: 'Postgres Indexing Tips', excerpt: 'GIN and BTREE' });

    // Bound-parameter payloads that contain NO real keyword: must not error and
    // must not match the seeded article.
    for (const term of [
      "'; DROP TABLE articles; --",
      'foo & | ! ( ) :*',
      "x' OR '1'='1",
      '<script>alert(1)</script>',
    ]) {
      const res = await articles.listPublic({ search: term });
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBe(0);
    }

    // Metacharacters around the real keyword are stripped by websearch parsing, so
    // the keyword still matches (parsed, not executed).
    const withKeyword = await articles.listPublic({
      search: 'postgres & | ! ( ) :*',
    });
    expect(withKeyword.data).toHaveLength(1);

    const ok = await articles.listPublic({ search: 'postgres' });
    expect(ok.data).toHaveLength(1);
  });
});

# Aryavartham Commerce + Articles Subsystem — Unified Architecture (Single Source of Truth)

> Status: implementation-ready (revision 2 — incorporates principal-engineer review). This document merges five domain specs (commerce data model; commerce services/realtime/jobs; commerce integrations; articles/media/views; frontend) into one reconciled architecture. Implementer agents build **only** from this document. Where the source specs disagreed, the reconciliation is stated inline and the losing alternative is noted so nobody re-litigates it.
>
> Grounded against the live repo: `auth.service.ts` (SHA-256 refresh-token hashing, role-dispatched `refreshToken()` + `validateUser()`), `payment.service.ts` (advisory-lock + 15-min reuse + HMAC + exactly-once CAS), `equity.service.ts` (advisory lock + CAS + integer-units invariant assertion), `document.service.ts` (S3 presign **creates a `status:PENDING` row at presign time** + HeadObject size enforcement + `PutObjectCommand`/`GetObjectCommand` already imported), `visitor.service.ts` (BullMQ `visitor-queue` + geoip + `DailyPageStat`), `chat.gateway.ts` (Socket.io namespace + JWT handshake + **hardcoded** CORS origin list), `jobs/batch.processor.ts` (`WorkerHost`, `removeOnComplete`/`removeOnFail`), `api.ts` (single `ApiClient`).

---

## 1. Overview & Guiding Principles

We are grafting a **single platform-owned, full-enterprise storefront** plus a **user-submitted articles vertical** onto the existing NestJS + Prisma v7 (PrismaPg adapter) + Postgres + Redis(ioredis) + BullMQ + `@nestjs/schedule` + Socket.io stack. There is no second runtime, no new datastore, no multi-vendor concept.

**Guiding principles:**

1. **Reuse before reinvent.** Razorpay flow, S3/`DocumentService`, `NotificationService`, `SiteSettings`, `VisitorService`/`DailyPageStat`, the Socket.io gateway pattern, and the advisory-lock + CAS idempotency idiom already exist and are battle-tested. The commerce layer composes them; it does not fork them.
2. **Money is integer paise everywhere.** Every monetary column is `Int` (paise). GST rates are integer **basis points** (`1800` = 18%). Rupee↔paise conversion happens **only** at the API boundary (DTO in / response out), exactly like `batch.pledgeAmount`, `payment.amount`, `donation`. No `Float`/`Decimal` in the commerce schema — ever.
3. **Stock is the single concurrency hotspot.** Inventory is one `StockLevel` row per `(sku, warehouse)` with `onHand`/`reserved` counters, mutated **only** inside an advisory-locked `$transaction` with `updateMany` CAS guards and a `available >= 0` invariant assertion before commit. **Multi-resource locks are acquired in a globally deterministic order** (Section 5.1) to eliminate deadlock — this is genuinely new ground for the codebase (existing services take a single per-entity lock). Reservations are short-lived `StockReservation` rows with a TTL so abandoned carts and unpaid orders never permanently leak inventory.
4. **Immutability of financial records.** Orders, order lines, invoices, and all `*Event`/`*Movement` tables are append-only or snapshot-frozen. SKU data is snapshotted onto order lines so historical orders/invoices survive catalog edits and SKU deletion. **Invoices are rendered verbatim from `OrderItem` snapshots — never re-computed** (Section 8.3).
5. **Identity is always server-pinned.** `triggeredBy`/`actorId` on every audit row is sourced from the JWT, never the request body (repo security rule `4ebf502`). Customer refresh tokens are **SHA-256-hashed + rotated** exactly like platform auth (the live `auth.service.ts` uses `createHash('sha256')`, not bcrypt — see Section 8.2) — no regression, and no new inconsistent hashing scheme.
6. **Design split.** Premium glossy/rounded "public marketing" layer lives **only** on `/`, `/store/*`, `/articles/*`. Admin + hub keep strict `DESIGN.md` (0px radius, no shadows, forest/parchment).
7. **Scalable to any user count.** Append-only audit tables get a retention/partition plan (Section 7). Read paths (catalog list, availability, analytics) are cache-friendly and never N+1; the analytics rollup uses raw SQL aggregation, not Node-side iteration (Section 8.8). Dashboards read precomputed rollups; live counters read narrow indexed queries.
8. **No `pgcrypto`.** All UUIDs are app-side `@default(uuid())`. Manual SQL migrations with `IF NOT EXISTS` guards.
9. **No silent failures on user-facing paths.** Every concurrency abort (bundle drawdown, single-warehouse allocation, slug collision, cumulative-refund overflow) maps to a specific HTTP status + message documented here, never a generic 500 (Section 9.x and Section 5.2).

---

## 2. Complete Prisma Schema Additions

Reconciliation decisions baked into the canonical schema below:

| Conflict | Spec A | Spec B | **Canonical choice** | Rationale |
|---|---|---|---|---|
| Price columns | `basePrice`/`salePrice` | `basePricePaise`/`salePricePaise` | **`basePrice`/`salePrice`** with `@map("base_price")` etc. | Repo precedent: `Payment.amount`, `batch.pledgeAmount` use plain names; "paise" lives in a comment + boundary conversion, not the field name. |
| Order line model | `OrderItem` | `OrderLine` | **`OrderItem`** | Pairs naturally with `OrderEvent`; consistent with `InvoiceLine`. |
| Cart line model | `CartItem` | `CartLine` | **`CartItem`** | Same family as `OrderItem`. |
| Tab section | `ProductTabSection` | `ProductSection` | **`ProductTabSection`** | Explicit parentage. |
| BOM line | `DiyBomItem` | `BomComponent` | **`DiyBomItem`** (supports sku **or** free-text) | Spec A's version is strictly more capable. |
| Reservation | columns on `StockLevel` | separate `StockReservation` row w/ TTL | **Both**: counters on `StockLevel` **and** `StockReservation` rows | Counters give O(1) availability; reservation rows give per-hold TTL release without scanning carts. |
| Bundle | `ComponentBundle`+`BundleItem` | `bundleSkuId` on `DiyGuide` | **`ComponentBundle`+`BundleItem`**, surfaced as a `BUNDLE`-type `Sku`; `DiyGuide.bundleId` links it | Full model is required for stock draw-down of members. |
| Tax | `TaxClass` (rates on class) | `TaxRate` (HSN lookup) | **Both**: `TaxClass` (assignable to SKU) + `TaxRate` (HSN fallback table) | SKU→class is explicit; HSN table is the fallback resolver. |
| Category | implicit `category` string | `Category` tree | **`Category` tree** + keep `Product.category` string as denormalized filter cache | Tree enables nav; string keeps cheap filtering. **Re-sync rule on category mutation — Section 8.9.** |
| `version` optimistic col on StockLevel | absent | present | **present** | Belt-and-suspenders with advisory lock; CAS on `version` is cheap. |
| Product/Article media row | persisted on confirm | persisted on confirm | **persisted as `PENDING` at presign, promoted on confirm** | Row-based cap reservation closes the parallel-presign race (Section 9). Mirrors `DocumentService` which already creates a `PENDING` Document row at presign. |
| Analytics rollup storage | extend `DailyPageStat` | new table | **new `StoreDailyStat` table (in schema, Section 2.9)** | Clean separation; was an "open decision" — now decided to unblock Phase 5. |
| DIGITAL product checkout | undefined | undefined | **422 hard-block at checkout in v1** (Section 8.10) | Enum kept for forward-compat; behavior defined so it's not a data-integrity hole. |

### 2.1 Enums

```prisma
// ─── COMMERCE ENUMS ──────────────────────────────────────
enum ProductStatus    { DRAFT  ACTIVE  ARCHIVED }            // public read only ACTIVE
enum ProductType      { STANDARD  BUNDLE  DIGITAL }          // BUNDLE=DIY full set; DIGITAL skips stock/shipment AND is 422-blocked at checkout in v1
enum ProductMediaType { IMAGE  VIDEO }                        // product cap: 10 IMAGE + 1 VIDEO (service-enforced, row-reserved)
enum ProductMediaStatus { PENDING  CONFIRMED }               // PENDING reserves the cap slot at presign; CONFIRMED after HeadObject
enum ProductTabSectionType { RICH_TEXT  SPEC_TABLE  MEDIA  CODE  CALLOUT }
enum PriceTierKind    { QUANTITY }
enum TaxRateType      { GST }

enum StockMovementType   { IN  OUT  ADJUST  RESERVE  RELEASE  TRANSFER  RETURN }
enum StockMovementReason { PURCHASE  SALE  RETURN  MANUAL_ADJUST  TRANSFER  RESERVATION  RELEASE  DAMAGE  CYCLE_COUNT }
enum ReservationStatus   { ACTIVE  CONSUMED  RELEASED  EXPIRED }

enum SupplierStatus      { ACTIVE  INACTIVE }
enum PurchaseOrderStatus { DRAFT  SUBMITTED  PARTIALLY_RECEIVED  RECEIVED  CANCELLED }

enum CustomerType  { GUEST  REGISTERED }
enum AddressType   { BILLING  SHIPPING }
enum CartStatus    { ACTIVE  CONVERTED  ABANDONED  EXPIRED }

enum OrderStatus        { PENDING_PAYMENT  PAID  CONFIRMED  PROCESSING  PACKED  SHIPPED  DELIVERED  CANCELLED  REFUNDED  PARTIALLY_REFUNDED }
enum OrderPaymentStatus { UNPAID  PAID  REFUNDED  PARTIALLY_REFUNDED }
enum OrderEventType     { CREATED  PAYMENT_AUTHORIZED  PAYMENT_CAPTURED  PAYMENT_FAILED  CONFIRMED  PACKED  SHIPPED  DELIVERED  CANCELLED  REFUND_INITIATED  REFUNDED  NOTE }

enum CouponType   { PERCENT  FIXED }                          // PERCENT=basis points; FIXED=paise
enum CouponStatus { ACTIVE  DISABLED  EXPIRED }

enum Courier        { DELHIVERY  BLUEDART  SHIPROCKET  DTDC  INDIA_POST  OTHER }
enum ShipmentStatus { PENDING  LABEL_CREATED  PICKED_UP  IN_TRANSIT  OUT_FOR_DELIVERY  DELIVERED  FAILED  RETURNED }

enum ReturnStatus { REQUESTED  APPROVED  REJECTED  IN_TRANSIT  RECEIVED  REFUNDED  CANCELLED }
enum ReturnReason { DEFECTIVE  WRONG_ITEM  NOT_AS_DESCRIBED  DAMAGED_IN_TRANSIT  NO_LONGER_NEEDED  OTHER }
enum RefundStatus { PENDING  PROCESSING  COMPLETED  FAILED }

enum InvoiceStatus { DRAFT  ISSUED  CANCELLED }
enum InvoiceType   { TAX_INVOICE  CREDIT_NOTE }

// ─── ARTICLES ENUMS ──────────────────────────────────────
enum ArticleStatus     { SUBMITTED  APPROVED  REJECTED  PUBLISHED }  // PUBLISHED is publicly listable
enum ArticleMediaType  { IMAGE  VIDEO }                              // article cap: 15 IMAGE + 3 VIDEO
enum ArticleMediaStatus { PENDING  CONFIRMED }                       // same row-reserved cap pattern as product media
enum ArticleAuthorType { CUSTOMER  APPLICANT }                       // dual-issuer authorship (Section 8.11)

// NOTE: CustomerRole is NOT added to AdminRole. Customer JWTs carry role="CUSTOMER"
// minted by a dedicated customer-auth surface (see Section 8.2), validated by a DEDICATED
// Passport strategy 'jwt-customer' so they never reach the platform validateUser() / refreshToken()
// admin else-branch. GstTaxType (CGST/SGST/IGST) is computed, never persisted as an enum on a row.
```

### 2.2 Catalog

```prisma
model Product {
  id               String        @id @default(uuid()) @db.Uuid
  slug             String        @unique
  name             String
  subtitle         String?
  brand            String?
  shortDescription String?       @map("short_description") @db.Text
  status           ProductStatus @default(DRAFT)
  type             ProductType   @default(STANDARD)
  categoryId       String?       @map("category_id") @db.Uuid
  category         String?       // denormalized filter cache; re-synced on category ancestry change (Section 8.9)
  tags             String[]
  isFeatured       Boolean       @default(false) @map("is_featured")
  sortOrder        Int           @default(0) @map("sort_order")
  seoTitle         String?       @map("seo_title")
  seoDescription   String?       @map("seo_description") @db.Text
  viewCount        Int           @default(0) @map("view_count")  // updated via batched queue job, NOT inline (Section 8.12)
  publishedAt      DateTime?     @map("published_at")
  createdAt        DateTime      @default(now()) @map("created_at")
  updatedAt        DateTime      @updatedAt @map("updated_at")

  categoryRef Category?       @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  media       ProductMedia[]
  tabs        ProductTab[]
  skus        Sku[]
  diyGuide    DiyGuide?
  bundle      ComponentBundle?
  bomReferences DiyBomItem[]  @relation("BomProductRef")

  @@index([status])
  @@index([categoryId])
  @@index([isFeatured])
  @@index([sortOrder])
  @@index([slug])
  @@map("products")
}

model Category {
  id        String     @id @default(uuid()) @db.Uuid
  slug      String     @unique
  name      String
  parentId  String?    @map("parent_id") @db.Uuid
  sortOrder Int        @default(0) @map("sort_order")
  createdAt DateTime   @default(now()) @map("created_at")
  updatedAt DateTime   @updatedAt @map("updated_at")

  // onDelete: SetNull → deleting a parent orphans its children to root level (NOT cascade-delete).
  // This is intentional. The catalog service MUST, on category delete or re-parent, re-sync the
  // denormalized Product.category string for all affected products (Section 8.9).
  parent   Category?  @relation("CatTree", fields: [parentId], references: [id], onDelete: SetNull)
  children Category[] @relation("CatTree")
  products Product[]

  @@index([parentId])
  @@map("categories")
}

model ProductMedia {
  id        String             @id @default(uuid()) @db.Uuid
  productId String             @map("product_id") @db.Uuid
  type      ProductMediaType   @default(IMAGE)
  status    ProductMediaStatus @default(PENDING) @map("status") // PENDING reserves cap slot at presign
  s3Key     String             @map("s3_key")
  url       String?            // optional CDN/public URL if mirrored
  caption   String?
  altText   String?            @map("alt_text")
  sortOrder Int                @default(0) @map("sort_order")
  createdAt DateTime           @default(now()) @map("created_at")
  updatedAt DateTime           @updatedAt @map("updated_at")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  // Cap is enforced by counting rows of (productId, type) where status='PENDING' OR 'CONFIRMED'.
  // PENDING rows older than the presign-URL TTL are swept by store-media-gc cron (Section 7).
  @@index([productId, type, status])
  @@index([productId, sortOrder])
  @@map("product_media")
}

model ProductTab {
  id        String   @id @default(uuid()) @db.Uuid
  productId String   @map("product_id") @db.Uuid
  title     String
  sortOrder Int      @default(0) @map("sort_order")
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  product  Product             @relation(fields: [productId], references: [id], onDelete: Cascade)
  sections ProductTabSection[]

  @@index([productId, sortOrder])
  @@map("product_tabs")
}

model ProductTabSection {
  id        String                @id @default(uuid()) @db.Uuid
  tabId     String                @map("tab_id") @db.Uuid
  type      ProductTabSectionType @default(RICH_TEXT)
  title     String?
  content   Json                  @default("{}") // RICH_TEXT{html}; SPEC_TABLE{rows:[{k,v}]}; MEDIA{items:[{url,type,caption}]}; CODE{language,code}; CALLOUT{variant,body}
  sortOrder Int                   @default(0) @map("sort_order")
  createdAt DateTime              @default(now()) @map("created_at")
  updatedAt DateTime              @updatedAt @map("updated_at")

  tab ProductTab @relation(fields: [tabId], references: [id], onDelete: Cascade)

  @@index([tabId, sortOrder])
  @@map("product_tab_sections")
}

model Sku {
  id                String   @id @default(uuid()) @db.Uuid
  productId         String   @map("product_id") @db.Uuid
  skuCode           String   @unique @map("sku_code")
  barcode           String?  @unique
  name              String?  // variant label e.g. 'ESP32-WROOM-32 / 4MB'
  variantAttributes Json     @default("{}") @map("variant_attributes")
  hsnCode           String?  @map("hsn_code")
  taxClassId        String?  @map("tax_class_id") @db.Uuid
  basePrice         Int      @map("base_price")  // integer paise (MRP/list)
  salePrice         Int?     @map("sale_price")  // integer paise; null = no sale
  saleStartsAt      DateTime? @map("sale_starts_at")
  saleEndsAt        DateTime? @map("sale_ends_at")
  currency          String   @default("INR")
  weightGrams       Int?     @map("weight_grams")
  lengthMm          Int?     @map("length_mm")
  widthMm           Int?     @map("width_mm")
  heightMm          Int?     @map("height_mm")
  reorderPoint      Int      @default(0) @map("reorder_point")
  reorderQty        Int      @default(0) @map("reorder_qty")
  isActive          Boolean  @default(true) @map("is_active")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  product        Product             @relation(fields: [productId], references: [id], onDelete: Cascade)
  taxClass       TaxClass?           @relation(fields: [taxClassId], references: [id], onDelete: SetNull)
  priceTiers     PriceTier[]
  stockLevels    StockLevel[]
  stockMovements StockMovement[]
  reservations   StockReservation[]
  cartItems      CartItem[]
  orderItems     OrderItem[]
  poLines        PurchaseOrderLine[]
  returnItems    ReturnItem[]
  bundleMembers  BundleItem[]        @relation("BundleMemberSku")
  bundleAsSku    ComponentBundle?    @relation("BundleSellableSku")
  bomItems       DiyBomItem[]        @relation("BomSkuRef")

  @@index([productId])
  @@index([taxClassId])
  @@index([isActive])
  @@map("skus")
}

model PriceTier {
  id         String        @id @default(uuid()) @db.Uuid
  skuId      String        @map("sku_id") @db.Uuid
  kind       PriceTierKind @default(QUANTITY)
  minQty     Int           @map("min_qty")
  unitPrice  Int           @map("unit_price") // integer paise
  createdAt  DateTime      @default(now()) @map("created_at")
  updatedAt  DateTime      @updatedAt @map("updated_at")

  sku Sku @relation(fields: [skuId], references: [id], onDelete: Cascade)

  @@unique([skuId, minQty])
  @@index([skuId])
  @@map("price_tiers")
}

model TaxClass {
  id        String      @id @default(uuid()) @db.Uuid
  name      String      @unique // 'GST 18%'
  type      TaxRateType @default(GST)
  hsnCode   String?     @map("hsn_code")
  cgstBps   Int         @default(0) @map("cgst_bps")
  sgstBps   Int         @default(0) @map("sgst_bps")
  igstBps   Int         @default(0) @map("igst_bps")
  isActive  Boolean     @default(true) @map("is_active")
  createdAt DateTime    @default(now()) @map("created_at")
  updatedAt DateTime    @updatedAt @map("updated_at")

  skus Sku[]

  @@index([hsnCode])
  @@index([isActive])
  @@map("tax_classes")
}

model TaxRate {
  id            String      @id @default(uuid()) @db.Uuid
  hsnCode       String      @unique @map("hsn_code")
  type          TaxRateType @default(GST)
  totalGstBps   Int         @map("total_gst_bps") // 1800 = 18%
  description   String?
  effectiveFrom DateTime    @default(now()) @map("effective_from")
  createdAt     DateTime    @default(now()) @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")

  @@index([hsnCode])
  @@map("tax_rates")
}
```

### 2.3 Inventory & Procurement

```prisma
model Warehouse {
  id          String   @id @default(uuid()) @db.Uuid
  code        String   @unique
  name        String
  addressLine1 String? @map("address_line1")
  addressLine2 String? @map("address_line2")
  city        String?
  stateCode   String?  @map("state_code") // GST place-of-supply (seller side)
  postalCode  String?  @map("postal_code")
  country     String   @default("IN")
  gstin       String?  // per-warehouse GSTIN; invoice seller GSTIN resolves from the fulfilling warehouse (Section 8.3)
  priority    Int      @default(0) // fulfillment preference
  isActive    Boolean  @default(true) @map("is_active")
  isDefault   Boolean  @default(false) @map("is_default")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  stockLevels    StockLevel[]
  stockMovements StockMovement[]
  reservations   StockReservation[]
  purchaseOrders PurchaseOrder[]
  shipments      Shipment[]

  @@index([isActive])
  @@map("warehouses")
}

model StockLevel {
  id           String   @id @default(uuid()) @db.Uuid
  skuId        String   @map("sku_id") @db.Uuid
  warehouseId  String   @map("warehouse_id") @db.Uuid
  onHand       Int      @default(0) @map("on_hand")
  reserved     Int      @default(0)
  reorderPoint Int      @default(0) @map("reorder_point")
  reorderQty   Int      @default(0) @map("reorder_qty")
  safetyStock  Int      @default(0) @map("safety_stock")
  version      Int      @default(0) // optimistic-lock counter, bumped on every CAS
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  sku       Sku       @relation(fields: [skuId], references: [id], onDelete: Cascade)
  warehouse Warehouse @relation(fields: [warehouseId], references: [id], onDelete: Cascade)

  @@unique([skuId, warehouseId]) // THE oversell guard
  @@index([warehouseId])
  @@index([skuId])
  @@map("stock_levels")
}

model StockMovement {
  id            String               @id @default(uuid()) @db.Uuid
  skuId         String               @map("sku_id") @db.Uuid
  warehouseId   String               @map("warehouse_id") @db.Uuid
  type          StockMovementType
  reason        StockMovementReason  @default(MANUAL_ADJUST)
  quantity      Int                  // signed onHand delta (+in / -out)
  reservedDelta Int                  @default(0) @map("reserved_delta")
  balanceAfter  Int?                 @map("balance_after") // onHand snapshot post-apply
  referenceType String?              @map("reference_type") // ORDER|PO|RETURN|TRANSFER|ADJUSTMENT
  referenceId   String?              @map("reference_id") @db.Uuid
  triggeredBy   String               @map("triggered_by") // JWT sub or SYSTEM
  actorRole     String?              @map("actor_role")
  note          String?              @db.Text
  createdAt     DateTime             @default(now()) @map("created_at")

  sku       Sku       @relation(fields: [skuId], references: [id], onDelete: Cascade)
  warehouse Warehouse @relation(fields: [warehouseId], references: [id], onDelete: Cascade)

  @@index([skuId, warehouseId])
  @@index([referenceType, referenceId])
  @@index([createdAt])
  @@map("stock_movements")
}

model StockReservation {
  id          String            @id @default(uuid()) @db.Uuid
  orderId     String?           @map("order_id") @db.Uuid
  cartId      String?           @map("cart_id") @db.Uuid
  skuId       String            @map("sku_id") @db.Uuid
  warehouseId String            @map("warehouse_id") @db.Uuid
  quantity    Int
  status      ReservationStatus @default(ACTIVE)
  expiresAt   DateTime          @map("expires_at")
  createdAt   DateTime          @default(now()) @map("created_at")
  updatedAt   DateTime          @updatedAt @map("updated_at")

  order     Order?    @relation(fields: [orderId], references: [id], onDelete: SetNull)
  sku       Sku       @relation(fields: [skuId], references: [id], onDelete: Restrict)
  warehouse Warehouse @relation(fields: [warehouseId], references: [id], onDelete: Restrict)

  @@index([status, expiresAt]) // cron sweep
  @@index([orderId])
  @@index([cartId])
  @@index([skuId, warehouseId])
  @@map("stock_reservations")
}

model Supplier {
  id           String         @id @default(uuid()) @db.Uuid
  name         String
  code         String?        @unique
  contactName  String?        @map("contact_name")
  email        String?
  phone        String?
  gstin        String?
  addressLine1 String?        @map("address_line1")
  city         String?
  stateCode    String?        @map("state_code")
  status       SupplierStatus @default(ACTIVE)
  leadTimeDays Int?           @map("lead_time_days")
  notes        String?        @db.Text
  createdAt    DateTime       @default(now()) @map("created_at")
  updatedAt    DateTime       @updatedAt @map("updated_at")

  purchaseOrders PurchaseOrder[]

  @@index([status])
  @@map("suppliers")
}

model PurchaseOrder {
  id            String              @id @default(uuid()) @db.Uuid
  poNumber      String              @unique @map("po_number")
  supplierId    String              @map("supplier_id") @db.Uuid
  warehouseId   String              @map("warehouse_id") @db.Uuid
  status        PurchaseOrderStatus @default(DRAFT)
  subtotal      Int                 @default(0) // paise
  taxTotal      Int                 @default(0) @map("tax_total")
  grandTotal    Int                 @default(0) @map("grand_total")
  currency      String              @default("INR")
  expectedAt    DateTime?           @map("expected_at")
  submittedAt   DateTime?           @map("submitted_at")
  receivedAt    DateTime?           @map("received_at")
  autoGenerated Boolean             @default(false) @map("auto_generated")
  createdById   String?             @map("created_by_id")
  notes         String?             @db.Text
  createdAt     DateTime            @default(now()) @map("created_at")
  updatedAt     DateTime            @updatedAt @map("updated_at")

  supplier  Supplier            @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  warehouse Warehouse           @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  lines     PurchaseOrderLine[]

  @@index([supplierId])
  @@index([warehouseId])
  @@index([status])
  @@map("purchase_orders")
}

model PurchaseOrderLine {
  id              String   @id @default(uuid()) @db.Uuid
  purchaseOrderId String   @map("purchase_order_id") @db.Uuid
  skuId           String   @map("sku_id") @db.Uuid
  lotNo           Int      @default(1) @map("lot_no") // distinguishes multiple lots of the same SKU at different unit costs
  orderedQty      Int      @map("ordered_qty")
  receivedQty     Int      @default(0) @map("received_qty")
  unitCost        Int      @map("unit_cost") // paise
  taxBps          Int      @default(0) @map("tax_bps")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  sku           Sku           @relation(fields: [skuId], references: [id], onDelete: Restrict)

  // Unique on (po, sku, lotNo) — NOT (po, sku). Same SKU may appear on multiple lines as separate
  // lots/price points. The receive flow targets a specific line id, so per-line received_qty CAS
  // remains correct. Service-layer may aggregate display by SKU.
  @@unique([purchaseOrderId, skuId, lotNo])
  @@index([purchaseOrderId])
  @@index([skuId])
  @@map("purchase_order_lines")
}
```

### 2.4 Customers, Cart, Orders

```prisma
model Customer {
  id            String       @id @default(uuid()) @db.Uuid
  type          CustomerType @default(GUEST)
  email         String?
  phone         String?
  firstName     String?      @map("first_name")
  lastName      String?      @map("last_name")
  passwordHash  String?      @map("password_hash") // null for GUEST; bcrypt for REGISTERED (passwords are bcrypt; refresh TOKENS are SHA-256 — Section 8.2)
  emailVerified Boolean      @default(false) @map("email_verified")
  applicantId   String?      @unique @map("applicant_id") @db.Uuid
  isActive      Boolean      @default(true) @map("is_active")
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt @map("updated_at")

  applicant         Applicant?          @relation(fields: [applicantId], references: [id], onDelete: SetNull)
  addresses         Address[]
  carts             Cart[]
  orders            Order[]
  returns           Return[]
  couponRedemptions CouponRedemption[]

  // Partial-unique on email for REGISTERED only is enforced in the migration (see Section 3);
  // guests may share NULL email. Coupon per-customer-limit dedupes on REGISTERED identity
  // (email/phone), NOT on Customer.id, to defeat guest-account farming (Section 8.13).
  @@index([email])
  @@index([phone])
  @@index([applicantId])
  @@map("customers")
}

model Address {
  id         String      @id @default(uuid()) @db.Uuid
  customerId String      @map("customer_id") @db.Uuid
  type       AddressType @default(SHIPPING)
  fullName   String      @map("full_name")
  phone      String?
  line1      String
  line2      String?
  city       String
  stateCode  String      @map("state_code") // GST place-of-supply
  postalCode String      @map("postal_code")
  country    String      @default("IN")
  isDefault  Boolean     @default(false) @map("is_default")
  createdAt  DateTime    @default(now()) @map("created_at")
  updatedAt  DateTime    @updatedAt @map("updated_at")

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([customerId, type])
  @@map("addresses")
}

model Cart {
  id            String     @id @default(uuid()) @db.Uuid
  customerId    String?    @map("customer_id") @db.Uuid
  sessionTokenHash String? @unique @map("session_token_hash") // SHA-256 of the signed guest token; raw token never stored
  status        CartStatus @default(ACTIVE)
  couponId      String?    @map("coupon_id") @db.Uuid
  expiresAt     DateTime?  @map("expires_at")
  createdAt     DateTime   @default(now()) @map("created_at")
  updatedAt     DateTime   @updatedAt @map("updated_at")

  customer Customer?  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  coupon   Coupon?    @relation(fields: [couponId], references: [id], onDelete: SetNull)
  items    CartItem[]

  // Guest cart access is guarded by GuestCartGuard: the raw signed token from the X-Cart-Token
  // header is hashed and matched against sessionTokenHash. Knowing the Cart.id (a UUID that leaks
  // via URLs/receipts) is NOT sufficient to read/mutate a cart (Section 9, IDOR fix).
  @@index([customerId, status])
  @@index([status, expiresAt])
  @@map("carts")
}

model CartItem {
  id                 String   @id @default(uuid()) @db.Uuid
  cartId             String   @map("cart_id") @db.Uuid
  skuId              String   @map("sku_id") @db.Uuid
  quantity           Int      @default(1)
  unitPriceSnapshot  Int      @map("unit_price_snapshot") // paise at add time (display only; re-priced at checkout)
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  cart Cart @relation(fields: [cartId], references: [id], onDelete: Cascade)
  sku  Sku  @relation(fields: [skuId], references: [id], onDelete: Restrict)

  @@unique([cartId, skuId]) // merge same-sku adds
  @@index([cartId])
  @@index([skuId])
  @@map("cart_items")
}

model Order {
  id                  String             @id @default(uuid()) @db.Uuid
  orderNumber         String             @unique @map("order_number")
  customerId          String             @map("customer_id") @db.Uuid
  guestEmail          String?            @map("guest_email")
  guestPhone          String?            @map("guest_phone")
  guestAccessTokenHash String?           @unique @map("guest_access_token_hash") // SHA-256 of a signed guest order-access token; lets guests view order/tracking/invoice without an account
  status              OrderStatus        @default(PENDING_PAYMENT)
  paymentStatus       OrderPaymentStatus @default(UNPAID) @map("payment_status")
  currency            String             @default("INR")
  itemsSubtotal       Int                @default(0) @map("items_subtotal") // pre-tax pre-discount
  discountTotal       Int                @default(0) @map("discount_total")
  cgstTotal           Int                @default(0) @map("cgst_total")
  sgstTotal           Int                @default(0) @map("sgst_total")
  igstTotal           Int                @default(0) @map("igst_total")
  taxTotal            Int                @default(0) @map("tax_total")
  shippingTotal       Int                @default(0) @map("shipping_total")
  grandTotal          Int                @default(0) @map("grand_total")
  refundedTotal       Int                @default(0) @map("refunded_total")
  couponId            String?            @map("coupon_id") @db.Uuid
  couponCodeSnapshot  String?            @map("coupon_code_snapshot")
  billingAddress      Json               @map("billing_address")
  shippingAddress     Json               @map("shipping_address")
  placeOfSupplyState  String?            @map("place_of_supply_state") // buyer state code
  sellerStateCode     String?            @map("seller_state_code")
  sellerGstinSnapshot String?            @map("seller_gstin_snapshot")  // GSTIN of fulfilling warehouse, frozen at order time
  isInterState        Boolean            @default(false) @map("is_inter_state")
  fulfilledFromWarehouseId String?       @map("fulfilled_from_warehouse_id") @db.Uuid
  razorpayOrderId     String?            @unique @map("razorpay_order_id")
  razorpayPaymentId   String?            @unique @map("razorpay_payment_id")
  placedAt            DateTime?          @map("placed_at")
  paidAt              DateTime?          @map("paid_at")
  createdAt           DateTime           @default(now()) @map("created_at")
  updatedAt           DateTime           @updatedAt @map("updated_at")

  customer         Customer           @relation(fields: [customerId], references: [id], onDelete: Restrict)
  coupon           Coupon?            @relation(fields: [couponId], references: [id], onDelete: SetNull)
  items            OrderItem[]
  events           OrderEvent[]
  reservations     StockReservation[]
  shipments        Shipment[]
  returns          Return[]
  invoices         Invoice[]
  couponRedemption CouponRedemption?

  @@index([customerId])
  @@index([status])
  @@index([paymentStatus])
  @@index([createdAt])
  @@map("orders")
}

model OrderItem {
  id              String   @id @default(uuid()) @db.Uuid
  orderId         String   @map("order_id") @db.Uuid
  skuId           String?  @map("sku_id") @db.Uuid // SetNull for historical integrity
  skuCodeSnapshot String   @map("sku_code_snapshot")
  nameSnapshot    String   @map("name_snapshot")
  variantSnapshot Json?    @map("variant_snapshot")
  hsnCodeSnapshot String?  @map("hsn_code_snapshot")
  gstBpsSnapshot  Int      @default(0) @map("gst_bps_snapshot")
  cgstBpsSnapshot Int      @default(0) @map("cgst_bps_snapshot")
  sgstBpsSnapshot Int      @default(0) @map("sgst_bps_snapshot")
  igstBpsSnapshot Int      @default(0) @map("igst_bps_snapshot")
  quantity        Int
  unitPrice       Int      @map("unit_price")     // paise, after tier/sale, pre-tax
  lineSubtotal    Int      @map("line_subtotal")  // unitPrice*qty
  lineDiscount    Int      @default(0) @map("line_discount")
  taxableValue    Int      @map("taxable_value")  // lineSubtotal - lineDiscount
  cgstAmount      Int      @default(0) @map("cgst_amount")
  sgstAmount      Int      @default(0) @map("sgst_amount")
  igstAmount      Int      @default(0) @map("igst_amount")
  lineTotal       Int      @map("line_total")     // taxableValue + taxes
  warehouseId     String?  @map("warehouse_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")

  // These per-line amounts are the SINGLE SOURCE OF TRUTH for the invoice. The invoicing module
  // copies them verbatim into InvoiceLine — it never re-computes tax (Section 8.3 + 9 finding).
  order       Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  sku         Sku?         @relation(fields: [skuId], references: [id], onDelete: SetNull)
  returnItems ReturnItem[]

  @@index([orderId])
  @@index([skuId])
  @@map("order_items")
}

model OrderEvent {
  id          String         @id @default(uuid()) @db.Uuid
  orderId     String         @map("order_id") @db.Uuid
  type        OrderEventType
  fromStatus  String?        @map("from_status")
  toStatus    String?        @map("to_status")
  note        String?        @db.Text
  triggeredBy String?        @map("triggered_by") // from JWT
  actorRole   String?        @map("actor_role")
  metadata    Json?
  createdAt   DateTime       @default(now()) @map("created_at")

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId])
  @@index([type])
  @@index([createdAt])
  @@map("order_events")
}
```

### 2.5 Coupons, Shipping, Returns, Invoicing

```prisma
model Coupon {
  id               String       @id @default(uuid()) @db.Uuid
  code             String       @unique
  description      String?
  type             CouponType   @default(PERCENT)
  value            Int          // PERCENT: basis points; FIXED: paise
  maxDiscount      Int?         @map("max_discount") // cap for PERCENT, paise
  minOrderValue    Int          @default(0) @map("min_order_value") // paise
  status           CouponStatus @default(ACTIVE)
  usageLimit       Int?         @map("usage_limit") // null = unlimited
  usedCount        Int          @default(0) @map("used_count")
  perCustomerLimit Int          @default(1) @map("per_customer_limit")
  allowGuest       Boolean      @default(false) @map("allow_guest") // if false, coupon requires REGISTERED customer (anti-farming default)
  startsAt         DateTime?    @map("starts_at")
  expiresAt        DateTime?    @map("expires_at")
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")

  redemptions CouponRedemption[]
  carts       Cart[]
  orders      Order[]

  @@index([status])
  @@index([expiresAt])
  @@map("coupons")
}

model CouponRedemption {
  id              String   @id @default(uuid()) @db.Uuid
  couponId        String   @map("coupon_id") @db.Uuid
  customerId      String   @map("customer_id") @db.Uuid
  redeemerEmail   String?  @map("redeemer_email") // normalized lowercase; the per-customer dedup key
  redeemerPhone   String?  @map("redeemer_phone")
  orderId         String   @unique @map("order_id") @db.Uuid
  discountApplied Int      @map("discount_applied") // paise
  createdAt       DateTime @default(now()) @map("created_at")

  coupon   Coupon   @relation(fields: [couponId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  order    Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  // per-customer usage is counted by (couponId, redeemerEmail) — NOT (couponId, customerId) —
  // so a single human cannot farm the limit by spawning guest Customer rows (Section 8.13).
  @@unique([couponId, orderId]) // double-redeem guard per order
  @@index([couponId, redeemerEmail]) // per-customer usage count (anti-farming)
  @@index([couponId, customerId])
  @@index([customerId])
  @@map("coupon_redemptions")
}

model Shipment {
  id           String         @id @default(uuid()) @db.Uuid
  orderId      String         @map("order_id") @db.Uuid
  warehouseId  String?        @map("warehouse_id") @db.Uuid
  courier      Courier        @default(OTHER)
  awb          String?        @unique
  trackingUrl  String?        @map("tracking_url")
  status       ShipmentStatus @default(PENDING)
  shippingCost Int            @default(0) @map("shipping_cost") // paise
  weightGrams  Int?           @map("weight_grams")
  labelS3Key   String?        @map("label_s3_key")
  shippedAt    DateTime?      @map("shipped_at")
  deliveredAt  DateTime?      @map("delivered_at")
  lastSyncedAt DateTime?      @map("last_synced_at")
  createdAt    DateTime       @default(now()) @map("created_at")
  updatedAt    DateTime       @updatedAt @map("updated_at")

  order     Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  warehouse Warehouse?      @relation(fields: [warehouseId], references: [id], onDelete: SetNull)
  events    ShipmentEvent[]

  @@index([orderId])
  @@index([status])
  @@index([awb])
  @@index([lastSyncedAt])
  @@map("shipments")
}

model ShipmentEvent {
  id             String         @id @default(uuid()) @db.Uuid
  shipmentId     String         @map("shipment_id") @db.Uuid
  status         ShipmentStatus
  courierEventId String?        @map("courier_event_id") // courier-side id for dedupe
  description    String?
  location       String?
  occurredAt     DateTime       @map("occurred_at")
  rawPayload     Json?          @map("raw_payload")
  createdAt      DateTime       @default(now()) @map("created_at")

  shipment Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)

  @@unique([shipmentId, courierEventId]) // idempotent tracking ingest
  @@index([shipmentId])
  @@index([occurredAt])
  @@map("shipment_events")
}

model Return {
  id                  String       @id @default(uuid()) @db.Uuid
  rmaNumber           String       @unique @map("rma_number")
  orderId             String       @map("order_id") @db.Uuid
  customerId          String       @map("customer_id") @db.Uuid
  status              ReturnStatus @default(REQUESTED)
  reason              ReturnReason @default(OTHER)
  comment             String?      @db.Text
  refundAmount        Int          @default(0) @map("refund_amount") // paise
  refundStatus        RefundStatus @default(PENDING) @map("refund_status")
  razorpayRefundId    String?      @unique @map("razorpay_refund_id")
  restockWarehouseId  String?      @map("restock_warehouse_id") @db.Uuid
  approvedById        String?      @map("approved_by_id")
  approvedAt          DateTime?    @map("approved_at")
  receivedAt          DateTime?    @map("received_at")
  refundedAt          DateTime?    @map("refunded_at")
  createdAt           DateTime     @default(now()) @map("created_at")
  updatedAt           DateTime     @updatedAt @map("updated_at")

  order    Order        @relation(fields: [orderId], references: [id], onDelete: Restrict) // legal record
  customer Customer     @relation(fields: [customerId], references: [id], onDelete: Cascade)
  items    ReturnItem[]

  @@index([orderId])
  @@index([customerId])
  @@index([status])
  @@map("returns")
}

model ReturnItem {
  id           String   @id @default(uuid()) @db.Uuid
  returnId     String   @map("return_id") @db.Uuid
  orderItemId  String   @map("order_item_id") @db.Uuid
  skuId        String?  @map("sku_id") @db.Uuid
  quantity     Int
  refundAmount Int      @default(0) @map("refund_amount") // paise incl. proportional tax
  restocked    Boolean  @default(false)
  createdAt    DateTime @default(now()) @map("created_at")

  return    Return    @relation(fields: [returnId], references: [id], onDelete: Cascade)
  orderItem OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  sku       Sku?      @relation(fields: [skuId], references: [id], onDelete: SetNull)

  @@unique([returnId, orderItemId])
  @@index([returnId])
  @@index([orderItemId])
  @@map("return_items")
}

model Invoice {
  id                 String        @id @default(uuid()) @db.Uuid
  invoiceNumber      String        @unique @map("invoice_number") // ARYA/2026-27/000123
  type               InvoiceType   @default(TAX_INVOICE)
  status             InvoiceStatus @default(DRAFT)
  orderId            String        @map("order_id") @db.Uuid
  financialYear      String        @map("financial_year") // '2026-27'
  sequenceNo         Int           @map("sequence_no")
  sellerName         String        @map("seller_name")
  sellerGstin        String?       @map("seller_gstin")        // from fulfilling warehouse (Section 8.3)
  sellerStateCode    String?       @map("seller_state_code")
  buyerName          String        @map("buyer_name")
  buyerGstin         String?       @map("buyer_gstin")
  placeOfSupplyState String?       @map("place_of_supply_state")
  isInterState       Boolean       @default(false) @map("is_inter_state")
  taxableValue       Int           @default(0) @map("taxable_value") // paise
  cgstTotal          Int           @default(0) @map("cgst_total")
  sgstTotal          Int           @default(0) @map("sgst_total")
  igstTotal          Int           @default(0) @map("igst_total")
  grandTotal         Int           @default(0) @map("grand_total")
  pdfS3Key           String?       @map("pdf_s3_key")
  issuedAt           DateTime?     @map("issued_at")
  createdAt          DateTime      @default(now()) @map("created_at")
  updatedAt          DateTime      @updatedAt @map("updated_at")

  order Order         @relation(fields: [orderId], references: [id], onDelete: Restrict)
  lines InvoiceLine[]

  @@unique([financialYear, sequenceNo]) // gapless integrity per FY (backstop to FOR-UPDATE counter)
  @@index([orderId])
  @@index([status])
  @@map("invoices")
}

model InvoiceLine {
  id           String   @id @default(uuid()) @db.Uuid
  invoiceId    String   @map("invoice_id") @db.Uuid
  description  String
  hsnCode      String?  @map("hsn_code")
  quantity     Int
  unitPrice    Int      @map("unit_price") // paise — copied verbatim from OrderItem
  taxableValue Int      @map("taxable_value")
  cgstBps      Int      @default(0) @map("cgst_bps")
  sgstBps      Int      @default(0) @map("sgst_bps")
  igstBps      Int      @default(0) @map("igst_bps")
  cgstAmount   Int      @default(0) @map("cgst_amount")
  sgstAmount   Int      @default(0) @map("sgst_amount")
  igstAmount   Int      @default(0) @map("igst_amount")
  lineTotal    Int      @map("line_total")
  createdAt    DateTime @default(now()) @map("created_at")

  invoice Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("invoice_lines")
}

model InvoiceSequence {
  financialYear String   @id @map("financial_year") // '2026-27'
  lastValue     Int      @default(0) @map("last_value")
  prefix        String   @default("ARYA")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@map("invoice_sequences")
}

// Generic gapless counter for ORDER / PO / RMA human refs (per-entity rows keyed by `scope`).
model NumberSequence {
  scope     String   @id // 'ORDER' | 'PO' | 'RMA'
  lastValue Int      @default(0) @map("last_value")
  prefix    String
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("number_sequences")
}
```

### 2.6 DIY & Bundles

```prisma
model DiyGuide {
  id               String   @id @default(uuid()) @db.Uuid
  productId        String   @unique @map("product_id") @db.Uuid
  title            String
  summary          String?  @db.Text
  difficulty       String?  // BEGINNER|INTERMEDIATE|ADVANCED (free-form)
  estimatedMinutes Int?     @map("estimated_minutes")
  bundleId         String?  @unique @map("bundle_id") @db.Uuid // buy-the-full-set bundle
  isPublished      Boolean  @default(false) @map("is_published")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  product  Product          @relation(fields: [productId], references: [id], onDelete: Cascade)
  bundle   ComponentBundle? @relation(fields: [bundleId], references: [id], onDelete: SetNull)
  steps    DiyStep[]
  bomItems DiyBomItem[]

  @@index([isPublished])
  @@map("diy_guides")
}

model DiyStep {
  id           String   @id @default(uuid()) @db.Uuid
  guideId      String   @map("guide_id") @db.Uuid
  sortOrder    Int      @default(0) @map("sort_order")
  title        String
  body         String   @db.Text
  codeLanguage String?  @map("code_language")
  code         String?  @db.Text
  media        Json?    @default("[]") // [{url,type,caption}]
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  guide DiyGuide @relation(fields: [guideId], references: [id], onDelete: Cascade)

  @@index([guideId, sortOrder])
  @@map("diy_steps")
}

model DiyBomItem {
  id           String   @id @default(uuid()) @db.Uuid
  guideId      String   @map("guide_id") @db.Uuid
  skuId        String?  @map("sku_id") @db.Uuid     // purchasable component
  productId    String?  @map("product_id") @db.Uuid // optional cross-link
  freeTextName String?  @map("free_text_name")      // tool the user supplies
  quantity     Int      @default(1)
  note         String?
  sortOrder    Int      @default(0) @map("sort_order")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  guide   DiyGuide @relation(fields: [guideId], references: [id], onDelete: Cascade)
  sku     Sku?     @relation("BomSkuRef", fields: [skuId], references: [id], onDelete: SetNull)
  product Product? @relation("BomProductRef", fields: [productId], references: [id], onDelete: SetNull)

  // Migration adds a CHECK constraint guaranteeing at least one identity column is present:
  //   CHECK (sku_id IS NOT NULL OR product_id IS NOT NULL OR free_text_name IS NOT NULL)
  @@index([guideId, sortOrder])
  @@index([skuId])
  @@index([productId])
  @@map("diy_bom_items")
}

model ComponentBundle {
  id          String   @id @default(uuid()) @db.Uuid
  productId   String?  @unique @map("product_id") @db.Uuid     // BUNDLE Product wrapper
  bundleSkuId String?  @unique @map("bundle_sku_id") @db.Uuid  // sellable Sku for the set
  name        String
  description String?  @db.Text
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  product   Product?    @relation(fields: [productId], references: [id], onDelete: SetNull)
  bundleSku Sku?        @relation("BundleSellableSku", fields: [bundleSkuId], references: [id], onDelete: SetNull)
  items     BundleItem[]
  diyGuide  DiyGuide?

  @@index([isActive])
  @@map("component_bundles")
}

model BundleItem {
  id        String   @id @default(uuid()) @db.Uuid
  bundleId  String   @map("bundle_id") @db.Uuid
  skuId     String   @map("sku_id") @db.Uuid
  quantity  Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")

  bundle ComponentBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  sku    Sku             @relation("BundleMemberSku", fields: [skuId], references: [id], onDelete: Restrict)

  @@unique([bundleId, skuId])
  @@index([bundleId])
  @@index([skuId])
  @@map("bundle_items")
}
```

### 2.7 Articles

```prisma
model Article {
  id              String            @id @default(uuid()) @db.Uuid
  slug            String            @unique
  title           String
  body            Json              // rich text blocks
  excerpt         String?           @db.Text
  coverS3Key      String?           @map("cover_s3_key")
  authorType      ArticleAuthorType @map("author_type")   // CUSTOMER | APPLICANT — must match the JWT issuer (Section 8.11)
  authorId        String            @map("author_id") @db.Uuid
  authorName      String?           @map("author_name")    // denormalized display
  status          ArticleStatus     @default(SUBMITTED)
  tags            String[]
  viewCount       Int               @default(0) @map("view_count") // batched-queue increment, not inline (Section 8.12)
  reviewedById    String?           @map("reviewed_by_id")
  rejectionReason String?           @map("rejection_reason") @db.Text
  publishedAt     DateTime?         @map("published_at")
  createdAt       DateTime          @default(now()) @map("created_at")
  updatedAt       DateTime          @updatedAt @map("updated_at")

  media ArticleMedia[]

  // Migration adds a GIN index on tags for the related-articles array-overlap (&&) query:
  //   CREATE INDEX IF NOT EXISTS "articles_tags_gin" ON "articles" USING GIN ("tags");
  @@index([status])
  @@index([authorType, authorId])
  @@index([slug])
  @@index([publishedAt])
  @@map("articles")
}

model ArticleMedia {
  id        String              @id @default(uuid()) @db.Uuid
  articleId String              @map("article_id") @db.Uuid
  type      ArticleMediaType    @default(IMAGE)
  status    ArticleMediaStatus  @default(PENDING) @map("status") // PENDING reserves cap slot at presign
  s3Key     String              @map("s3_key")
  caption   String?
  sortOrder Int                 @default(0) @map("sort_order")
  createdAt DateTime            @default(now()) @map("created_at")

  article Article @relation(fields: [articleId], references: [id], onDelete: Cascade)

  @@index([articleId, type, status])
  @@map("article_media")
}
```

### 2.8 `Applicant` back-relation

Add one back-relation field to the existing `Applicant` model (no column; relation only):

```prisma
// inside model Applicant { ... }
storeCustomer Customer?  // 1:1 optional link via Customer.applicantId
```

### 2.9 Analytics rollup (decided — was open)

```prisma
model StoreDailyStat {
  id            String   @id @default(uuid()) @db.Uuid
  statDate      DateTime @map("stat_date") @db.Date // IST day boundary
  ordersCount   Int      @default(0) @map("orders_count")
  paidOrders    Int      @default(0) @map("paid_orders")
  grossRevenue  Int      @default(0) @map("gross_revenue")  // paise, paid orders
  netRevenue    Int      @default(0) @map("net_revenue")    // paise, minus refunds
  unitsSold     Int      @default(0) @map("units_sold")
  refundsTotal  Int      @default(0) @map("refunds_total")  // paise
  discountTotal Int      @default(0) @map("discount_total") // paise
  newCustomers  Int      @default(0) @map("new_customers")
  visitors      Int      @default(0)  // rolled from Visitor/DailyPageStat
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@unique([statDate]) // idempotent upsert per day
  @@map("store_daily_stats")
}
```

---

## 3. Migration Plan

All migrations are **hand-written SQL** under `backend/prisma/migrations/<timestamp>_<name>/migration.sql`, each statement guarded with `IF NOT EXISTS` (tables, columns, indexes) or `ADD VALUE IF NOT EXISTS` (enums) — matching `20260604010000_training_sprint_lifecycle`. UUIDs are app-side; **no `pgcrypto`, no `gen_random_uuid()`**. FK creation must follow table-creation order (parents first). Run `prisma migrate deploy` in CI (`deploy-azure.yml` step 1) then `db:generate`.

Split into focused files so file-disjoint chunks can be reviewed/parallelized and a failure rolls back a small unit:

1. **`20260605000000_commerce_enums`** — `CREATE TYPE` for every commerce + articles enum (Section 2.1), including the new `ProductMediaStatus`, `ArticleMediaStatus`, `ArticleAuthorType`. Idempotent via `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;` per type. Must run first.

2. **`20260605000100_commerce_catalog`** — `categories`, `tax_classes`, `tax_rates`, `products`, `product_media` (with `status` column + `@@index([productId,type,status])`), `product_tabs`, `product_tab_sections`, `skus`, `price_tiers`. FK order: categories→products; products→(media/tabs/skus); tabs→sections; tax_classes→skus. (`categories.parent_id` self-FK added after table create.)

3. **`20260605000200_commerce_inventory`** — `warehouses` (with `gstin`), `stock_levels` (with `UNIQUE(sku_id, warehouse_id)`), `stock_movements`, `stock_reservations`, `suppliers`, `purchase_orders`, `purchase_order_lines` (with `lot_no` + `UNIQUE(purchase_order_id, sku_id, lot_no)`).

4. **`20260605000300_commerce_customers_cart`** — `customers`, `addresses`, `carts` (with `session_token_hash` unique), `cart_items`. Then the **partial unique index** for registered-customer email (Prisma can't express it, so raw SQL):
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS "customers_registered_email_key"
     ON "customers" ("email") WHERE "type" = 'REGISTERED' AND "email" IS NOT NULL;
   ```
   Add FK `customers.applicant_id → applicants.id ON DELETE SET NULL`.

5. **`20260605000400_commerce_orders`** — `orders` (with `guest_access_token_hash` unique, `seller_gstin_snapshot`), `order_items` (with `cgst_bps_snapshot`/`sgst_bps_snapshot`/`igst_bps_snapshot`), `order_events`, `number_sequences`. **Sequencing note:** `orders.coupon_id` FK references `coupons` (step 6) — create that FK in step 6. `stock_reservations.order_id` FK to `orders` added here. **Migration-runbook note:** between this step and step 6 no application code writes a non-null `coupon_id` to an order (only the live app does, which runs after all migrations apply) — so the deferred FK window is migration-execution-only.

6. **`20260605000500_commerce_coupons_fulfillment`** — `coupons` (with `allow_guest`), `coupon_redemptions` (with `redeemer_email`/`redeemer_phone` + `@@index([couponId, redeemerEmail])`), `shipments`, `shipment_events`, `returns`, `return_items`, `invoices`, `invoice_lines`, `invoice_sequences`. Add deferred FKs: `orders.coupon_id → coupons`, `carts.coupon_id → coupons`. `invoices` has `UNIQUE(financial_year, sequence_no)`.

7. **`20260605000600_commerce_diy_bundles`** — `component_bundles`, `bundle_items`, `diy_guides`, `diy_steps`, `diy_bom_items` (with the `CHECK (sku_id IS NOT NULL OR product_id IS NOT NULL OR free_text_name IS NOT NULL)` constraint). Bundle↔Sku and Bundle↔Product FKs (SetNull); `diy_guides.bundle_id` FK.

8. **`20260605000700_articles`** — `articles`, `article_media` (with `status` column). Add the **GIN index**:
   ```sql
   CREATE INDEX IF NOT EXISTS "articles_tags_gin" ON "articles" USING GIN ("tags");
   ```

9. **`20260605000750_store_analytics`** — `store_daily_stats` (Section 2.9). Independent of other commerce tables; can land anytime before Phase 5.

10. **`20260605000800_seed_commerce_defaults`** — idempotent `INSERT ... ON CONFLICT DO NOTHING`: one default `warehouses` row (`isDefault=true`, seller `stateCode` + `gstin` from SiteSettings), common `tax_classes` (GST 0/5/12/18/28%), the current `invoice_sequences` FY row, and `number_sequences` rows for `ORDER`/`PO`/`RMA`. **FY rollover:** the seed covers only the current FY; the `store-invoice-generation` job creates the new FY `invoice_sequences` row **atomically inside the numbering transaction** via `INSERT ... ON CONFLICT DO NOTHING` followed by the `FOR UPDATE` bump (Section 5.1, invoice numbering), so the first invoice of a new FY does not race two replicas into resetting `lastValue` (review finding on FY rollover).

**Cross-file rule:** keep the Prisma `schema.prisma` and the hand-written SQL in lockstep; after writing all SQL, run `prisma migrate diff` against a shadow DB locally to confirm the schema and SQL converge (the SQL is authoritative for production; the schema must match for the generated client to be correct). The partial-unique email index, the BOM `CHECK`, and the GIN index are SQL-only — note them as expected `migrate diff` deltas so they aren't "fixed" away.

---

## 4. Backend Module Inventory

All modules live under `backend/src/modules/store/<feature>/` (commerce) and `backend/src/modules/articles/` following the `*.module.ts` / `*.controller.ts` / `*.service.ts` / `dto/` pattern. A top-level `StoreModule` aggregates the commerce sub-modules and is imported by `app.module.ts`. Guards: public read = none; customer-scoped = `CustomerJwtGuard` (Passport strategy `jwt-customer`, role `CUSTOMER`); guest-cart = `GuestCartGuard`; guest-order = `GuestOrderGuard`; admin = `AdminGuard`. **Money DTOs accept/return rupees; services convert at the boundary.**

Reused services injected throughout: `PrismaService`, `NotificationService`, `DocumentService`, `SettingsService`, `VisitorService`, `ConfigService`, and the Razorpay client wrapper extracted from `PaymentService` (see Section 8.1).

### 4.0 Guards & strategies (new, cross-cutting)
- **`CustomerStrategy` / `CustomerJwtGuard`** — a **dedicated** Passport strategy named `'jwt-customer'`, registered with the same `JWT_SECRET` but its own `validate()` that looks up `Customer` by `payload.sub` and asserts `payload.role === 'CUSTOMER'`. It does **not** call the platform `validateUser()` (which else-branches to Admin). This guarantees a CUSTOMER token never resolves against an admin/applicant table and an admin/applicant token is rejected from customer routes. (Review finding: REFRESHTOKEN/strategy identity collision.)
- **`GuestCartGuard`** — reads the `X-Cart-Token` header (signed token), SHA-256-hashes it, looks up `Cart.sessionTokenHash`; rejects if no match or cart expired. A bare `Cart.id` UUID is never sufficient. Either `CustomerJwtGuard` (owns cart via `customerId`) **or** `GuestCartGuard` must pass for any cart mutation. (Review finding: IDOR on cart.)
- **`GuestOrderGuard`** — same mechanism over `Order.guestAccessTokenHash` for order/tracking/invoice read by a guest. (Review finding: IDOR on order.)
- **Dual-role article guard `ArticleAuthorGuard`** — accepts **either** the platform `jwt` strategy (role `APPLICANT`) **or** the `jwt-customer` strategy (role `CUSTOMER`). On submit it forces `Article.authorType` + `authorId` from the verified JWT (`CUSTOMER`→`Customer.id`, `APPLICANT`→`Applicant.id`) — the client cannot supply either. (Review finding: article author crossover/forgery.)

### 4.1 `catalog`
**Responsibilities:** Product/Sku/category/media/tab/section/price-tier/tax CRUD (admin) + public read of ACTIVE products. Enforces media caps **by row-reservation** (10 img/1 video) and ordering. Pipes detail views through `VisitorService.trackPageView` and **enqueues** a `Product.viewCount` increment job (not inline UPDATE — Section 8.12). No stock/money mutation. On category delete/re-parent, re-syncs the denormalized `Product.category` string for affected products (Section 8.9). Slug generation is race-safe (Section 8.14).
**Endpoints:**
- `GET /api/store/products` — public — paginated ACTIVE list (filter category/tag/featured/search/price)
- `GET /api/store/products/:slug` — public — detail (CONFIRMED media, tabs+sections, skus, tiers); records pageview
- `GET /api/store/categories` — public — category tree
- `GET /api/store/availability/:skuId` — public — aggregate available across warehouses (no reservations leaked)
- `POST /api/admin/store/products` — AdminGuard (race-safe slug)
- `PATCH /api/admin/store/products/:id` — AdminGuard (publish sets `publishedAt`)
- `DELETE /api/admin/store/products/:id` — AdminGuard (archive)
- `POST /api/admin/store/products/:id/skus` — AdminGuard (lazily creates `StockLevel` rows per active warehouse)
- `PATCH /api/admin/store/skus/:id` — AdminGuard
- `POST /api/admin/store/skus/:id/price-tiers` — AdminGuard
- `POST /api/admin/store/products/:id/media/presign` — AdminGuard (**row-reservation cap check**: insert `ProductMedia(status=PENDING)` then issue URL; reject if PENDING+CONFIRMED count would exceed cap)
- `POST /api/admin/store/products/:id/media/confirm` — AdminGuard (HeadObject size check, then flip `PENDING→CONFIRMED`; on failure delete the PENDING row + S3 object)
- `PUT /api/admin/store/products/:id/tabs` — AdminGuard (replace ordered tabs/sections tree)
- `GET/POST /api/admin/store/tax-classes` — AdminGuard
- `GET/POST /api/admin/store/categories` — AdminGuard (delete/re-parent triggers `Product.category` re-sync)
**DTOs:** `CreateProductDto`, `UpdateProductDto`, `ProductQueryDto`, `CreateSkuDto`, `UpdateSkuDto`, `CreatePriceTierDto`, `PresignMediaDto`, `ConfirmMediaDto`, `UpsertTabsDto`, `CreateTaxClassDto`, `CreateCategoryDto`.
**Reuses:** `DocumentService` (presign/confirm/S3), `VisitorService`, `store-jobs` (view-count increment).

### 4.2 `inventory`
**Responsibilities:** Owns `StockLevel`, `StockMovement`, `StockReservation`. Exposes internal primitives `reserveMany(lines[])`, `releaseStock()`, `fulfillStock()`, `restock()`, `adjust()`, `transfer()`. **`reserveMany` is the multi-SKU entry point** — it sorts the lines into the global lock order (Section 5.1) and acquires every lock before any mutation, so the deadlock the reviewer flagged cannot occur. Every mutation: advisory lock per `(sku,warehouse)` + `updateMany` CAS on `version` + invariant assert + `StockMovement` row (`triggeredBy` from JWT). Emits to `/store/stock` and enqueues low-stock/reorder.
**Endpoints:**
- `GET /api/admin/store/inventory` — AdminGuard — stock matrix (available computed)
- `GET /api/admin/store/inventory/:skuId` — AdminGuard — levels + recent movements
- `POST /api/admin/store/inventory/adjust` — AdminGuard
- `POST /api/admin/store/inventory/transfer` — AdminGuard (two locks ordered by global rule to avoid deadlock)
- `GET /api/admin/store/stock/movements` — AdminGuard — ledger
- `GET /api/admin/store/stock/reorder` — AdminGuard — below-reorder
**DTOs:** `StockAdjustDto`, `StockTransferDto`, `CreateWarehouseDto`.
**Reuses:** `NotificationService` (low-stock alerts), store-realtime gateway.

### 4.3 `procurement`
**Responsibilities:** Suppliers + POs + receiving. Receiving increments a **specific line's** `receivedQty` (≤ ordered) under advisory lock, calls `inventory.restock()` (IN/PURCHASE movement), recomputes PO status. Same SKU may appear as multiple lot lines (`lot_no`). PO numbers via `NumberSequence`.
**Endpoints:**
- `GET/POST /api/admin/store/suppliers` — AdminGuard
- `GET/POST /api/admin/store/purchase-orders` — AdminGuard
- `PATCH /api/admin/store/purchase-orders/:id/submit` — AdminGuard (CAS DRAFT→SUBMITTED)
- `POST /api/admin/store/purchase-orders/:id/receive` — AdminGuard (idempotent per line id)
- `PATCH /api/admin/store/purchase-orders/:id/cancel` — AdminGuard
**DTOs:** `CreateSupplierDto`, `CreatePurchaseOrderDto` (lines may repeat a SKU as distinct lots), `ReceivePoLinesDto`.
**Reuses:** `inventory` primitives.

### 4.4 `customer-auth`
**Responsibilities:** Guest + registered customer accounts, addresses, optional applicant link. Issues JWTs with `role="CUSTOMER"`, `sub=Customer.id`, validated by the `jwt-customer` strategy. Refresh tokens **SHA-256-hashed + rotated** (matching the live platform `auth.service.ts`, which uses `createHash('sha256')` — NOT bcrypt; see Section 8.2). **Two integration options for refresh, decided here:** the customer-auth module owns a **separate `refreshCustomerToken()` path** (its own endpoint + logic) that validates against `Customer` — it does **not** rely on patching the platform `refreshToken()` dispatcher. (If a future cleanup wants one dispatcher, the platform method must gain an explicit `CUSTOMER` branch; until then the separate path avoids the else→Admin trap the reviewer found.) Guest carts via signed session token (hashed at rest). Razorpay-only — no stored payment methods.
**Endpoints:**
- `POST /api/store/auth/request-otp` — public
- `POST /api/store/auth/verify-otp` — public → `{accessToken(15m), refreshToken(7d, SHA-256-hashed at rest)}` role CUSTOMER
- `POST /api/store/auth/register` — public (email+password REGISTERED; password bcrypt)
- `POST /api/store/auth/login` — public
- `POST /api/store/auth/google` — public (Google ID token → CUSTOMER)
- `POST /api/store/auth/refresh` — public (**customer-specific** rotate pair, revoke old; validates `Customer`)
- `POST /api/store/auth/convert-guest` — CustomerJwtGuard (merge guest cart on first login)
- `GET /api/store/account` — CustomerJwtGuard — profile + addresses
- `GET/POST /api/store/account/addresses` — CustomerJwtGuard
- `PATCH /api/store/account/addresses/:id` — CustomerJwtGuard
- `GET /api/store/account/orders` — CustomerJwtGuard — own history
**DTOs:** `RequestOtpDto`, `VerifyOtpDto`, `RegisterCustomerDto`, `CustomerLoginDto`, `GoogleAuthDto`, `CreateAddressDto`, `ConvertGuestDto`.
**Reuses:** `auth` module's OTP/Google/JWT signing + `hashToken` (SHA-256) helper, `NotificationService` (OTP delivery), shared `RefreshToken` table (identity-agnostic `userId`).

### 4.5 `cart`
**Responsibilities:** Cart + item lifecycle. Prices **always recomputed server-side** at read/checkout (client prices ignored). Merges same-sku via `@@unique`. Validates coupon (preview only). Never reserves stock. All cart routes require `GuestCartGuard` OR `CustomerJwtGuard` (ownership), never bare `Cart.id`.
**Endpoints:**
- `POST /api/store/cart` — public — create/get (issues guest token; stores only `sessionTokenHash`, returns raw token once in body for the client to keep)
- `GET /api/store/cart/:id` — GuestCartGuard/Customer — recomputed prices + GST preview + availability flags
- `POST /api/store/cart/:id/items` — guard — add/merge
- `PATCH /api/store/cart/:id/items/:itemId` — guard — update qty
- `DELETE /api/store/cart/:id/items/:itemId` — guard — remove
- `POST /api/store/cart/:id/coupon` — guard — validate + attach (no redemption)
- `POST /api/store/cart/:id/diy-bundle` — guard — add a bundle OR all BOM components
**DTOs:** `AddCartItemDto`, `UpdateCartItemDto`, `ApplyCouponDto`, `AddDiyBundleDto`.
**Reuses:** `tax` (preview), `coupon` (validate).

### 4.6 `checkout-order`
**Responsibilities:** The transactional heart. `createOrder()` in one advisory-locked `$transaction`: re-price → **allocate fulfilling warehouse** (Section 8.4) → compute GST from that warehouse's state → CAS-redeem coupon → **`inventory.reserveMany()`** (globally ordered locks, Section 5.1) creating `StockReservation` w/ TTL → snapshot `OrderItem` (incl. per-line cgst/sgst/igst bps + amounts) → freeze `sellerGstinSnapshot` → create `Order PENDING_PAYMENT`. **Bundle members are expanded into the line set before lock ordering** so their per-member locks participate in the single globally-ordered acquisition; the bundle availability re-check happens **under the member locks**, not before (Section 8.6 + 5.2). **DIGITAL SKUs are 422-blocked** here in v1 (Section 8.10). If no single warehouse satisfies the whole order → `409 NO_FULFILLABLE_WAREHOUSE` with a clear message (Section 8.4). Then Razorpay order (reused 15-min reuse pattern). Webhook (HMAC + timingSafeEqual + amount/currency verify, event-type filtered — Section 8.1): exactly-once CAS `PENDING_PAYMENT→PAID`, reservations `ACTIVE→CONSUMED` (FULFILL stock), record `CouponRedemption`, enqueue invoice, fire notifications, emit realtime. Owns order state machine + cancel/refund-release.
**Endpoints:**
- `POST /api/store/checkout` — GuestCartGuard/Customer — create order + reserve + Razorpay order (returns guest order-access token once for guests)
- `POST /api/store/webhooks/razorpay` — public (HMAC, raw body, **event-type-routed** so pledge events landing here are acked-and-ignored, not mis-processed — Section 8.1)
- `GET /api/store/orders/:orderNumber` — CustomerJwtGuard(owns)/GuestOrderGuard
- `GET /api/admin/store/orders` — AdminGuard — dashboard (realtime)
- `PATCH /api/admin/store/orders/:id/status` — AdminGuard (guarded transition + OrderEvent)
- `PATCH /api/admin/store/orders/:id/cancel` — AdminGuard (release reservations/restock)
**DTOs:** `CheckoutDto`, `OrderStatusTransitionDto`.
**Reuses:** Razorpay wrapper, `inventory`, `coupon`, `tax`, `NotificationService`, store-realtime, store-jobs.

### 4.7 `tax`
**Responsibilities:** Pure GST engine + `TaxRate` lookup. `resolveRateBps(sku)` = SKU's `TaxClass` → `TaxRate` by HSN → SiteSettings default. `computeTax(lines, sellerStateCode, buyerStateCode)`: intra-state → CGST=SGST=half; inter-state → IGST. Integer paise, **half-up rounding per line then summed (no drift)**. **The exact same `computeTax()` runs once at checkout; its per-line outputs are persisted on `OrderItem`. Invoicing copies those verbatim — invoicing never calls `computeTax()` again** (Section 8.3). Rounding rule fully specified in Section 8.3.
**Endpoints:** `GET/POST /api/admin/store/tax-rates` — AdminGuard; `POST /api/store/tax/quote` — public.
**DTOs:** `UpsertTaxRateDto`, `TaxQuoteDto`.
**Reuses:** `SettingsService` (default rate, seller state).

### 4.8 `coupon`
**Responsibilities:** Coupon CRUD + validate + atomic redeem (inside checkout tx): advisory lock `coupon_{id}`, re-check window/min, CAS `usedCount++` guarded `< usageLimit`, **per-customer count by normalized `redeemerEmail`** (not `Customer.id`) vs `perCustomerLimit`, insert `CouponRedemption` (`@@unique([couponId,orderId])`). Guests blocked unless `coupon.allowGuest` (default false) — and even then the per-email cap applies, so guest farming is bounded (Section 8.13). Cap at `maxDiscount`.
**Endpoints:** `GET/POST/PATCH /api/admin/store/coupons` — AdminGuard; `POST /api/store/coupons/validate` — public.
**DTOs:** `CreateCouponDto`, `ValidateCouponDto`.

### 4.9 `fulfillment` (shipping)
**Responsibilities:** Shipment creation via courier abstraction (label/AWB to S3 via **PutObject**, Section 8.7), tracking sync (poll + webhook) with idempotent `ShipmentEvent` ingest, auto-advance order SHIPPED/DELIVERED.
**Endpoints:**
- `POST /api/admin/store/orders/:id/shipments` — AdminGuard (create + label; CAS order→PACKED/SHIPPED)
- `GET /api/admin/store/shipments` — AdminGuard
- `POST /api/store/webhooks/courier/:courier` — public (provider-signed) — tracking ingest
- `GET /api/store/orders/:orderNumber/tracking` — CustomerJwtGuard(owns)/GuestOrderGuard
**DTOs:** `CreateShipmentDto`, `CourierWebhookDto`.
**Reuses:** courier abstraction (Section 8.4), `DocumentService` (label via PutObject), `NotificationService`, store-realtime.

### 4.10 `returns`
**Responsibilities:** RMA lifecycle. Request (qty ≤ ordered − already-returned) → approve → receive → restock (`StockMovement RETURN→IN`, `restocked` CAS) + Razorpay refund (`razorpayRefundId` unique + `refundStatus` CAS) → order REFUNDED/PARTIALLY_REFUNDED. Credit-note via `invoicing`. **Cumulative-refund overflow guard (review finding):** inside the refund tx, under advisory lock `order_refund_{orderId}`, assert `Order.refundedTotal + thisRefund ≤ Order.grandTotal` before issuing the Razorpay refund; bump `Order.refundedTotal` by CAS in the same tx. `razorpayRefundId @unique` blocks re-issuing the *same* refund; the cumulative assert blocks issuing *different* refunds that together exceed what was collected.
**Endpoints:**
- `POST /api/store/orders/:orderNumber/returns` — CustomerJwtGuard(owns)/GuestOrderGuard
- `GET /api/store/returns/:id` — CustomerJwtGuard(owns)/GuestOrderGuard
- `GET /api/admin/store/returns` — AdminGuard
- `PATCH /api/admin/store/returns/:id/approve|reject` — AdminGuard
- `POST /api/admin/store/returns/:id/receive` — AdminGuard (restock + refund atomically, cumulative-guarded)
**DTOs:** `CreateReturnDto`, `ReturnStatusTransitionDto`, `ReceiveReturnDto`.
**Reuses:** Razorpay wrapper, `inventory`, `invoicing`, `NotificationService`.

### 4.11 `invoicing`
**Responsibilities:** GST tax invoice / credit note for PAID orders. `allocateInvoiceNumber()`: advisory lock `invoice_seq_{FY}` **plus** `SELECT ... FOR UPDATE` on the `InvoiceSequence` row (replica-safe; advisory locks are session-scoped and 10 replicas can land in different Postgres sessions — the row lock is the real serialization, Section 5.1) + CAS `lastValue++` → gapless number; `@@unique([financialYear,sequenceNo])` + `invoiceNumber @unique` as backstops. New-FY row created via `INSERT ... ON CONFLICT DO NOTHING` then `FOR UPDATE` inside the same tx (FY-rollover-safe). **Invoice lines are copied verbatim from `OrderItem` snapshots — never re-computed (Section 8.3).** Render PDF to S3 via **PutObject** (`DocumentService` gains a `putObject(key, buffer, contentType)` method; the bucket IAM policy must include `s3:PutObject`, Section 8.7). Driven by `store-invoice-generation` queue; idempotent (skip if ISSUED).
**Endpoints:**
- `POST /api/admin/store/orders/:id/invoice` — AdminGuard (issue; consumes sequence)
- `GET /api/store/orders/:orderNumber/invoice` — CustomerJwtGuard(owns)/GuestOrderGuard — presigned PDF URL
- `POST /api/admin/store/returns/:id/credit-note` — AdminGuard
- `GET /api/admin/store/invoices` — AdminGuard — list/search
**DTOs:** `IssueInvoiceDto`.
**Reuses:** `DocumentService` (PutObject + presign for download), `tax` (only for live admin quote, not invoice derivation), `SettingsService` (seller name fallback), `Warehouse.gstin` (seller GSTIN).

### 4.12 `diy`
**Responsibilities:** DIY guide/steps/BOM/bundle CRUD (admin) + public `/build`. Bundle creation also mints the BUNDLE-type Sku. "Buy full set" resolves bundle Sku → cart; "buy individual" adds each BOM sku.
**Endpoints:**
- `GET /api/store/products/:slug/build` — public — guide (steps + BOM w/ live prices/availability + bundle)
- `POST /api/admin/store/products/:id/diy` — AdminGuard (upsert guide+steps+bom)
- `POST /api/admin/store/bundles` — AdminGuard (create bundle + items + BUNDLE sku)
- `POST /api/store/diy/:guideId/add-to-cart` — GuestCartGuard/Customer (`{mode:'BUNDLE'|'COMPONENTS', cartId}`)
**DTOs:** `UpsertDiyDto`, `CreateBundleDto`, `AddDiyBundleDto`.
**Reuses:** `catalog`, `cart`.

### 4.13 `store-analytics`
**Responsibilities:** Admin KPIs. Reuses `Visitor`/`DailyPageStat` for traffic; aggregates `Order`/`OrderItem` for revenue (paise), GMV, AOV, units, top SKUs, conversion, low-stock, returns rate, coupon perf. Heavy rollups precomputed nightly into the **`StoreDailyStat`** table (now defined in schema, Section 2.9) using **raw SQL aggregation (`Prisma.$queryRaw`)** — never a Node-side loop over order rows (Section 8.8). Live counters read narrow indexed queries.
**Endpoints:** `GET /api/admin/store/analytics/{summary,revenue,top-products,inventory-health}` — AdminGuard.
**DTOs:** `AnalyticsRangeDto`.
**Reuses:** `VisitorService`, store-jobs (rollup).

### 4.14 `articles`
**Responsibilities:** User-submitted articles → admin moderation → published. Media cap 15 img/3 video, **row-reserved at presign** (same PENDING-row pattern as product media). Pagination + related-articles (shared tags via GIN-indexed `&&`). View metrics via `VisitorService` + **batched-queue `viewCount` increment** (Section 8.12); authors see only own view count, admins see all. Submission accepted from **either** a CUSTOMER or an APPLICANT JWT via `ArticleAuthorGuard`, which pins `authorType`/`authorId` from the verified token (Section 8.11). Race-safe slug (Section 8.14).
**Endpoints:**
- `GET /api/articles` — public — paginated PUBLISHED
- `GET /api/articles/:slug` — public — detail + related; records pageview
- `POST /api/articles` — `ArticleAuthorGuard` (CUSTOMER or APPLICANT) — submit (SUBMITTED), author pinned from JWT
- `POST /api/articles/:id/media/presign` — owner (`ArticleAuthorGuard` + ownership) — DocumentService presign (row-reserved cap)
- `POST /api/articles/:id/media/confirm` — owner — flip PENDING→CONFIRMED
- `GET /api/articles/mine` — `ArticleAuthorGuard` — own articles + **own `viewCount` only**
- `GET /api/admin/store/articles` — AdminGuard — moderation queue + **full** Visitor/DailyPageStat metrics
- `PATCH /api/admin/store/articles/:id/approve|reject` — AdminGuard
**DTOs:** `SubmitArticleDto`, `ModerateArticleDto`, `PresignArticleMediaDto`, `ArticleQueryDto`.
**Reuses:** `DocumentService`, `VisitorService`, `store-jobs` (view-count increment).

### 4.15 `store-realtime` (gateway, cross-cutting)
Two Socket.io namespaces (Section 6). Injected into `inventory`, `checkout-order`, `fulfillment`, `returns` to emit on commit. Mirrors `chat.gateway.ts` (JWT handshake via `handshake.auth.token`) but **the CORS origin list is read from `ConfigService`** (the production domain + localhost variants), not hardcoded like `chat.gateway.ts` — otherwise store realtime breaks on the production frontend domain (Section 6 + suggestion). **Guest realtime:** guests authenticate the handshake with their signed guest order-access token (the same token behind `GuestOrderGuard`); the gateway validates it and permits joining only `order:{theirOrderId}` (Section 6).

### 4.16 `store-jobs` (cross-cutting)
Registers commerce BullMQ queues + `@Processor` WorkerHosts + crons (Section 7). Mirrors `jobs/batch.processor.ts`. All idempotent + Redis-resilient (enqueue failures logged, not thrown — `visitor.service.ts` pattern). Hosts the batched `store-viewcount-increment` queue (Section 8.12) and the `store-media-gc` PENDING-media sweep.

---

## 5. Concurrency & Data-Integrity Plan

The canonical idiom (from `payment.service.ts` / `equity.service.ts`): inside `prisma.$transaction`, first `SELECT pg_advisory_xact_lock(hashtext($key))`, then `updateMany` with a `where` CAS guard, then (for money/stock/equity) a defense-in-depth invariant assertion before commit. The lock auto-releases at tx end.

### 5.1 Global lock-ordering rule (deadlock elimination — review CRITICAL)

> **Any operation that locks more than one `(sku, warehouse)` pair — multi-line checkout, bundle drawdown (member SKUs), stock transfer, multi-line PO receive — MUST acquire all advisory locks in a single deterministic order: ascending `skuId`, then ascending `warehouseId`, computed over the FULLY EXPANDED line set (bundle members expanded first) BEFORE any lock is taken.** This is enforced in code by `inventory.reserveMany(lines[])` / `inventory.lockKeys(lines[])`, which sort and dedupe the key set and acquire every lock up front in one pass. Implementers MUST NOT iterate `cartItems` in DB/insertion order and lock as they go — that is exactly the A-then-B / B-then-A deadlock the existing single-lock services never faced. The same rule covers `transfer()` (sort the two endpoints) and PO receive (sort the affected `(sku,wh)` set). Invoice/coupon/order-number locks are single-key and unaffected.

### 5.2 Operation table

| Operation | Lock key(s) | CAS / guard | Invariant assert / failure mode |
|---|---|---|---|
| **Stock reservation (checkout, multi-line)** | all `stock_${skuId}_${warehouseId}` keys for the **fully expanded** line set, acquired in ascending `(skuId, warehouseId)` order via `reserveMany` (5.1) | per line: `updateMany WHERE id=row.id AND version=row.version SET reserved=reserved+qty, version=version+1` → `count===1` else retry/abort; before bump assert `onHand-reserved >= qty` | `reserved <= onHand`; create `StockReservation(ACTIVE, expiresAt)` + `StockMovement(RESERVE)`. **Failure** = `409 INSUFFICIENT_STOCK` naming the offending SKU; whole tx rolls back (no partial reservation) |
| **Bundle drawdown (checkout)** | per-member `stock_${memberSkuId}_${wh}`, **part of the same globally-ordered set above** (members expanded before sorting) | reserve each `BundleItem.sku` by `qty*bundleQty`, each CAS; the bundle availability `min(floor(memberAvailable/memberQty))` is **re-checked under the member locks**, never from an earlier unlocked read | all-or-nothing in the one tx. **Failure** = `409 BUNDLE_COMPONENT_UNAVAILABLE` naming the limiting component; rollback before any Razorpay order is created so no payment is attempted on a doomed checkout (review CRITICAL) |
| **Stock capture (payment webhook)** | same per-(sku,wh) locks inside capture tx, ordered by 5.1 | `updateMany SET onHand=onHand-qty, reserved=reserved-qty, version+1 WHERE id=? AND reserved>=qty AND onHand>=qty` → `count===1`; flip `StockReservation ACTIVE→CONSUMED` | `onHand>=0 AND reserved>=0`; `StockMovement(OUT, SALE, ref ORDER)` |
| **Order payment idempotency** | implicit via `razorpayOrderId @unique` | `updateMany WHERE id=order.id AND status='PENDING_PAYMENT' SET status='PAID'` → `count===1` proceeds, `0` = duplicate no-op 200 | amount/currency == `grandTotal` verified before promote; **event type filtered** so a pledge `payment.captured` arriving here is acked-and-ignored (8.1) |
| **Coupon redemption** | `coupon_${couponId}` inside checkout tx | `updateMany WHERE id=? AND (usageLimit IS NULL OR usedCount<usageLimit) SET usedCount=usedCount+1` → `count===1`; per-customer count by **normalized `redeemerEmail`** vs `perCustomerLimit`; insert `CouponRedemption`; guests blocked unless `allowGuest` | discount ≤ `maxDiscount`; `@@unique[couponId,orderId]` blocks double-redeem; email-based cap blocks guest farming (8.13) |
| **Invoice numbering (gapless/FY)** | `invoice_seq_${financialYear}` **AND `SELECT ... FOR UPDATE` on the `InvoiceSequence` row** | `INSERT InvoiceSequence ON CONFLICT DO NOTHING` (FY-rollover) → `SELECT ... FOR UPDATE` → `lastValue++` → format; `@@unique([financialYear,sequenceNo])` + `invoiceNumber @unique` backstop | row-lock (not the session-scoped advisory lock) is the real serializer across 10 replicas in distinct Postgres sessions (review CRITICAL); minted **inside** the tx so a failed insert rolls back the bump |
| **PO receiving** | `po_receive_${purchaseOrderId}` + per-(sku,wh) restock locks (5.1) | per **line id** `updateMany SET received_qty=received_qty+recv WHERE id=? AND received_qty+recv<=ordered_qty` → prevents over-receipt; restock under ordered locks | recompute PO status; `StockMovement(IN, PURCHASE)` |
| **Order / PO / RMA numbers** | `numseq_${scope}` | `NumberSequence` bump under lock; `@unique` backstop | never `count(*)`-derived |
| **Refund idempotency + cumulative cap** | `return_${returnId}` + `order_refund_${orderId}` | `razorpayRefundId @unique` + `updateMany WHERE refundStatus!='COMPLETED'` → no-op on retry; **assert `Order.refundedTotal + thisRefund ≤ Order.grandTotal`** then CAS-bump `refundedTotal`; restock guarded by `ReturnItem.restocked` CAS | refund ≤ remaining refundable (blocks two *different* refunds overflowing the collected amount — review CRITICAL); `StockMovement(RETURN→IN)` exactly once |
| **Reservation expiry (cron + delayed job)** | `stock_${skuId}_${warehouseId}` per row | **the reservation `ACTIVE→EXPIRED` flip AND the `reserved -= qty` decrement are ONE `updateMany`/CAS pair inside ONE transaction** — the decrement is gated by the same status transition, so a double-fire (cron + delayed job) cannot double-decrement (review IMPORTANT). If order still PENDING_PAYMENT and all reservations gone → cancel order | `StockMovement(RELEASE)`; idempotent (status CAS makes the 2nd run a no-op) |
| **Tracking ingest** | n/a (unique constraint) | `ShipmentEvent @@unique([shipmentId,courierEventId])` dedupes; status advance via guarded `updateMany` | — |
| **Product/Article media cap** | n/a (row reservation) | insert `*Media(status=PENDING)` at presign; cap = count of rows where `status IN (PENDING,CONFIRMED)`; confirm flips to CONFIRMED | parallel presign can't oversubscribe because each presign **inserts a row** before counting; orphan PENDING rows swept by `store-media-gc` (review CRITICAL) |
| **Slug create (product/article)** | n/a (unique constraint + retry) | generate base slug; on Prisma `P2002` append `-2`,`-3`… and retry (bounded); surface friendly `409` if exhausted | race-safe via the unique constraint, never a 500 (review IMPORTANT, 8.14) |

**Money/units integrity:** every monetary column `Int` paise; GST rates integer bps; rupee↔paise only at API boundary. Tax rounding half-up per line then summed (Section 8.3).

---

## 6. Real-Time Design

Two Socket.io namespaces, both with JWT handshake auth modeled on `chat.gateway.ts` (`client.handshake.auth.token` → `jwtService.verify` with `JWT_SECRET`). **CORS origin list is sourced from `ConfigService`** (production domain + localhost variants), not hardcoded — `chat.gateway.ts` hardcodes its list and the store gateways must not repeat that or they will fail from the production frontend origin. Services emit **after** the DB transaction commits (never inside the tx).

**Authentication of the three caller classes:**
- **Admins** — store JWT (or platform admin JWT) with `role ∈ {ADMIN, SUPER_ADMIN, MODERATOR}`.
- **Registered customers** — `jwt-customer` token; `sub` = `Customer.id`.
- **Guests** — the signed **guest order-access token** (same secret/format behind `GuestOrderGuard`) passed in `handshake.auth.token`. The gateway verifies it and derives the single `orderId` it grants, so a guest can join only their own order room. This is how guests receive live tracking without an account (review IMPORTANT: guest realtime was unspecified).

### `/store/stock` (admin only)
Handshake rejects unless `role ∈ {ADMIN, SUPER_ADMIN, MODERATOR}`. All admins auto-join room `store-admin`.
- `stock.updated` `{skuId, warehouseId, onHand, reserved, available, version}` — after every committed StockLevel CAS
- `stock.low` `{skuId, skuCode, available, reorderPoint, warehouseId}` — when available crosses below reorderPoint
- `stock.reorderDrafted` `{poId, poNumber, supplierId, lines}` — when reorder job auto-drafts a PO

### `/store/orders`
Admins join `store-admin-orders`. Customers/guests may `joinRoom {room: "order:{orderId}"}` **only after a server-side ownership check** (a `jwt-customer` socket's `sub` must equal the order's `customerId`; a guest socket's verified order-access-token `orderId` must equal the requested room's order). Admin rooms require admin role.
- `order.created` `{orderId, orderNumber, grandTotalPaise}` → admins
- `order.statusChanged` `{orderId, orderNumber, fromStatus, toStatus, at}` → admins + `order:{id}`
- `order.paid` `{orderId, totalPaise, invoicePending:true}` → admins + customer/guest
- `shipment.updated` `{orderId, shipmentId, status, location, occurredAt}` → admins + `order:{id}`
- `order.refunded` `{orderId, refundPaise, rmaNumber}` → admins + customer/guest

`client→server joinRoom {room}` — server validates membership (admin role for admin rooms; ownership for `order:{id}`) before `client.join`.

---

## 7. Background Jobs

BullMQ queues (Redis) + `@nestjs/schedule` crons, all in `store-jobs`. WorkerHost pattern with `removeOnComplete: true, removeOnFail: 100`. Every job idempotent (CAS-guarded) and Redis-resilient. Crons run in IST where noted.

| Job / cron | Trigger | Work | Idempotency |
|---|---|---|---|
| `store-reservation-expiry` (BullMQ delayed-per-reservation at `expiresAt` + cron every 1–5 min as backstop) | schedule | Find `StockReservation ACTIVE AND expiresAt<now`; per-(sku,wh) lock; **single tx flips ACTIVE→EXPIRED AND decrements `reserved` as one CAS pair** (RELEASE movement); if order still PENDING_PAYMENT and all gone → cancel order | status CAS → re-run no-op; the coupled flip+decrement prevents the cron/delayed-job double-decrement (5.2); prevents permanent inventory leak |
| `store-media-gc` (cron every 30 min) | schedule | Delete `ProductMedia`/`ArticleMedia` rows with `status=PENDING` older than the presign-URL TTL (+ best-effort S3 delete); frees the reserved cap slot | idempotent (row delete) |
| `store-viewcount-increment` (BullMQ, batched) | product/article pageview | Coalesce per-entity increments over a short window and apply one `UPDATE … SET view_count = view_count + N` per entity (avoids hot-row contention from inline per-view UPDATEs — suggestion) | additive; safe to re-run with the windowed delta |
| `store-reorder-alerts` (cron every 30 min) | schedule | SKUs where available≤reorderPoint and reorderQty>0 with no open DRAFT/SUBMITTED PO → draft `PurchaseOrder(autoGenerated)` via NumberSequence; emit `stock.reorderDrafted` + notify admins | skip SKUs already on an open PO |
| `store-courier-sync` (cron every 15 min) | schedule + inbound webhook path | For shipments not in {DELIVERED,FAILED,RETURNED} with stale `lastSyncedAt`, poll courier; upsert `ShipmentEvent`; advance status + order via CAS; emit `shipment.updated`; backoff on courier errors | `ShipmentEvent @@unique([shipmentId,courierEventId])` |
| `store-invoice-generation` (BullMQ) | on order PAID (enqueued from webhook) | `allocateInvoiceNumber` (advisory lock + **`FOR UPDATE` row lock**, gapless CAS, FY-rollover-safe); **copy `OrderItem` snapshots verbatim into `InvoiceLine`**; render GST PDF; store via DocumentService **PutObject**; set Invoice ISSUED | skip if Invoice already ISSUED for order; retries+backoff; final failure → Invoice FAILED + alert |
| `store-refund-processing` (BullMQ) | on return RECEIVED/approved | cumulative-cap assert (`refundedTotal+x≤grandTotal`) → Razorpay refund; restock | `razorpayRefundId @unique` + `refundStatus` CAS + `ReturnItem.restocked` CAS + cumulative cap |
| `store-order-confirmation-notify` (BullMQ) | on payment.captured | best-effort email/WhatsApp via NotificationService (templates per 8.7) | non-blocking (matches `payment.service`) |
| `store-low-stock-notify` (BullMQ + daily 07:00 IST digest) | inventory decrement crossing reorderPoint | NotificationService to admins; deduped per SKU within a window (Redis key TTL) | Redis dedupe key |
| `store-coupon-expiry` (cron daily) | schedule | Flip `Coupon ACTIVE→EXPIRED` past `expiresAt` | status guard |
| `store-analytics-rollup` (cron nightly 01:30 IST) | schedule | **Raw-SQL** aggregate prior-day Orders/OrderItems into `StoreDailyStat`; roll Visitor/DailyPageStat into store traffic | idempotent upsert per date (`@@unique([statDate])`) |
| reused `visitor-queue` (existing) | product/article pageviews via `VisitorService.trackPageView` | — | no new queue |

**Audit-table retention (scale):** `StockMovement`, `OrderEvent`, `ShipmentEvent` grow unbounded. Plan: monthly Postgres range partitioning by `createdAt` (declarative partitions added by a future migration) + a `store-audit-retention` cron archiving partitions older than the legal/ops window to cold storage. Not P0 — flagged for the partition migration once volume warrants (open decision 8).

---

## 8. Integrations

### 8.1 Razorpay for orders (single account, isolated routing)
Extract a thin `RazorpayService` (or shared provider) so both `PaymentService` (pledges) and `checkout-order` reuse one client + one webhook-verify helper without duplication. Reuse **verbatim**: advisory-lock + 15-min reuse window on order create (`store_order_${orderId}` key); webhook HMAC-SHA256 over **raw body** + `crypto.timingSafeEqual`, fail-closed if `RAZORPAY_WEBHOOK_SECRET` absent; verify captured `amount`/`currency` == `Order.grandTotal`; exactly-once CAS capture. The store webhook is a **separate endpoint** (`POST /api/store/webhooks/razorpay`).

> **Shared-account routing requirement (review CRITICAL).** Razorpay sends events for the whole account; if pledges and store share one Razorpay account, BOTH endpoints can receive BOTH event streams. Therefore **each webhook handler MUST filter by ownership before acting**: the store handler looks up `Order.razorpayOrderId`/`razorpayPaymentId`; if no store entity matches, it **acks (200) and ignores** — it must never fall through to any other entity. The same is required of the pledge handler. This is mandatory regardless of whether the Razorpay dashboard is configured with one or two webhook URLs. **Recommended additionally:** configure two webhook URLs in the Razorpay dashboard with event-type subscriptions scoped per surface, or tag store orders with `notes.surface = "store"` and assert it in the handler. Refund events (`refund.processed`) MUST be matched to a store `Return.razorpayRefundId`/order before processing; an unmatched refund is acked-and-ignored. (Add this to the deployment runbook.)
>
> **Raw body:** register the store webhook route with the raw-body parser exactly as the existing payment webhook is.

### 8.2 Customer auth (guest + registered, Razorpay-only) — hashing reality
Standalone customer JWT (role `CUSTOMER`, `sub=Customer.id`) — **not** added to `AdminRole`, and validated by a **dedicated `jwt-customer` Passport strategy** so it never reaches the platform `validateUser()`/`refreshToken()` admin else-branch (review CRITICAL). 

> **Refresh-token hashing is SHA-256, not bcrypt (review IMPORTANT — corrects CLAUDE.md/source-spec wording).** The live `auth.service.ts` hashes refresh tokens with `createHash('sha256')` (a fast, single-pass hash) and rotates them. This is acceptable because a JWT refresh token already carries ≥40 bytes of cryptographic entropy in its signature, making rainbow-table/brute-force infeasible. Customer refresh tokens **MUST use the identical SHA-256 `hashToken` helper** — do NOT introduce bcrypt for customer tokens, which would create two inconsistent schemes in one table. (Passwords remain bcrypt; tokens are SHA-256 — these are different things.) Tokens are stored in the existing identity-agnostic `RefreshToken` table keyed by `userId=Customer.id`.

The customer-auth module exposes its **own** `POST /api/store/auth/refresh` backed by a customer-specific validation path (look up `Customer`, assert active) — it does not depend on the platform dispatcher gaining a CUSTOMER branch. Guests are session-bound via a signed token whose **SHA-256 hash** is stored in `Cart.sessionTokenHash` (raw token only ever lives client-side); `convert-guest` merges the guest cart into a new registered customer on first login. No COD; no stored card/UPI — Razorpay handles the instrument.

### 8.3 GST tax engine + invoice PDF (rounding fully specified; invoice derives from snapshots)
Pure engine in `tax` (Section 4.7). Place-of-supply = buyer shipping `stateCode`; origin = fulfilling **warehouse** `stateCode` (chosen at allocation — 8.4). Intra-state → CGST+SGST; inter-state → IGST.

**Rounding rule (exact, review CRITICAL):**
1. Compute taxable value per line in integer paise: `taxableValue = unitPrice*qty - lineDiscount`.
2. For each tax component, `amount = round_half_up(taxableValue * componentBps / 10000)` where `round_half_up(x) = Math.floor(x + 0.5)` applied to the exact integer arithmetic (compute `taxableValue*bps`, then `(num + 5000) / 10000` integer-divided) — **per line, then summed** to the order/invoice totals. No re-rounding of the sum.
3. Intra-state: `cgstBps = sgstBps = totalGstBps/2`; each rounded independently per (2). Inter-state: `igstBps = totalGstBps`, cgst=sgst=0.

**Single computation point (review CRITICAL):** `TaxService.computeTax()` runs **once, at checkout**, and its per-line `cgst/sgst/igstBps` + `cgst/sgst/igstAmount` are persisted on `OrderItem`. **Invoice generation copies `OrderItem` fields verbatim into `InvoiceLine` and sums them into `Invoice` totals — it never calls `computeTax()` again.** A SKU price/tax change between payment and invoicing therefore cannot make the invoice diverge from the Razorpay-verified `grandTotal`. The credit-note for a return likewise derives from the returned `OrderItem`/`ReturnItem` line amounts, not a fresh computation.

Invoice PDF rendered server-side (HTML→PDF) to S3 via `DocumentService` **PutObject** (8.7), presigned for customer download. **Seller GSTIN/name come from the fulfilling `Warehouse` (`gstin`) frozen onto `Order.sellerGstinSnapshot` at order time** (8.4 + open decision 2).

### 8.4 Courier abstraction + multi-warehouse allocation
`CourierProvider` interface (`createLabel(shipment) → {awb,labelBuffer,trackingUrl}`, `getTracking(awb) → events[]`, `verifyWebhook(req) → events[]`) with per-courier adapters (Delhivery/Bluedart/Shiprocket/DTDC, default `OTHER` stub). Provider + token configured via `SiteSettings`.

**Warehouse allocation rule (default, configurable):** at checkout, pick the single warehouse that can satisfy the **whole order** with available stock, ordered by `Warehouse.priority` then most-available; tax + seller GSTIN come from that warehouse. Allocation happens **before** tax finalization so CGST/SGST vs IGST and seller GSTIN are correct, and **before** lock acquisition so the `(sku,warehouse)` set is fixed for ordering (5.1).

> **Known limitation (review IMPORTANT — single-warehouse v1).** Split fulfillment is out of scope for v1 (future allocation sub-model, open decision 1). If **no single warehouse** can satisfy every line, checkout returns **`409 NO_FULFILLABLE_WAREHOUSE`** with a user-facing message ("Some items can't ship together right now — please order them separately or reduce quantities"). The storefront cart/checkout UI surfaces this explicitly (per-line availability badges + a blocking banner) — never a silent 400/500. This limitation is documented for customers in the store help copy.

### 8.5 Returns / RMA
Customer requests on delivered lines (qty ≤ ordered − already-returned). Admin approve → receive → restock (`RETURN→IN`, `restocked` CAS) + Razorpay refund (idempotent + **cumulative-cap guarded**, 5.2). Refund amount includes **proportional GST** of returned lines (derived from `OrderItem`/`ReturnItem` snapshots, never recomputed); a `CREDIT_NOTE` Invoice is issued for compliance. Order → REFUNDED / PARTIALLY_REFUNDED. Returns window/policy is open decision 5.

### 8.6 Bundle stock semantics (atomic, no unlocked read gap)
A BUNDLE Sku has **no own StockLevel**. Availability is **computed**: `min(floor(memberAvailable / memberQty))` across `BundleItem`s. Read/listing paths compute it for display. **Purchase expands the bundle into its member lines, folds them into the single globally-ordered lock set (5.1), re-checks `floor(memberAvailable/memberQty)` for every member UNDER its lock, and reserves/decrements each member (qty×bundleQty) in the one checkout tx.** The earlier display-time availability read is advisory only and is **never** trusted at reservation time — closing the read-then-lock gap the reviewer flagged. If any member can't satisfy, the tx aborts with `409 BUNDLE_COMPONENT_UNAVAILABLE` (naming the limiting component) **before any Razorpay order is created**, so the customer is never charged for a doomed bundle. (Pre-kitted physical bundle stock remains open decision 3.)

### 8.7 Notifications, S3 (PutObject path), view metrics
- `NotificationService` (SES + WhatsApp, best-effort non-blocking) for order/shipment/refund/low-stock. **WhatsApp templates required before go-live:** `order-confirmation`, `shipment-shipped`, `delivery-confirmed`, `refund-processed`, `low-stock-alert-admin` — these slugs must be registered in the WhatsApp dashboard or the (best-effort) send silently no-ops, which is a poor experience on order confirmation (suggestion). Added to the go-live checklist.
- `DocumentService` for all product/DIY/article media + invoice/label PDFs (25MB cap, MIME allowlist extended for media, HeadObject size enforcement). **Server-generated PDFs (invoices, labels) use a NEW `DocumentService.putObject(key, buffer, contentType)` path (direct `PutObject`), not the client presign+confirm flow** (`PutObjectCommand` is already imported in `document.service.ts`). **IAM:** the `arya-documents` bucket policy must grant `s3:PutObject` (not only `s3:GetObject` + presign) — note in the deployment/IAM runbook (suggestion).
- `VisitorService`/`DailyPageStat` for product + article page views; the denormalized `viewCount` counters are updated via the **batched `store-viewcount-increment` queue**, never inline per request (8.12).

### 8.8 Analytics rollup performance
`store-analytics-rollup` aggregates with **`Prisma.$queryRaw` SQL** (`SUM`/`COUNT`/`GROUP BY` over `orders`/`order_items` filtered by the IST day window), writing one upserted `StoreDailyStat` row per day. It does **not** load order rows into Node and loop — at 10k orders/day × ~5 items a Node loop over 50k rows is unacceptable (suggestion). Live KPI endpoints read `StoreDailyStat` for historical ranges and narrow indexed queries for "today".

### 8.9 Category denormalization re-sync
`Product.category` is a denormalized filter cache set at product create/update. Because `Category.parentId` is `onDelete: SetNull` (deleting a parent orphans children to root, never cascade-deletes — intentional), **the catalog service MUST, on any category delete or re-parent, re-sync `Product.category` for all products under the affected subtree** (a single `UPDATE products SET category=$resolvedName WHERE category_id IN (subtree)`), so listing filters never go stale (review IMPORTANT). Admin UI surfaces a confirmation noting children will float to root on delete.

### 8.10 DIGITAL product type — v1 behavior
`ProductType.DIGITAL` is retained in the schema for forward-compatibility but has **no defined fulfillment in v1**. `checkout-order.createOrder()` **hard-blocks any DIGITAL SKU with `422 DIGITAL_NOT_AVAILABLE`** before reservation — DIGITAL SKUs are also excluded from `ACTIVE` public listing by default (admin can create them but they cannot be purchased). This removes the data-integrity hole of a DIGITAL SKU reaching inventory and reserving 0/undefined stock (review IMPORTANT). Delivery mechanism for digital goods is open decision 7.

### 8.11 Article dual-issuer authorship
`POST /api/articles` accepts **either** a platform `APPLICANT` JWT or a store `CUSTOMER` JWT via `ArticleAuthorGuard` (Section 4.0). The guard pins `Article.authorType` and `authorId` **from the verified token** (`CUSTOMER`→`Customer.id`+`authorType=CUSTOMER`; `APPLICANT`→`Applicant.id`+`authorType=APPLICANT`). The client may not supply `authorType`/`authorId`, so a customer cannot forge an applicant authorship with a discovered UUID, and vice-versa (review IMPORTANT). `GET /api/articles/mine` resolves the author identity the same way and returns only that author's rows + their own `viewCount`.

### 8.12 View-count counters (no hot-row contention)
Both `Product.viewCount` and `Article.viewCount` are denormalized counters for cheap list sorting. Pageviews still flow through `VisitorService.trackPageView` (existing `visitor-queue`). The counter itself is incremented by the **batched `store-viewcount-increment` queue**, which coalesces increments per entity over a short window into a single `UPDATE … SET view_count = view_count + N`, avoiding per-request hot-row UPDATE contention on popular catalog/article pages (suggestion).

### 8.13 Coupon anti-farming (guest dedup)
Per-customer coupon limits are enforced on the **normalized `redeemerEmail`** (and optionally `redeemerPhone`) captured at checkout — stored on `CouponRedemption` and indexed `(couponId, redeemerEmail)` — **not** on `Customer.id`. A single human cannot bypass `perCustomerLimit=1` by spawning fresh guest `Customer` rows, because all their redemptions share the same email. Additionally, coupons default to `allowGuest=false`, so high-value PERCENT coupons can be restricted to REGISTERED (verified-email) customers entirely. This closes the guest-account double-redemption revenue leak (review CRITICAL). (Stackability/precedence is open decision 4.)

### 8.14 Race-safe slug generation
Product and Article slugs derive from the name. Two concurrent creates of the same name both derive the same slug; the `@unique` constraint guarantees only one wins. The service generates a base slug, attempts insert, and on Prisma `P2002` retries with `-2`, `-3`, … (bounded, e.g. 10 attempts) — surfacing a friendly **`409 SLUG_CONFLICT`** if exhausted, never a 500. (review IMPORTANT.)

---

## 9. Media Handling

Single flow for all client uploads, reusing `DocumentService`'s presign → client PUT → confirm (HeadObject authoritative size) pattern. **Server-generated PDFs (invoice/label) use the direct `putObject` path instead (8.7).**

**Caps enforced by ROW RESERVATION at the service layer (min 0) — closes the parallel-presign race (review CRITICAL):**
- **Product:** max **10 IMAGE + 1 VIDEO**. At presign, `catalog` **inserts a `ProductMedia(status=PENDING)` row inside a transaction and counts existing rows of the requested `type` where `status IN (PENDING, CONFIRMED)`**; if the count would exceed the cap it aborts (rolls back the insert) and returns `409 MEDIA_CAP_REACHED`. Only after a successful reservation is the presigned URL issued. This mirrors `DocumentService`, which already creates a `status:PENDING` Document row at presign time — so eleven concurrent presigns can no longer all read count=0.
- **Article:** max **15 IMAGE + 3 VIDEO**, identical PENDING-row reservation in `articles`.

Confirm endpoints run `HeadObject`, enforce a per-type max byte size (image vs video), and on success flip `PENDING→CONFIRMED`; on size violation they delete the PENDING row + purge the S3 object. Public read paths show only `CONFIRMED` media. Orphan PENDING rows (client abandoned the PUT) are swept by the `store-media-gc` cron after the presign-URL TTL, freeing the reserved cap slot. MIME allowlist extended for media (images: png/jpeg/webp/heic; video: mp4/webm/quicktime). All media keyed under `store/products/{productId}/...`, `store/diy/{guideId}/...`, `articles/{articleId}/...`, `invoices/{invoiceId}.pdf`, `labels/{shipmentId}.pdf`.

---

## 10. Articles Vertical

**Models:** `Article`, `ArticleMedia` (Section 2.7). `authorType` (`CUSTOMER`|`APPLICANT` enum) + `authorId` lets either a store customer or a platform applicant author; both are pinned from the verified JWT by `ArticleAuthorGuard` (8.11).

**Workflow:** submit → `SUBMITTED` → admin `APPROVE` (sets `status=PUBLISHED`, `publishedAt`) or `REJECT` (sets `REJECTED` + `rejectionReason`). Only `PUBLISHED` is publicly listable. (`APPROVED` is retained in the enum as an intermediate for a future "approved but scheduled" state; v1 approve goes straight to PUBLISHED.)

**View metrics:** reuse `VisitorService.trackPageView` on `GET /api/articles/:slug` (enqueued to `visitor-queue`) + **batched `viewCount` increment** (8.12). **Visibility split:** authors querying `GET /api/articles/mine` see **only `viewCount`** on their own articles (no visitor/geo breakdown); admins (`GET /api/admin/store/articles`) see full `Visitor`/`DailyPageStat` metrics for any article.

**Related articles:** auto-computed by shared `tags` overlap (Postgres array overlap `&&`), excluding self, limited to N, ordered by tag-overlap count then recency. **Backed by the `articles_tags_gin` GIN index** added in the articles migration (Section 3 step 8) — without it the overlap query sequential-scans at scale (review IMPORTANT).

**Pagination:** standard `{page, limit}` → `{data, meta:{page,limit,total,totalPages}}` (matches existing list endpoints). Default sort: `publishedAt desc`. Filters: tag, search (title/excerpt ILIKE).

---

## 11. Frontend Plan

Next.js 16 App Router + React 19 + Tailwind v4 (`@theme` in `globals.css`, no config) + motion v12 + lucide-react. **All backend calls go through `src/lib/api.ts`** (extend the single `ApiClient`). Dynamic routes use `use(params)` (params is a Promise in Next 16). Existing stubs to flesh out: `src/app/store/page.tsx`, `src/app/articles/page.tsx`, `src/app/articles/submit/page.tsx`, `src/app/startup/page.tsx` (current landing already moved here).

### 11.1 Premium public-marketing design layer (scoped)
A **scoped utility layer** applied only to `/`, `/store/*`, `/articles/*` — does **not** touch admin/hub (strict DESIGN.md). Implement as a CSS layer + wrapper class (e.g. `.market` root class on those route group layouts) defining:
- Rounded corners (e.g. `--market-radius: 16px`), soft shadows, gradient/glass hero surfaces — explicitly overriding the 0px/no-shadow global rules **within `.market` only**.
- Saffron/marigold accents over the forest/parchment base (tokens: saffron `#E85D04`, marigold `#F4A300`, forest `#133022`, parchment `#FEF9F0`, alabaster `#FDFBF7`, hairline `#C2C8C2`, ink `#1D1C16`).
- Fonts: Fraunces (serif-display) for marketing headlines, Newsreader (serif) body accents, Public Sans (sans) for UI.
Use a Next.js **route group** `(market)` wrapping `/`, `store`, `articles` so the layer's layout/providers are isolated from `(app)` admin/hub.

### 11.2 Public routes
- `/` — new premium landing (marketing)
- `/startup` — current landing moved here
- `/store` — storefront: featured products, categories, search
- `/store/[slug]` — product detail: media gallery (10img/1video, CONFIRMED only), dynamic tabs+sections, sku/variant selector, quantity-tier price, add-to-cart
- `/store/[slug]/build` — DIY guide: ordered steps (code+media), BOM with per-item add-to-cart, "Buy the full set" bundle CTA
- `/store/cart` — review, coupon apply, totals (paise→rupees at boundary), **per-line availability badges + a blocking banner when no single warehouse can fulfill** (8.4)
- `/store/checkout` — billing/shipping address, GST place-of-supply, Razorpay checkout; surfaces `INSUFFICIENT_STOCK`/`BUNDLE_COMPONENT_UNAVAILABLE`/`NO_FULFILLABLE_WAREHOUSE`/`DIGITAL_NOT_AVAILABLE` as explicit, actionable messages (never silent failure)
- `/store/account` — orders, addresses, returns, invoice downloads
- `/store/orders/[orderNumber]` — order detail + live tracking timeline (guest via order-access token)
- `/store/login` `/store/register` — customer auth (OTP/Google/password)
- `/articles` — paginated published list
- `/articles/[slug]` — detail + related
- `/articles/submit` — submit form (auth: CUSTOMER or APPLICANT)
- `/articles/mine` — author's own articles + own view counts

### 11.3 Admin dashboards (strict DESIGN.md, 3-panel list/detail/create)
- `/admin/store/products` — catalog (media, tabs, skus, pricing, tax classes, categories; delete-category confirmation noting child orphaning)
- `/admin/store/inventory` — warehouses + live stock matrix (`/store/stock` Socket.io), reorder alerts, movement ledger
- `/admin/store/procurement` — suppliers + POs (multi-lot lines) + receiving
- `/admin/store/orders` — order dashboard (`/store/orders` realtime), status transitions, shipment + invoice actions
- `/admin/store/returns` — RMA queue (approve/receive/refund; shows remaining refundable cap)
- `/admin/store/coupons` — coupon CRUD (`allowGuest` toggle) + redemption stats
- `/admin/store/analytics` — revenue/inventory KPIs from `StoreDailyStat` (paise→rupees in UI)
- `/admin/store/diy` — DIY guides + bundles editor
- `/admin/store/articles` — moderation queue + full metrics

### 11.4 `api.ts` additions
Extend with store methods grouped by area (catalog, cart, checkout, account, returns, articles, and `admin/store/*`). Money args/returns are rupees; the client passes through and the UI formats.

> **Customer auth token isolation (review/suggestion).** The existing client stores one access token in memory + refresh in `sessionStorage` keyed `arya_refresh`, geared to admin/applicant. **Decided approach:** a thin **`storeApi`** built on the same `request<T>` + refresh machinery but with **separate token slots** (`arya_store_refresh` in storage + a distinct in-memory access token) and the `/store/auth/refresh` endpoint. It also maintains its **own refresh-in-flight promise** so concurrent 401s don't cross-trigger the platform refresh. This lets a logged-in admin and a logged-in customer coexist without collision. (Implementation may be a second `ApiClient` instance scoped to the `(market)` group, or a namespaced sub-store inside the existing client — either is acceptable; the token slots and refresh endpoint must be distinct.) **Guest cart/order:** `storeApi` attaches `X-Cart-Token` and the guest order-access token from `sessionStorage` for guest-scoped calls.

### 11.5 Real-time hooks
- `useStoreOrderSocket(orderNumber)` — customer/guest: connect `/store/orders` (JWT for customers, **guest order-access token for guests**), `joinRoom("order:{id}")`, subscribe `order.statusChanged`/`shipment.updated` for live tracking.
- `useAdminStockSocket()` — admin inventory page: `/store/stock`, room `store-admin`, subscribe `stock.updated`/`stock.low`/`stock.reorderDrafted`.
- `useAdminOrdersSocket()` — admin orders page: `/store/orders`, room `store-admin-orders`, subscribe `order.created`/`order.statusChanged`/`order.paid`.
Reuse `socket.io-client` + JWT/token-in-handshake pattern (CORS origin from server config, 6).

### 11.6 Navbar / IA changes
Add **Store** and **Articles** to the public top nav (marketing layer). Cart icon with live item count. Customer account menu (login/register or account dropdown) distinct from the admin/applicant session. Admin sidebar gains a **Store** section grouping the nine admin dashboards.

---

## 12. Phased Delivery Plan

Ordered to de-risk the hardest pieces first (stock concurrency, money correctness) and grouped so file-disjoint chunks can be parallelized by implementer agents. Each phase ends green (build + lint + targeted tests).

**Phase 0 — Foundation (sequential, gates everything).**
- Schema + all migrations (Section 3, incl. `store_daily_stats`, GIN index, BOM CHECK, media `status`, partial-unique email, multi-lot PO unique); `db:generate`. Razorpay client extraction (`RazorpayService` + event-type-filtered handler contract). **`CustomerStrategy`/`CustomerJwtGuard` (`jwt-customer`), `GuestCartGuard`, `GuestOrderGuard`, `ArticleAuthorGuard`.** `DocumentService.putObject` path + IAM `s3:PutObject`. `(market)` route group + scoped design layer skeleton + `storeApi` token-isolated client skeleton. *Single owner; everything else depends on this.*

**Phase 1 — Catalog + Inventory core (de-risk concurrency early). Parallelizable pair:**
- 1a. `catalog` (products/skus/categories/media row-reserved caps/tabs/tax, race-safe slug, category re-sync) + `/admin/store/products` + public `/store`, `/store/[slug]` read. (files: `modules/store/catalog/*`, `app/(market)/store/*`, admin products page)
- 1b. `inventory` + primitives incl. **`reserveMany` global lock ordering** + advisory-lock/CAS + `/store/stock` realtime (config-sourced CORS) + `/admin/store/inventory`. (files: `modules/store/inventory/*`, `store-realtime`, admin inventory page)
- Disjoint files; integrate via the `inventory` primitives interface. **Land 1b's `reserveMany`/fulfill primitives with integration tests against real Postgres+Redis — including a concurrent multi-SKU opposite-order test that proves no deadlock — before checkout depends on them.**

**Phase 2 — Customers + Cart + Tax + Coupons. Parallelizable:**
- 2a. `customer-auth` (jwt-customer strategy, SHA-256 refresh, own refresh path) + `/store/login|register|account`. 2b. `cart` (GuestCartGuard, token-hash) + `/store/cart`. 2c. `tax` engine (rounding spec, single computation point) + 2d. `coupon` (email-based per-customer cap, allowGuest) + `/admin/store/coupons`. (Cart depends on tax+coupon **validate** only.)

**Phase 3 — Checkout + Orders (the heart; depends on 1+2). Mostly sequential within:**
- 3a. `checkout-order` create + warehouse allocation + DIGITAL 422 + bundle-expansion lock ordering + Razorpay order + reservation + coupon redeem + tax compute→snapshot + `/store/checkout`. 3b. webhook capture (event-type filtered, exactly-once) + fulfill + invoice enqueue + realtime. 3c. `/admin/store/orders` + status machine. (3a/3c split files; 3b follows 3a.)

**Phase 4 — Fulfillment + Returns + Invoicing + Jobs. Parallelizable:**
- 4a. `invoicing` (FOR-UPDATE+advisory gapless numbering, FY-rollover-safe, verbatim-snapshot lines, PutObject PDF) + `store-invoice-generation`. 4b. `fulfillment` (courier abstraction + tracking sync, label via PutObject) + `store-courier-sync`. 4c. `returns` (cumulative refund cap) + `store-refund-processing`. 4d. `store-jobs` crons (reservation-expiry coupled flip+decrement, reorder-alerts, low-stock, coupon-expiry, media-gc, viewcount-increment). (Share only `inventory`/Razorpay interfaces.)

**Phase 5 — DIY + Bundles + Procurement + Analytics. Parallelizable:**
- 5a. `procurement` (suppliers/PO multi-lot/receiving) + `/admin/store/procurement`. 5b. `diy` (guides/steps/bom/bundles) + `/store/[slug]/build` + `/admin/store/diy`. 5c. `store-analytics` (raw-SQL rollup → `StoreDailyStat`) + `store-analytics-rollup` + `/admin/store/analytics`.

**Phase 6 — Articles + premium marketing polish. Parallelizable:**
- 6a. `articles` (ArticleAuthorGuard dual-issuer, row-reserved media caps, GIN related, batched viewcount) + `/articles/*` + `/admin/store/articles`. 6b. Premium landing `/`, navbar/IA, marketing design-layer finishing.

**Cross-cutting throughout:** `storeApi`/`api.ts` additions land alongside each frontend chunk; realtime hooks land with their consuming pages; tests (real Postgres+Redis for concurrency paths) land with each module — concurrency suites MUST include the deadlock-free multi-resource test, the media-cap parallel-presign test, the cumulative-refund-overflow test, and the coupon guest-farming test.

---

## 13. Open Decisions for the Human

Only genuine product/infra forks remain. (Items the original draft left open that are now DECIDED in this revision: analytics rollup storage → `StoreDailyStat` table; customer-auth frontend token storage → isolated `storeApi` slots; DIGITAL checkout behavior → 422-block in v1.)

1. **Warehouse allocation rule + split fulfillment.** Default: single warehouse satisfying the whole order, ordered by `priority` then most-available; else `409 NO_FULFILLABLE_WAREHOUSE`. Confirm this v1 limitation is acceptable, or prioritize a split-fulfillment allocation sub-model now (drives tax origin, seller GSTIN, and reservation).
2. **Single seller GSTIN vs per-warehouse GSTIN (LEGAL — blocking for Phase 4).** India's GST Act requires a separate GSTIN per state of operation; a single-GSTIN invoice from a non-originating state is non-compliant. The schema now carries `Warehouse.gstin` + `Order.sellerGstinSnapshot` to support per-warehouse GSTIN. **Confirm whether v1 operates single-state (one GSTIN, simplest) or multi-state (per-warehouse GSTIN mandatory).** This determines whether the GST invoice PDF is legally valid and MUST be resolved before invoicing is built.
3. **Bundle stock model.** Default: virtual availability computed from members (now implemented atomically under member locks). Alternative: pre-kitted physical stock with its own `StockLevel` + assembly `StockMovement(TRANSFER)`. Confirm virtual is acceptable for v1.
4. **Coupon vs PriceTier precedence / stackability.** Proposed: quantity-tier price applies first, then a **single** coupon on the taxable value, capped by `maxDiscount`; no coupon stacking. Confirm. (Anti-farming + guest restriction are already decided in 8.13.)
5. **Returns window + refund policy (business rule).** Need: days-post-delivery eligibility window; partial vs full refund rules; restocking fee? Should be added to the platform's Hard Business Rules block once decided.
6. **Audit-table partitioning timeline.** When (volume threshold) to introduce monthly range partitioning + retention for `StockMovement`/`OrderEvent`/`ShipmentEvent`. Not blocking; flag for a follow-up migration.
7. **DIGITAL product delivery mechanism.** v1 hard-blocks DIGITAL at checkout (8.10). If digital goods are required now, define delivery (download link / license email) — otherwise it stays blocked.
8. **Razorpay account topology.** Confirm whether pledges and the store share one Razorpay account (then the event-type-filtered handler + recommended dual-webhook-URL config in 8.1 are mandatory) or use separate accounts (cleaner isolation). Either way the ownership-filter in each handler is required.
---

## 14. Resolved Decisions (human-confirmed 2026-06-04)

These supersede the corresponding items in Section 13 (Open Decisions):

1. **Seller GSTIN topology = SINGLE GSTIN (single-state, v1).** One seller GSTIN stored in SiteSettings; `Warehouse.gstin`/`Order.sellerGstinSnapshot` remain in the schema for forward-compat but v1 uses the single configured GSTIN. Intra-state vs inter-state CGST/SGST-vs-IGST is still computed from buyer state vs the single seller state.
2. **Returns policy = 7-day window post-delivery, FULL refund including proportional tax, NO restocking fee.** Add to CLAUDE.md Hard Business Rules. Cumulative-refund cap (Section 4.10/8.5) still enforced.
3. **Razorpay = SEPARATE webhook URL** for the store (`POST /api/store/webhooks/razorpay`), configured distinctly in the Razorpay dashboard. Ownership-filtered handlers (Section 8.1) remain mandatory regardless.
4. (default accepted) Single-warehouse-per-order fulfillment; no split shipments in v1 (409 NO_FULFILLABLE_WAREHOUSE otherwise).
5. (default accepted) Virtual bundle availability, atomic member draw-down.
6. (default accepted) Tier price then one non-stacking coupon (capped by maxDiscount).
7. (default accepted) No audit-table partitioning in v1 (documented follow-up at volume threshold).
8. (default accepted) DIGITAL products 422-blocked in v1.

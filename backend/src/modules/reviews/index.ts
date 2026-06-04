// Public surface of the reviews module. Controllers are NestJS wiring consumed
// only by reviews.module.ts (via direct relative import) and are deliberately
// NOT re-exported here — matching the cart/orders barrels, which export only
// module + service + dto. This keeps the barrel's public API minimal.
export * from './reviews.module';
export * from './reviews.service';
export * from './dto';

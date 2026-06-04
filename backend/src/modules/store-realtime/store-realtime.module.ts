import { Module } from '@nestjs/common';
import { StoreAuthModule } from '@/modules/store-auth';
import { StockGateway } from './stock.gateway';
import { OrdersGateway } from './orders.gateway';

/**
 * Store realtime (architecture Section 6). Two Socket.io gateways modeled on
 * `chat.gateway.ts`:
 *
 *  - StockGateway  (`/store/stock`)  — admin-only live stock feed; relays the
 *    `stock.updated` events InventoryService emits after each committed mutation.
 *  - OrdersGateway (`/store/orders`) — admin / customer / guest live order feed;
 *    relays the `order.updated` events OrdersService emits after checkout /
 *    capture / transition commits.
 *
 * Fan-out is decoupled from the business path via EventEmitter2: the inventory /
 * orders services `emit(...)` after their transactions commit (never inside), and
 * the gateways `@OnEvent(...)` relay to Socket.io rooms. This module therefore
 * does NOT import InventoryModule / OrdersModule — there is no compile-time
 * coupling, only the runtime event bus (EventEmitterModule is global in
 * app.module). Reverse-coupling that way would also create a cycle.
 *
 * Imports:
 *  - StoreAuthModule → re-exports JwtModule (handshake verify with JWT_SECRET)
 *    and GuestTokenService (verify + hash-match the guest order-access token for
 *    the `order:{orderId}` room).
 *
 * PrismaService is global (@Global PrismaModule); ConfigService is global
 * (ConfigModule) — both injectable without an explicit import.
 *
 * The gateways are NOT exported: no other module injects them directly (they are
 * driven purely by the EventEmitter2 bus via @OnEvent), so exporting them would
 * add an unintended, injectable API surface for nothing.
 */
@Module({
  imports: [StoreAuthModule],
  providers: [StockGateway, OrdersGateway],
})
export class StoreRealtimeModule {}

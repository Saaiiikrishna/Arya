import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by the Redis pub/sub adapter so that real-time
 * events (stock.updated / order.updated + chat events) emitted on one replica
 * fan out to clients connected to any other replica (Azure Container Apps runs
 * 1–10 replicas). Without this, each replica keeps an isolated in-memory set of
 * sockets and cross-replica broadcasts are silently dropped.
 *
 * Connection shape mirrors the BullMQ / auth Redis clients: TLS on port 6380
 * (Azure prod), maxRetriesPerRequest: null and lazyConnect so a transient Redis
 * blip never wedges request handling.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  // ReturnType<typeof createAdapter> resolves to ((nsp: any) => RedisAdapter).
  // This structurally satisfies socket.io's AdapterConstructor union
  // (typeof Adapter | ((nsp: Namespace) => Adapter)) because that type's nsp
  // parameter is typed as any, so server.adapter(this.adapterConstructor)
  // below type-checks without a cast.
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(config: ConfigService): Promise<void> {
    const host = config.get<string>('REDIS_HOST', 'localhost');
    const port = config.get<number>('REDIS_PORT', 6379);
    const password = config.get<string>('REDIS_PASSWORD');
    const useTls = String(port) === '6380';

    const options = {
      host,
      port,
      ...(password ? { password } : {}),
      ...(useTls ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
      lazyConnect: true,
    };

    const pubClient = new Redis(options);
    const subClient = pubClient.duplicate();

    // Surface connection errors instead of letting them bubble as unhandled
    // 'error' events (ioredis emits these on the client) and crash the process.
    pubClient.on('error', (err) =>
      this.logger.error(`Socket.IO Redis pub client error: ${err.message}`),
    );
    subClient.on('error', (err) =>
      this.logger.error(`Socket.IO Redis sub client error: ${err.message}`),
    );

    // If one client connects but the other fails, the connected client would
    // otherwise be orphaned — leaving a live TLS socket holding a Redis
    // connection slot and emitting errors indefinitely while main.ts boots on
    // the in-memory fallback. Tear both down before re-throwing so the caller's
    // catch sees a clean failure with no leaked connections.
    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
    } catch (err) {
      pubClient.disconnect();
      subClient.disconnect();
      throw err;
    }

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log(
      `Socket.IO Redis adapter connected (${host}:${port}${useTls ? ', TLS' : ''})`,
    );
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}

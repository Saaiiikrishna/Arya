import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * Global exception filter.
 *
 * - Known HttpExceptions keep their status and client-facing message/shape.
 * - Any other (unexpected) error is logged in full server-side but returns a
 *   generic 500 to the client so we never leak stack traces or internal details.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const method = req?.method;
    const url = req?.originalUrl ?? req?.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Server-side log for 5xx HttpExceptions; 4xx are expected client errors.
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `${method} ${url} -> ${status}: ${exception.message}`,
          exception.stack,
        );
      }

      // Preserve the original (validation/HTTP) response shape.
      const payload =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : body;

      res.status(status).json(payload);
      return;
    }

    // Unknown / unexpected error: log everything, leak nothing.
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error(
      `Unhandled exception on ${method} ${url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(status).json({
      statusCode: status,
      message: 'Internal server error',
    });
  }
}

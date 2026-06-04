import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminGuard } from '@/modules/auth/guards';
import { ReturnsService, ReturnAdminActor } from './returns.service';
import {
  ApproveReturnDto,
  ReceiveReturnDto,
  RejectReturnDto,
  ReturnQueryDto,
} from './dto';

/**
 * Admin returns/RMA board (architecture 4.10):
 *  - GET   /api/admin/store/returns                 queue: filter/paginate
 *  - GET   /api/admin/store/returns/:id             detail
 *  - PATCH /api/admin/store/returns/:id/approve     REQUESTED → APPROVED (no money/stock)
 *  - PATCH /api/admin/store/returns/:id/reject      REQUESTED → REJECTED
 *  - PATCH /api/admin/store/returns/:id/in-transit  APPROVED → IN_TRANSIT (optional)
 *  - POST  /api/admin/store/returns/:id/receive     restock + refund + credit note (idempotent)
 *
 * The lifecycle is REQUESTED → APPROVED → IN_TRANSIT → RECEIVED → REFUNDED.
 * approve/reject/in-transit are idempotent state-transitions → PATCH (matching the
 * spec + the orders status route). `receive` performs side effects (refund, stock,
 * credit note) and is the money step → POST.
 *
 * All routes are AdminGuard-protected. The actor for every audited action is
 * sourced from the JWT (req.user), NEVER the request body (security rule 4ebf502).
 *
 * NOTE: the credit-note issue route (POST .../:id/credit-note) is owned by the
 * invoicing module's controller and is NOT duplicated here; receive() calls
 * InvoicingService.generateCreditNote directly.
 */
@Controller('api/admin/store')
@UseGuards(AdminGuard, ThrottlerGuard)
export class ReturnsAdminController {
  constructor(private readonly returns: ReturnsService) {}

  @Get('returns')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  list(@Req() req: Request, @Query() query: ReturnQueryDto) {
    // Actor role is threaded so the service can mask customer email for MODERATOR.
    return this.returns.listReturns(query, this.actorOf(req));
  }

  @Get('returns/:id')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.returns.getReturnForAdmin(id);
  }

  /**
   * Approve a return: REQUESTED → APPROVED. Authorizes the RMA so the customer can
   * ship the item back. NO money moves and NO stock is restocked here — the
   * financial + inventory settlement happens on `receive`. Idempotent (CAS).
   */
  @Patch('returns/:id/approve')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  approve(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveReturnDto,
  ) {
    return this.returns.approveReturn(id, this.actorOf(req), dto.note);
  }

  /** Reject a REQUESTED return with a structured reason. No money / stock moves. */
  @Patch('returns/:id/reject')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  reject(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectReturnDto,
  ) {
    // Compose the structured code + optional note into the persisted comment.
    const reason = dto.note ? `${dto.reason}: ${dto.note}` : dto.reason;
    return this.returns.rejectReturn(id, reason, this.actorOf(req));
  }

  /**
   * Mark an APPROVED return IN_TRANSIT (the customer has shipped it back). Optional
   * intermediate step; `receive` accepts both APPROVED and IN_TRANSIT. No money /
   * stock moves. Idempotent (CAS).
   */
  @Patch('returns/:id/in-transit')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  inTransit(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.returns.markReturnInTransit(id, this.actorOf(req));
  }

  /**
   * Receive a physically-returned parcel: the money path. Stamps the real
   * receivedAt, then Razorpay refund (cumulative-capped + idempotent), restock into
   * the fulfilling warehouse, and an idempotent credit note — the whole thing
   * guarded by an advisory lock + CAS so a double-click cannot double-refund /
   * double-restock. APPROVED|IN_TRANSIT → RECEIVED → REFUNDED.
   */
  @Post('returns/:id/receive')
  @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  receive(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReceiveReturnDto,
  ) {
    return this.returns.receiveReturn(id, this.actorOf(req), dto.note);
  }

  /** Build the audited actor from the JWT-pinned req.user (never the body). */
  private actorOf(req: Request): ReturnAdminActor {
    const user = (
      req as Request & {
        user?: { id?: string; sub?: string; role?: string };
      }
    ).user;
    const id = user?.id ?? user?.sub;
    // AdminGuard must have populated req.user. An absent identity on an admin
    // route is a guard misconfiguration, not a record-as-'unknown' situation:
    // every audit field is server-pinned from the JWT (security rule 4ebf502), so
    // we fail closed rather than corrupt the audit trail.
    if (!id) {
      throw new UnauthorizedException('Admin identity could not be resolved');
    }
    return { id, role: user?.role };
  }
}

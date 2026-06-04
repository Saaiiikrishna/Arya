import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Product slugs are short lowercase kebab tokens — bound length + charset. */
const MAX_SLUG_LENGTH = 200;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validates a public `:slug` route param BEFORE it reaches the service/DB.
 *
 * The public build view takes a slug (not a UUID), so ParseUUIDPipe cannot guard
 * it. Without a cap, an attacker can submit an arbitrarily large slug on the
 * rate-limited public endpoint, amplifying the DB query parameter and the regex/
 * string handling cost. This pipe enforces a max length and an
 * alphanumeric+hyphen allowlist (the exact shape catalog slugs are generated in),
 * rejecting anything else with a clean 400 before any query runs.
 */
@Injectable()
export class ParseSlugPipe implements PipeTransform<string, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException('slug is required');
    }
    if (value.length > MAX_SLUG_LENGTH) {
      throw new BadRequestException('slug is too long');
    }
    if (!SLUG_PATTERN.test(value)) {
      throw new BadRequestException('slug contains invalid characters');
    }
    return value;
  }
}

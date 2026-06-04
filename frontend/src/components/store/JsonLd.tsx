/**
 * Tiny JSON-LD (schema.org structured-data) injector.
 *
 * Renders a single `<script type="application/ld+json">` whose body is
 * `JSON.stringify(data)`. This uses `dangerouslySetInnerHTML`, which is the
 * canonical, Google-recommended way to embed JSON-LD in React — and it is SAFE
 * here because:
 *   - The payload is OUR OWN structured-data object (a typed plain object built
 *     by the page), never user-authored HTML.
 *   - JSON.stringify escapes the value into valid JSON, not markup.
 *   - We additionally neutralise the only HTML-breakout vector for a JSON string
 *     embedded in a <script> element — a literal "</" sequence (e.g. a product
 *     name containing "</script>") — by escaping `<` to its `<` unicode form.
 *     JSON parsers treat `<` and `<` identically, so the structured data is
 *     unchanged, but the browser's HTML tokenizer can no longer see a closing tag.
 *
 * Presentational + prop-driven (renders nothing visible). Has no hooks and no
 * browser APIs, so it works EQUALLY in a Server Component or a Client Component
 * and does NOT require a `'use client'` directive — `dangerouslySetInnerHTML` is
 * valid in both contexts. (It is currently consumed from client pages; crawlers
 * execute JS and read the injected node, so the script is present in the DOM as
 * soon as the page renders.) Do not add `'use client'` to "fix" anything here.
 */

export interface JsonLdProps {
  /** A schema.org structured-data object (e.g. a Product or Article graph). */
  data: Record<string, unknown>;
}

/** Escape the `<` chars so a value can never break out of the <script> tag. */
function serialize(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // SAFE: our own typed structured data, not user HTML — see file header.
      dangerouslySetInnerHTML={{ __html: serialize(data) }}
    />
  );
}

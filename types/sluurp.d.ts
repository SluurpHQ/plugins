// The `Sluurp` global of server code and plugins (see the server library docs): formats, files, crypto helpers.
// Copied into plugin registries (SluurpHQ/plugins/types/sluurp.d.ts) so plugins type-check on their own.

/** An element of a document read by `Sluurp.XML.document`. */
interface SluurpXmlNode {
  name: string;
  attrs: Record<string, string>;
  parent: SluurpXmlNode | null;
  /** Its children: elements, and runs of text as strings. */
  children: (SluurpXmlNode | string)[];
  elements: SluurpXmlNode[];
  /** All the text in it, its elements' included. */
  text: string;
  attr(name: string): string | null;
  /** The first element a selector finds: names, `*`, `[attr]` or `[attr=value]`, joined by spaces or `>`. */
  find(selector: string): SluurpXmlNode | null;
  findAll(selector: string): SluurpXmlNode[];
  toObject(): unknown;
}

interface SluurpFormat {
  parse(text: string): any;
  stringify(value: unknown): string;
}

declare const Sluurp: {
  YAML: SluurpFormat;
  TOML: SluurpFormat;
  JSON5: SluurpFormat;
  JSONL: { parse(text: string | Uint8Array): any[]; stringify(values: unknown[]): string };
  CSV: {
    parse(text: string, options?: { header?: boolean; separator?: string }): any[];
    stringify(rows: unknown[], options?: { header?: boolean; separator?: string }): string;
  };
  XML: {
    /** A plain object: attributes as `@name`, text beside elements as `#text`, repeats as arrays. */
    parse(text: string): Record<string, any>;
    /** One root element, `{ Invoice: { … } }`, as a document; escaped. */
    stringify(value: Record<string, unknown>, options?: { declaration?: boolean }): string;
    /** The root element, to walk. DTDs are refused. */
    document(text: string): SluurpXmlNode;
    /** A function's answer as XML. */
    respond(text: string, status?: number): { status: number; body: { $xml: string } };
  };
  password: { hash(text: string): string; verify(text: string, hash: string): boolean };
  encoding: Record<string, (value: any) => any>;
  compress(data: Uint8Array | string, format?: "gzip" | "deflate" | "brotli"): Uint8Array;
  decompress(data: Uint8Array, format?: "gzip" | "deflate" | "brotli"): Uint8Array;
  [more: string]: any;
};

/** An invoice format a plugin provides (`export const invoiceFormat`), offered beside the PDF. */
interface SluurpInvoiceFormat {
  name: string;
  label: string;
  /** The issuers' countries it is for (ISO codes); empty for every country. */
  countries: string[];
  contentType: string;
  extension: string;
  build(invoice: SluurpInvoice): string;
}

/** An invoice as billing hands it to a format. Amounts are whole cents. */
interface SluurpInvoice {
  invoice: { number: string; date: string; due: string; title?: string; reference: string; total_cents: number; account: string };
  lines: { label: string; detail?: string; section?: string; quantity: number; unit_cents: number; amount_cents: number; date?: string }[];
  issuer: { name: string; address?: string; company_no?: string; iban?: string; bic?: string; email?: string; phone?: string; web?: string; country?: string };
  payers: { id: string; name: string; email?: string }[];
  account: { id: string; name: string };
  currency: string;
  country: string;
}

// Forms: an author describes a form (its fields, who may submit it, what happens after), and each answer is
// kept as a record of the form's own collection, `_forms_<name>`, so rules, filters and the record sheet work on
// answers as on any collection. Validation happens on the server: the endpoint is reachable without the page.
//
// `submitRule` is in the collection rule language and, absent, is superusers only, as a collection's is; a
// public form says so with an empty rule.

export type FieldType = "text" | "textarea" | "email" | "url" | "number" | "bool" | "date" | "choice" | "multi";

export interface FormField {
  name: string;
  label?: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  /** The answers offered, for `choice` and `multi`. */
  options?: string[];
  max_length?: number | null;
  min?: number | null;
  max?: number | null;
}

export interface Form {
  name: string;
  title?: string;
  description?: string;
  fields: FormField[];
  /** Who may submit, as a collection rule: absent is superusers only, "" anyone. */
  submit_rule?: string | null;
  success_message?: string;
  /** No more answers, the form kept. */
  closed?: boolean;
  /** One answer per signed-in account. */
  one_per_account?: boolean;
  /** Who may read the totals of a poll. */
  results_rule?: string | null;
}

/** The longest a text answer may be, unless its field says. */
export const MAX_LENGTH = 5000;
/** Answers one address may give one form a minute. */
export const RATE = 20;

const NAME = /^[A-Za-z0-9_-]{1,48}$/;

/** The collection a form's answers are kept in: `_forms_<name>`, in the letters a collection's name may have. */
export const collectionOf = (name: string) => `_forms_${name.toLowerCase().replace(/-/g, "_")}`;

/** The part of a form whoever fills it in may see: never its rules, which tell an attacker what to imitate. */
export const publicOf = (f: Form) => ({
  name: f.name,
  title: f.title ?? "",
  description: f.description ?? "",
  closed: !!f.closed,
  success_message: f.success_message ?? "",
  fields: f.fields,
});

/** What is wrong with a definition, or null. */
export function invalid(f: Form): string | null {
  if (!f || typeof f.name !== "string" || !NAME.test(f.name)) return "a form name may hold letters, digits, underscores and dashes";
  if (!Array.isArray(f.fields) || !f.fields.length) return "a form needs at least one field";
  const seen = new Set<string>();
  for (const field of f.fields) {
    if (typeof field.name !== "string" || !NAME.test(field.name)) return `field name ${JSON.stringify(field.name)} may hold letters, digits, underscores and dashes`;
    if (seen.has(field.name)) return `two fields are called ${JSON.stringify(field.name)}`;
    seen.add(field.name);
    if ((field.type === "choice" || field.type === "multi") && !field.options?.length) return `${JSON.stringify(field.name)} offers a choice but lists no options`;
  }
  return null;
}

const COLUMN: Record<FieldType, string> = { number: "number", bool: "bool", email: "email", url: "url", date: "date", multi: "json", text: "text", textarea: "text", choice: "text" };

/** The collection that keeps a form's answers: private, which is what no rules mean. */
export const collectionFor = (f: Form) => ({
  name: collectionOf(f.name),
  schema: [
    ...f.fields.map((field) => ({ name: field.name.toLowerCase().replace(/-/g, "_"), type: COLUMN[field.type] ?? "text", values: field.options ?? [] })),
    // Who answered, when they were signed in; a public form's answers may have nobody.
    { name: "submitted_by", type: "text" },
  ],
});

const text = (v: unknown) => (typeof v === "string" ? v.trim() : JSON.stringify(v));

/** One answer checked and made the value kept: `[value]`, `[]` for none, or the complaint. */
function check(field: FormField, raw: unknown): [unknown] | [] | string {
  const label = field.label || field.name;
  const missing = raw == null || (typeof raw === "string" && !raw.trim()) || (Array.isArray(raw) && !raw.length);
  if (missing) {
    if (field.required) return `${label} is required`;
    return [];
  }
  const long = (s: string) => {
    const limit = field.max_length ?? MAX_LENGTH;
    return [...s].length > limit ? `${label} must be ${limit} characters or fewer` : null;
  };
  switch (field.type) {
    case "bool":
      return [typeof raw === "boolean" ? raw : typeof raw === "string" ? ["true", "on", "1"].includes(raw) : Number(raw) !== 0];
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(n)) return `${label} must be a number`;
      if (field.min != null && n < field.min) return `${label} must be at least ${field.min}`;
      if (field.max != null && n > field.max) return `${label} must be at most ${field.max}`;
      return [n];
    }
    case "choice": {
      const t = text(raw);
      // Not the list back: an answer outside the options came from something other than the form.
      return field.options?.includes(t) ? [t] : `${label} is not one of the offered answers`;
    }
    case "multi": {
      const chosen = (Array.isArray(raw) ? raw : [raw]).map(text);
      return chosen.every((c) => field.options?.includes(c)) ? [chosen] : `${label} is not one of the offered answers`;
    }
    case "email": {
      // Loose on purpose: the only real test of an address is writing to it.
      const t = text(raw);
      if (!t.includes("@") || t.startsWith("@") || t.endsWith("@")) return `${label} does not look like an email address`;
      return long(t) ?? [t];
    }
    case "url": {
      const t = text(raw);
      if (!t.startsWith("http://") && !t.startsWith("https://")) return `${label} must start with http:// or https://`;
      return long(t) ?? [t];
    }
    case "date": {
      const t = text(raw);
      return t.length < 10 ? `${label} must be a date` : [t];
    }
    default: {
      const t = text(raw);
      return long(t) ?? [t];
    }
  }
}

/** An answer as a record, or every complaint at once: fixing one field per round trip is the worst way to fill in a form. */
export function accept(f: Form, body: Record<string, unknown>, by: string | null): { record: Record<string, unknown> } | { errors: { field: string; message: string }[] } {
  const record: Record<string, unknown> = {};
  const errors: { field: string; message: string }[] = [];
  const given = body && typeof body === "object" ? body : {};
  for (const field of f.fields) {
    // A false checkbox is an answer, not a missing one.
    const raw = given[field.name];
    const made = field.type === "bool" && raw === false ? [false] : check(field, raw);
    if (typeof made === "string") errors.push({ field: field.name, message: made });
    else if (made.length) record[field.name.toLowerCase().replace(/-/g, "_")] = made[0];
  }
  // A field nobody asked for is dropped, not refused: a page from before a change may send one more.
  if (by) record.submitted_by = by;
  return errors.length ? { errors } : { record };
}

/** Totals per option of each choice: a poll's results without who gave them. */
export function results(f: Form, rows: Record<string, unknown>[], total: number) {
  const fields: Record<string, unknown> = {};
  for (const field of f.fields) {
    if (field.type !== "choice" && field.type !== "multi") continue;
    const column = field.name.toLowerCase().replace(/-/g, "_");
    const counts = new Map((field.options ?? []).map((o) => [o, 0]));
    for (const row of rows) {
      const v = row[column];
      for (const answer of Array.isArray(v) ? v : [v]) if (typeof answer === "string" && counts.has(answer)) counts.set(answer, counts.get(answer)! + 1);
    }
    fields[field.name] = { label: field.label || field.name, options: [...counts].map(([option, count]) => ({ option, count })) };
  }
  return { total, fields };
}

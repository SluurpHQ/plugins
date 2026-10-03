// /api/fn/forms/form            GET: every form (superusers); POST: define or replace one (superusers)
// /api/fn/forms/form/<name>     GET: what a page needs to show it; POST: an answer; DELETE: the form, not its answers
//
// Run as the system: answers go into a collection the person answering cannot read. Who may do what is decided
// here, by the form's own rules.
import { accept, collectionFor, collectionOf, invalid, publicOf, RATE, type Form } from "../lib.ts";

export const rule = "";
export const runAs = "system";

const reply = (status: number, body: unknown) => ({ status, body });
const missing = (name: string) => reply(404, { message: `form ${JSON.stringify(name)} not found` });

/** The stored form and its row, or null. */
function load(ctx: any, name: string): { id: string; form: Form } | null {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(name)) return null;
  const row = ctx.collection("_forms").list({ filter: `name = "${name}"`, perPage: 1 }).items[0];
  return row ? { id: row.id, form: typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition } : null;
}

/** Whether the caller passes one of a form's rules: absent is superusers only, "" anyone. */
const passes = (ctx: any, rule: string | null | undefined) => ctx.auth.superuser || (rule != null && ctx.rule(rule));

export default function (ctx: any) {
  const name: string = ctx.params?.path ?? "";

  if (!name) {
    if (!ctx.auth.superuser) return reply(403, { message: "forms are defined by an administrator" });
    if (ctx.method === "GET") {
      // The whole definition, rules included: only an administrator sees it.
      return { items: ctx.collection("_forms").list({ perPage: 500, sort: "name" }).items.map((r: any) => (typeof r.definition === "string" ? JSON.parse(r.definition) : r.definition)) };
    }
    const form: Form = ctx.body;
    const wrong = invalid(form);
    if (wrong) return reply(400, { message: wrong });
    // Where the answers go comes first: a form that took an answer with nowhere to keep it would lose it. One
    // already there is left alone; changing it is the collections' business, not a silent rewrite here.
    if (!ctx.collections.get(collectionOf(form.name))) ctx.collections.create(collectionFor(form));
    const kept = load(ctx, form.name);
    if (kept) ctx.collection("_forms").update(kept.id, { definition: form });
    else ctx.collection("_forms").create({ name: form.name, definition: form });
    return { form, collection: collectionOf(form.name) };
  }

  const kept = load(ctx, name);
  if (ctx.method === "DELETE") {
    if (!ctx.auth.superuser) return reply(403, { message: "forms are deleted by an administrator" });
    // The definition only: the answers are a collection, and tidying a form away should not drop them.
    if (kept) ctx.collection("_forms").delete(kept.id);
    return reply(204, null);
  }
  // A private form answers as a missing one: whether it exists is not for an anonymous caller to learn.
  if (!kept || !passes(ctx, kept.form.submit_rule)) return missing(name);
  const form = kept.form;
  if (ctx.method === "GET") return publicOf(form);

  if (form.closed) return reply(400, { message: `${name} is closed` });
  if (ctx.request.ip && !ctx.limit(`${ctx.request.ip}:${name}`, RATE, 60)) return reply(400, { message: "too many submissions; wait a moment" });
  // One per account, when asked: an anonymous answer cannot be held to that, so the form needs a sign-in.
  if (form.one_per_account) {
    if (!ctx.auth.id) return reply(403, { message: "this form accepts one submission per account, so it needs you signed in" });
    if (ctx.collection(collectionOf(name)).count(`submitted_by = "${ctx.auth.id}"`) > 0) return reply(400, { message: "you have already answered this one" });
  }
  const made = accept(form, ctx.body ?? {}, ctx.auth.id ?? null);
  if ("errors" in made) return reply(422, { errors: made.errors });
  ctx.collection(collectionOf(name)).create(made.record);
  // The answer is not sent back: the caller could not otherwise read a row of a collection that is private.
  return reply(201, { ok: true, message: form.success_message ?? "" });
}

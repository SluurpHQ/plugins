// /api/fn/forms/form            GET: every form; POST: define or replace one (both for superusers)
// /api/fn/forms/form/:name      GET: what a page needs to show it; POST: an answer; DELETE: the form, not its answers
//
// Run as the system: answers go into a collection the person answering cannot read. Who may do what is decided
// here, by the form's own rules.
import { accept, collectionFor, collectionOf, invalid, publicOf, RATE, type Form } from "../lib.ts";

export const rule = "";
export const runAs = "system";

const reply = (status: number, body: unknown) => ({ status, body });

/** The stored form and its row, or null. */
function load(ctx: any, name: string): { id: string; form: Form } | null {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(name)) return null;
  const row = ctx.collection("_forms").list({ filter: `name = "${name}"`, perPage: 1 }).items[0];
  return row ? { id: row.id, form: typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition } : null;
}

/** Superusers only; nothing (going on) for them. */
const administrators = (ctx: any) => (ctx.auth.superuser ? undefined : reply(403, { message: "forms are kept by an administrator" }));

/**
 * The form asked for, where the caller may submit it, on `ctx.form`; else 404. A private form answers as a missing
 * one: whether it exists is not for an anonymous caller to learn. Absent rule is superusers only, "" anyone.
 */
const visible = (ctx: any) => {
  const kept = load(ctx, ctx.params.name);
  const rule = kept?.form.submit_rule;
  if (!kept || !(ctx.auth.superuser || (rule != null && ctx.rule(rule)))) return reply(404, { message: `form ${JSON.stringify(ctx.params.name)} not found` });
  ctx.form = kept.form;
};

export default router()
  // The whole definitions, rules included: only an administrator sees them.
  .get("/", administrators, (ctx: any) => ({
    items: ctx.collection("_forms").list({ perPage: 500, sort: "name" }).items.map((r: any) => (typeof r.definition === "string" ? JSON.parse(r.definition) : r.definition)),
  }))
  .post("/", administrators, (ctx: any) => {
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
  })
  .get("/:name", visible, (ctx: any) => publicOf(ctx.form))
  .post("/:name", visible, (ctx: any) => {
    const form: Form = ctx.form;
    if (form.closed) return reply(400, { message: `${form.name} is closed` });
    if (ctx.request.ip && !ctx.limit(`${ctx.request.ip}:${form.name}`, RATE, 60)) return reply(400, { message: "too many submissions; wait a moment" });
    // One per account, when asked: an anonymous answer cannot be held to that, so the form needs a sign-in.
    if (form.one_per_account) {
      if (!ctx.auth.id) return reply(403, { message: "this form accepts one submission per account, so it needs you signed in" });
      if (ctx.collection(collectionOf(form.name)).count(`submitted_by = "${ctx.auth.id}"`) > 0) return reply(400, { message: "you have already answered this one" });
    }
    const made = accept(form, ctx.body ?? {}, ctx.auth.id ?? null);
    if ("errors" in made) return reply(422, { errors: made.errors });
    ctx.collection(collectionOf(form.name)).create(made.record);
    // The answer is not sent back: the caller could not otherwise read a row of a collection that is private.
    return reply(201, { ok: true, message: form.success_message ?? "" });
  })
  // The definition only: the answers are a collection, and tidying a form away should not drop them.
  .delete("/:name", administrators, (ctx: any) => {
    const kept = load(ctx, ctx.params.name);
    if (kept) ctx.collection("_forms").delete(kept.id);
    return reply(204, null);
  });

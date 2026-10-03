// /api/fn/forms/results/:name   GET: a poll's totals per option, for those its results rule lets read them.
import { collectionOf, results, type Form } from "../lib.ts";

export const rule = "";
export const runAs = "system";

export default router().get("/:name", (ctx: any) => {
  const name: string = ctx.params.name;
  const row = /^[A-Za-z0-9_-]{1,48}$/.test(name) ? ctx.collection("_forms").list({ filter: `name = "${name}"`, perPage: 1 }).items[0] : null;
  if (!row) return { status: 404, body: { message: `form ${JSON.stringify(name)} not found` } };
  const form: Form = typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition;
  if (!(ctx.auth.superuser || (form.results_rule != null && ctx.rule(form.results_rule)))) return { status: 403, body: { message: `${name} does not publish its results` } };
  const page = ctx.collection(collectionOf(name)).list({ perPage: 1000 });
  return results(form, page.items, page.totalItems);
});

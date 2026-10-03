// The Forms plugin, as Sluurp's built-in forms were tested: `sluurp test --public forms` from the plugins
// repository runs these in an app made for the run with the plugin in it. Every test names its own forms: the
// run shares one database.
import { expect, test, type Api } from "sluurp/test";

const FORM = "/api/fn/forms/form";
const RESULTS = "/api/fn/forms/results";
let made = 0;
const fresh = (base: string) => `${base}_${Date.now().toString(36)}${made++}`;

const feedback = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  title: "Tell us what you think",
  // Empty means anyone, which is how a public form says so out loud.
  submit_rule: "",
  success_message: "Thank you.",
  fields: [
    { name: "email", label: "Your email", type: "email" },
    { name: "message", label: "Message", type: "textarea", required: true },
    { name: "rating", label: "Rating", type: "number", min: 1, max: 5 },
  ],
  ...extra,
});

const poll = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  title: "What is for lunch?",
  submit_rule: "@request.auth.id != null",
  results_rule: "",
  one_per_account: true,
  fields: [{ name: "choice", label: "Pick one", type: "choice", required: true, options: ["pizza", "salad", "soup"] }],
  ...extra,
});

async function define(admin: Api, form: unknown) {
  const r = await admin.post(FORM, { data: form });
  expect(r.status).toBe(200);
}

const records = async (admin: Api, name: string) => (await admin.get(`/api/collections/_forms_${name}/records`)).json();

test("defining a form creates a collection for its answers", async ({ admin }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  // Answers are an ordinary collection, so everything that works on one works on them.
  const r = await admin.get(`/api/collections/_forms_${name}`);
  expect(r.status).toBe(200);
  const fields = (await r.json()).schema.map((f: { name: string }) => f.name);
  expect(fields).toContain("message");
  expect(fields).toContain("rating");
  expect(fields).toContain("submitted_by");
});

test("a public form can be read and submitted by anyone", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  const shown = await request.get(`${FORM}/${name}`);
  expect(shown.status).toBe(200);
  const definition = await shown.json();
  expect(definition.title).toBe("Tell us what you think");
  expect(definition.fields.length).toBe(3);

  const sent = await request.post(`${FORM}/${name}`, { data: { email: "ada@example.test", message: "Splendid", rating: "5" } });
  expect(sent.status).toBe(201);
  expect((await sent.json()).message).toBe("Thank you.");
  const page = await records(admin, name);
  expect(page.totalItems).toBe(1);
  expect(page.items[0].message).toBe("Splendid");
  // A form posts strings; the number column holds a number.
  expect(page.items[0].rating).toBe(5);
});

test("the definition never carries the rules", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  // Publishing the rules tells an attacker exactly what to imitate.
  const text = await (await request.get(`${FORM}/${name}`)).text();
  expect(text.includes("submit_rule")).toBe(false);
  expect(text.includes("results_rule")).toBe(false);
});

test("answers are private even though the form is public", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  await request.post(`${FORM}/${name}`, { data: { email: "ada@example.test", message: "Private" } });
  // The form collects email addresses: anyone who can answer must not thereby read everyone's answers.
  const r = await request.get(`/api/collections/_forms_${name}/records`);
  if (r.status === 200) expect((await r.json()).totalItems).toBe(0);
  else expect(r.status >= 400).toBe(true);
});

test("the answer is not sent back", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  const body = await (await request.post(`${FORM}/${name}`, { data: { email: "ada@example.test", message: "Quiet" } })).json();
  expect(body.id).toBe(undefined);
  expect(body.email).toBe(undefined);
});

test("a private form is indistinguishable from a missing one", async ({ admin, request }) => {
  const name = fresh("internal");
  const form: Record<string, unknown> = feedback(name);
  // No submit rule at all: superusers only, as a collection's default is.
  delete form.submit_rule;
  await define(admin, form);
  expect((await request.get(`${FORM}/${name}`)).status).toBe(404);
  expect((await request.get(`${FORM}/no-such-form`)).status).toBe(404);
  expect((await request.post(`${FORM}/${name}`, { data: { message: "hello" } })).status).toBe(404);
});

test("validation reports every field at once", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  const r = await request.post(`${FORM}/${name}`, { data: { email: "not-an-address", rating: 9 } });
  expect(r.status).toBe(422);
  const fields = (await r.json()).errors.map((e: { field: string }) => e.field);
  expect(fields).toContain("email");
  expect(fields).toContain("message");
  expect(fields).toContain("rating");
  expect((await records(admin, name)).totalItems).toBe(0);
});

test("a closed form stops accepting without being deleted", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name, { closed: true }));
  expect((await request.get(`${FORM}/${name}`)).status).toBe(200);
  expect((await request.post(`${FORM}/${name}`, { data: { message: "too late" } })).status).toBe(400);
});

test("a definition is refused before it can confuse anyone", async ({ admin }) => {
  expect((await admin.post(FORM, { data: { name: "no fields", fields: [] } })).status).toBe(400);
  expect((await admin.post(FORM, { data: { name: fresh("empty_choice"), fields: [{ name: "c", type: "choice", options: [] }] } })).status).toBe(400);
});

test("only an administrator may define a form", async ({ person }) => {
  const edna = await person();
  expect((await edna.post(FORM, { data: feedback(fresh("feedback")) })).status >= 400).toBe(true);
  expect((await edna.get(FORM)).status >= 400).toBe(true);
});

test("a poll counts answers without revealing who gave them", async ({ admin, request, person }) => {
  const name = fresh("lunch");
  await define(admin, poll(name));
  expect((await (await person("edna")).post(`${FORM}/${name}`, { data: { choice: "pizza" } })).status).toBe(201);
  await (await person("lisa")).post(`${FORM}/${name}`, { data: { choice: "pizza" } });
  // Results are public; the rows behind them are not.
  const r = await request.get(`${RESULTS}/${name}`);
  expect(r.status).toBe(200);
  const results = await r.json();
  expect(results.total).toBe(2);
  const options: { option: string; count: number }[] = results.fields.choice.options;
  expect(options.find((o) => o.option === "pizza")!.count).toBe(2);
  expect(options.find((o) => o.option === "salad")!.count).toBe(0);
  // Every option is there, so a chart does not have to guess at the zeroes.
  expect(options.length).toBe(3);
  expect(JSON.stringify(results).includes("@test.local")).toBe(false);
});

test("one vote each when the poll says so", async ({ admin, request, person }) => {
  const name = fresh("lunch");
  await define(admin, poll(name));
  const edna = await person("edna");
  expect((await edna.post(`${FORM}/${name}`, { data: { choice: "soup" } })).status).toBe(201);
  const again = await edna.post(`${FORM}/${name}`, { data: { choice: "pizza" } });
  expect(again.status).toBe(400);
  expect((await again.json()).message).toContain("already answered");
  expect((await (await request.get(`${RESULTS}/${name}`)).json()).total).toBe(1);
});

test("a poll that wants one vote each needs a signed-in voter", async ({ admin, request }) => {
  const name = fresh("open_lunch");
  await define(admin, poll(name, { submit_rule: "" }));
  // An anonymous voter cannot be counted once, so the form says so rather than pretend.
  expect((await request.post(`${FORM}/${name}`, { data: { choice: "pizza" } })).status).toBe(403);
});

test("an answer outside the options is refused", async ({ admin, person }) => {
  const name = fresh("lunch");
  await define(admin, poll(name));
  expect((await (await person()).post(`${FORM}/${name}`, { data: { choice: "caviar" } })).status).toBe(422);
});

test("results stay private unless the poll publishes them", async ({ admin, request }) => {
  const name = fresh("quiet");
  const quiet: Record<string, unknown> = poll(name);
  delete quiet.results_rule;
  await define(admin, quiet);
  expect((await request.get(`${RESULTS}/${name}`)).status).toBe(403);
  // An administrator can always see them.
  expect((await admin.get(`${RESULTS}/${name}`)).status).toBe(200);
});

test("a form survives being edited", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  await request.post(`${FORM}/${name}`, { data: { message: "first" } });
  await define(admin, feedback(name, { title: "Say something" }));
  expect((await (await request.get(`${FORM}/${name}`)).json()).title).toBe("Say something");
  // Editing a form must not throw away what people already sent it.
  expect((await records(admin, name)).totalItems).toBe(1);
});

test("deleting a form keeps its answers", async ({ admin, request }) => {
  const name = fresh("feedback");
  await define(admin, feedback(name));
  await request.post(`${FORM}/${name}`, { data: { message: "kept" } });
  expect((await admin.delete(`${FORM}/${name}`)).status).toBe(204);
  expect((await request.get(`${FORM}/${name}`)).status).toBe(404);
  // Tidying a form away is not a reason to lose the answers to it.
  expect((await records(admin, name)).totalItems).toBe(1);
});

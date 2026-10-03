// The Forms plugin in the admin: every form, who may answer it and where its answers go; a form edited as
// JSON, which is what it is — small, structural, and a builder would be a second schema editor that says less.
import { signal } from "sluurp/reactive";
import { Button } from "sluurp/kit/button.js";
import { Textarea } from "sluurp/kit/input.js";
import { AlertDialog } from "sluurp/kit/alert-dialog.js";

export const title = "Forms";
export const icon = "forms";

interface Form {
  name: string;
  title?: string;
  submit_rule?: string | null;
  fields?: unknown[];
}

const BLANK: Form & Record<string, unknown> = {
  name: "feedback",
  title: "Tell us what you think",
  // Said, not defaulted: a public form should be a decision somebody made.
  submit_rule: "",
  success_message: "Thank you.",
  fields: [{ name: "message", label: "Message", type: "textarea", required: true }],
};

/** What a rule means, rather than the rule, in a list. */
const who = (rule?: string | null) => (rule == null ? "Administrators only" : rule.trim() === "" ? "Anyone" : rule);
const answersOf = (name: string) => `_forms_${name.toLowerCase().replace(/-/g, "_")}`;

export default ({ api }: any) => {
  const forms = signal<Form[] | null>(null);
  const editing = signal<Form | "new" | null>(null);
  const draft = signal("");
  const failure = signal("");
  const deleting = signal(false);
  const load = async () => forms.set((await api.send("/fn/forms/form")).items);
  load();

  const edit = (f: Form | "new") => {
    editing.set(f);
    draft.set(JSON.stringify(f === "new" ? BLANK : f, null, 2));
    failure.set("");
  };
  const save = async () => {
    let parsed: Form;
    try {
      parsed = JSON.parse(draft());
    } catch (e) {
      return failure.set(`That is not valid JSON: ${(e as Error).message}`);
    }
    try {
      await api.send("/fn/forms/form", { method: "POST", body: parsed });
    } catch (e) {
      return failure.set((e as Error).message);
    }
    editing.set(null);
    load();
  };
  const remove = async () => {
    const f = editing();
    if (f && f !== "new") await api.send(`/fn/forms/form/${f.name}`, { method: "DELETE" });
    editing.set(null);
    load();
  };

  return (
    <div class="grid gap-3">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground">A form collects answers into a collection of its own.</p>
        <Button onClick={() => edit("new")}>New form</Button>
      </div>
      {editing() ? (
        <div class="grid gap-3 rounded-lg border p-3">
          <p class="text-sm text-muted-foreground">
            Answers are kept in <code>_forms_&lt;name&gt;</code>, an ordinary collection. An empty <code>submit_rule</code> lets
            anyone answer; leaving it out lets only an administrator.
          </p>
          {failure() ? <p class="text-sm text-destructive" role="alert">{failure()}</p> : ""}
          <Textarea className="min-h-[420px] font-mono text-xs pointer-fine:text-xs" value={draft} />
          <div class="flex items-center gap-2">
            <Button onClick={save}>Save</Button>
            <Button variant="ghost" onClick={() => editing.set(null)}>Cancel</Button>
            <span class="grow"></span>
            {editing() !== "new" ? <Button variant="destructive" onClick={() => deleting.set(true)}>Delete</Button> : ""}
          </div>
        </div>
      ) : ""}
      {forms() === null ? (
        <p class="text-sm text-muted-foreground">Loading…</p>
      ) : forms()!.length ? (
        <div class="overflow-hidden rounded-lg border">
          <table class="w-full text-sm">
            <thead class="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th class="p-3 font-medium">Form</th><th class="p-3 font-medium">Fields</th><th class="p-3 font-medium">Who may answer</th><th class="p-3 font-medium">Answers</th></tr>
            </thead>
            <tbody>
              {forms()!.map((f) => (
                <tr class="border-b last:border-0 hover:bg-muted/40" onClick={() => edit(f)}>
                  <td class="p-3"><div class="font-medium">{f.name}</div>{f.title ? <div class="text-muted-foreground">{f.title}</div> : ""}</td>
                  <td class="p-3 tabular-nums">{(f.fields ?? []).length}</td>
                  <td class="p-3">{who(f.submit_rule)}</td>
                  <td class="p-3"><a class="underline-offset-4 hover:underline" href={`#/collections/${answersOf(f.name)}`} onClick={(e: Event) => e.stopPropagation()}>{answersOf(f.name)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="text-sm text-muted-foreground">No forms yet.</p>
      )}
      <AlertDialog
        open={deleting}
        title="Delete this form?"
        description="Its answers are kept, in their collection."
        action="Delete form"
        destructive
        onAction={remove}
      />
    </div>
  );
};

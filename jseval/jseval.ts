import engine from "./jseval.wasm";

export async function run(code: string, input?: unknown) {
  const out = await engine.run({ stdin: JSON.stringify({ code, input }) });
  const answer = JSON.parse(out.stdout);
  if ("error" in answer) throw new Error(answer.error);
  return answer.value;
}

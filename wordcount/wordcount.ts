import engine from "./engine.wasm";

export const extensions = [".words"];

export async function count(text: string) {
  const out = await engine.run({ stdin: text });
  return JSON.parse(out.stdout);
}

export async function transform(source: string) {
  return `export default ${JSON.stringify(await count(source))};`;
}

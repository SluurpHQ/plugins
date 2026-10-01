// zig as the C compiler for wasm32-wasip1: cc's own --target is one zig doesn't read.
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--target="));
const r = spawnSync("zig", ["cc", "-target", "wasm32-wasi", ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);

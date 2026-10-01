//! jseval: QuickJS, built into a WebAssembly module with Rust. Runs code the app does not trust (a rule a
//! user wrote, a formula from a record) in an engine of its own, with nothing but its input: no Sluurp, no
//! fetch, no timers. Reads `{ code, input }` as JSON on stdin; writes `{ value }` or `{ error }` on stdout.

use rquickjs::{Context, Runtime};
use std::io::Read;

fn main() {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).expect("stdin");
    let request: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    let code = request["code"].as_str().unwrap_or("");
    let input = request["input"].to_string();
    let runtime = Runtime::new().expect("runtime");
    runtime.set_memory_limit(32 * 1024 * 1024);
    let context = Context::full(&runtime).expect("context");
    let out = context.with(|ctx| {
        let input = ctx.json_parse(input).map_err(|e| e.to_string())?;
        ctx.globals().set("input", input).map_err(|e| e.to_string())?;
        let value: rquickjs::Value = ctx.eval(format!("(() => {{ {code}\n}})()")).map_err(|e| match e {
            rquickjs::Error::Exception => ctx.catch().as_exception().map(|x| x.message().unwrap_or_default()).unwrap_or_else(|| "exception".into()),
            other => other.to_string(),
        })?;
        let json = ctx.json_stringify(value).map_err(|e| e.to_string())?;
        Ok::<_, String>(json.map(|s| s.to_string().unwrap_or_default()).unwrap_or_else(|| "null".into()))
    });
    match out {
        Ok(v) => println!("{{\"value\":{v}}}"),
        Err(e) => println!("{}", serde_json::json!({ "error": e })),
    }
}

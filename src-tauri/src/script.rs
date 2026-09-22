use std::collections::HashMap;

use boa_engine::{Context, Source};
use serde::{Deserialize, Serialize};

const MAX_SCRIPT_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptRequestSnapshot {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptResponseSnapshot {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptExecution {
    phase: String,
    script: String,
    environment: HashMap<String, String>,
    request: ScriptRequestSnapshot,
    response: Option<ScriptResponseSnapshot>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptTestResult {
    name: String,
    passed: bool,
    message: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptResult {
    environment: HashMap<String, Option<String>>,
    headers: HashMap<String, Option<String>>,
    tests: Vec<ScriptTestResult>,
    logs: Vec<String>,
}

fn script_prelude(input: &ScriptExecution) -> Result<String, String> {
    let environment = serde_json::to_string(&input.environment).map_err(|error| error.to_string())?;
    let request = serde_json::to_string(&input.request).map_err(|error| error.to_string())?;
    let response = serde_json::to_string(&input.response).map_err(|error| error.to_string())?;
    let phase = serde_json::to_string(&input.phase).map_err(|error| error.to_string())?;

    Ok(format!(
        r#"
(() => {{
  "use strict";
  const __environment = {environment};
  const __request = {request};
  const __response = {response};
  const __phase = {phase};
  const __result = {{
    environment: {{}},
    headers: {{}},
    tests: [],
    logs: []
  }};

  const __text = (value) => value == null ? "" : String(value);
  const __headerKey = (name) => {{
    const wanted = __text(name).toLowerCase();
    return Object.keys(__request.headers || {{}}).find((key) => key.toLowerCase() === wanted);
  }};
  const __getHeader = (name) => {{
    const key = __headerKey(name);
    return key ? __request.headers[key] : undefined;
  }};
  const __setHeader = (name, value) => {{
    const key = __headerKey(name) || __text(name);
    __request.headers[key] = __text(value);
    __result.headers[key] = __text(value);
  }};
  const __removeHeader = (name) => {{
    const key = __headerKey(name) || __text(name);
    delete __request.headers[key];
    __result.headers[key] = null;
  }};

  const __expect = (actual) => Object.freeze({{
    toBe(expected) {{
      if (!Object.is(actual, expected)) throw new Error(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
      return true;
    }},
    toEqual(expected) {{
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      return true;
    }},
    toContain(expected) {{
      if (actual == null || typeof actual.includes !== "function" || !actual.includes(expected)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      }}
      return true;
    }},
    toBeTruthy() {{
      if (!actual) throw new Error(`Expected ${JSON.stringify(actual)} to be truthy`);
      return true;
    }}
  }});

  const af = Object.freeze({{
    phase: __phase,
    environment: Object.freeze({{
      get(key) {{
        const name = __text(key);
        if (Object.prototype.hasOwnProperty.call(__result.environment, name)) {
          return __result.environment[name] ?? undefined;
        }}
        return __environment[name];
      }},
      set(key, value) {{
        const name = __text(key);
        const text = __text(value);
        __environment[name] = text;
        __result.environment[name] = text;
      }},
      unset(key) {{
        const name = __text(key);
        delete __environment[name];
        __result.environment[name] = null;
      }}
    }}),
    request: Object.freeze({{
      get method() {{ return __request.method; }},
      get url() {{ return __request.url; }},
      get body() {{ return __request.body; }},
      headers: Object.freeze({{
        get: __getHeader,
        set: __setHeader,
        remove: __removeHeader
      }})
    }}),
    response: __response ? Object.freeze({{
      status: __response.status,
      statusText: __response.statusText,
      body: __response.body,
      headers: Object.freeze({{ ...__response.headers }}),
      json() {{ return JSON.parse(__response.body); }}
    }}) : null,
    test(name, check) {{
      const testName = __text(name) || "Unnamed test";
      try {{
        const value = typeof check === "function" ? check() : check;
        if (value === false) throw new Error("Test returned false");
        __result.tests.push({{ name: testName, passed: true, message: "" }});
        return true;
      }} catch (error) {{
        __result.tests.push({{
          name: testName,
          passed: false,
          message: error instanceof Error ? error.message : __text(error)
        }});
        return false;
      }}
    }},
    expect: __expect
  }});

  const console = Object.freeze({{
    log(...values) {{
      __result.logs.push(values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "));
    }},
    warn(...values) {{
      __result.logs.push("[warn] " + values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "));
    }},
    error(...values) {{
      __result.logs.push("[error] " + values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "));
    }}
  }});

  {script}

  return JSON.stringify(__result);
}})()
"#,
        environment = environment,
        request = request,
        response = response,
        phase = phase,
        script = input.script,
    ))
}

fn execute_script(input: ScriptExecution) -> Result<ScriptResult, String> {
    if input.script.len() > MAX_SCRIPT_BYTES {
        return Err(format!(
            "Script is too large ({} bytes; maximum is {MAX_SCRIPT_BYTES}).",
            input.script.len()
        ));
    }

    let source = script_prelude(&input)?;
    let mut context = Context::default();
    let mut limits = context.runtime_limits();
    limits.set_loop_iteration_limit(100_000);
    limits.set_recursion_limit(128);
    limits.set_stack_size_limit(512 * 1024);
    context.set_runtime_limits(limits);

    let value = context
        .eval(Source::from_bytes(source.as_bytes()))
        .map_err(|error| format!("Script execution failed: {error}"))?;
    let json = value
        .to_string(&mut context)
        .map_err(|error| format!("Script result conversion failed: {error}"))?
        .to_std_string_escaped();

    serde_json::from_str(&json).map_err(|error| format!("Invalid script result: {error}"))
}

#[tauri::command]
pub(crate) fn run_script(input: ScriptExecution) -> Result<ScriptResult, String> {
    execute_script(input)
}

#[cfg(test)]
mod tests {
    use super::{execute_script, ScriptExecution, ScriptRequestSnapshot, ScriptResponseSnapshot};
    use std::collections::HashMap;

    fn execution(script: &str, with_response: bool) -> ScriptExecution {
        ScriptExecution {
            phase: if with_response { "test" } else { "preRequest" }.into(),
            script: script.into(),
            environment: HashMap::from([("baseUrl".into(), "https://example.com".into())]),
            request: ScriptRequestSnapshot {
                method: "GET".into(),
                url: "https://example.com/users".into(),
                headers: HashMap::from([("Accept".into(), "application/json".into())]),
                body: String::new(),
            },
            response: with_response.then(|| ScriptResponseSnapshot {
                status: 200,
                status_text: "OK".into(),
                headers: HashMap::from([("content-type".into(), "application/json".into())]),
                body: r#"{"ok":true}"#.into(),
            }),
        }
    }

    #[test]
    fn script_can_mutate_run_environment_and_headers() {
        let result = execute_script(execution(
            r#"
af.environment.set("token", "abc");
af.environment.unset("baseUrl");
af.request.headers.set("X-Test", "yes");
af.request.headers.remove("Accept");
console.log("prepared", af.request.method);
"#,
            false,
        ))
        .expect("script result");

        assert_eq!(result.environment.get("token"), Some(&Some("abc".into())));
        assert_eq!(result.environment.get("baseUrl"), Some(&None));
        assert_eq!(result.headers.get("X-Test"), Some(&Some("yes".into())));
        assert_eq!(result.headers.get("Accept"), Some(&None));
        assert_eq!(result.logs, vec!["prepared GET"]);
    }

    #[test]
    fn test_script_records_assertions_without_host_access() {
        let result = execute_script(execution(
            r#"
af.test("status is 200", () => af.expect(af.response.status).toBe(200));
af.test("body is ok", () => af.expect(af.response.json().ok).toBeTruthy());
af.test("failure is captured", () => af.expect(1).toBe(2));
"#,
            true,
        ))
        .expect("test result");

        assert_eq!(result.tests.len(), 3);
        assert!(result.tests[0].passed);
        assert!(result.tests[1].passed);
        assert!(!result.tests[2].passed);
    }

    #[test]
    fn runaway_loop_hits_runtime_limit() {
        let error = execute_script(execution("while (true) {}", false)).expect_err("loop must fail");
        assert!(error.contains("runtime") || error.contains("Runtime") || error.contains("limit"));
    }
}

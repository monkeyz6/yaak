use crate::error::Error::{RenderStackExceededError, VariableNotFound};
use crate::error::Result;
use crate::{Parser, Token, Tokens, Val};
use log::warn;
use serde_json::json;
use std::collections::HashMap;
use std::future::Future;

const MAX_DEPTH: usize = 50;

pub trait TemplateCallback {
    fn run(
        &self,
        fn_name: &str,
        args: HashMap<String, serde_json::Value>,
    ) -> impl Future<Output = Result<String>> + Send;

    fn transform_arg(&self, fn_name: &str, arg_name: &str, arg_value: &str) -> Result<String>;
}

pub async fn render_json_value_raw<T: TemplateCallback>(
    v: serde_json::Value,
    vars: &HashMap<String, String>,
    cb: &T,
    opt: &RenderOptions,
) -> Result<serde_json::Value> {
    let v = match v {
        serde_json::Value::String(s) => json!(parse_and_render(&s, vars, cb, opt).await?),
        serde_json::Value::Array(a) => {
            let mut new_a = Vec::new();
            for v in a {
                new_a.push(Box::pin(render_json_value_raw(v, vars, cb, opt)).await?)
            }
            json!(new_a)
        }
        serde_json::Value::Object(o) => {
            let mut new_o = serde_json::Map::new();
            for (k, v) in o {
                let key = Box::pin(parse_and_render(&k, vars, cb, opt)).await?;
                let value = Box::pin(render_json_value_raw(v, vars, cb, opt)).await?;
                new_o.insert(key, value);
            }
            json!(new_o)
        }
        v => v,
    };
    Ok(v)
}

async fn parse_and_render_at_depth<T: TemplateCallback>(
    template: &str,
    vars: &HashMap<String, String>,
    cb: &T,
    opt: &RenderOptions,
    depth: usize,
) -> Result<String> {
    let mut p = Parser::new(template);
    let tokens = p.parse()?;
    render(tokens, vars, cb, opt, depth + 1).await
}

pub async fn parse_and_render<T: TemplateCallback>(
    template: &str,
    vars: &HashMap<String, String>,
    cb: &T,
    opt: &RenderOptions,
) -> Result<String> {
    parse_and_render_at_depth(template, vars, cb, opt, 1).await
}

/// Render a JSON document containing template tags.
///
/// Template tags inside JSON strings retain the existing text-substitution behavior. Tags outside
/// strings are treated as complete JSON values: valid JSON results keep their type, while other
/// results are encoded as JSON strings.
pub async fn parse_and_render_json<T: TemplateCallback>(
    template: &str,
    vars: &HashMap<String, String>,
    cb: &T,
    opt: &RenderOptions,
) -> Result<String> {
    let mut parser = Parser::new(template);
    let tokens = parser.parse()?;
    render_json(tokens, vars, cb, opt, 2).await
}

#[derive(Default)]
struct JsonContext {
    in_string: bool,
    string_escape: bool,
    in_line_comment: bool,
    in_block_comment: bool,
}

impl JsonContext {
    fn is_bare_value(&self) -> bool {
        !self.in_string && !self.in_line_comment && !self.in_block_comment
    }

    fn scan(&mut self, text: &str) {
        let mut chars = text.chars().peekable();
        while let Some(ch) = chars.next() {
            if self.in_line_comment {
                if ch == '\n' {
                    self.in_line_comment = false;
                }
                continue;
            }

            if self.in_block_comment {
                if ch == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    self.in_block_comment = false;
                }
                continue;
            }

            if self.in_string {
                if self.string_escape {
                    self.string_escape = false;
                } else if ch == '\\' {
                    self.string_escape = true;
                } else if ch == '"' {
                    self.in_string = false;
                }
                continue;
            }

            if ch == '"' {
                self.in_string = true;
            } else if ch == '/' && chars.peek() == Some(&'/') {
                chars.next();
                self.in_line_comment = true;
            } else if ch == '/' && chars.peek() == Some(&'*') {
                chars.next();
                self.in_block_comment = true;
            }
        }
    }
}

async fn render_json<T: TemplateCallback>(
    tokens: Tokens,
    vars: &HashMap<String, String>,
    cb: &T,
    opt: &RenderOptions,
    mut depth: usize,
) -> Result<String> {
    depth += 1;
    if depth > MAX_DEPTH {
        return opt.error_behavior.handle(Err(RenderStackExceededError));
    }

    let mut output = String::new();
    let mut context = JsonContext::default();
    for token in tokens.tokens {
        match token {
            Token::Raw { text } => {
                context.scan(&text);
                output.push_str(&text);
            }
            Token::Tag { val } => {
                let rendered = opt
                    .error_behavior
                    .handle(render_value(val, vars, cb, opt, depth).await)?;
                if context.is_bare_value() {
                    if serde_json::from_str::<serde_json::Value>(&rendered).is_ok() {
                        output.push_str(&rendered);
                    } else {
                        output.push_str(&serde_json::to_string(&rendered).unwrap());
                    }
                } else {
                    output.push_str(&rendered);
                }
            }
            Token::Eof => {}
        }
    }
    Ok(output)
}

pub enum RenderErrorBehavior {
    Throw,
    ReturnEmpty,
}

pub struct RenderOptions {
    pub error_behavior: RenderErrorBehavior,
}

impl RenderOptions {
    pub fn throw() -> Self {
        Self { error_behavior: RenderErrorBehavior::Throw }
    }

    pub fn return_empty() -> Self {
        Self { error_behavior: RenderErrorBehavior::ReturnEmpty }
    }
}

impl RenderErrorBehavior {
    pub fn handle(&self, r: Result<String>) -> Result<String> {
        match (self, r) {
            (_, Ok(v)) => Ok(v),
            (RenderErrorBehavior::Throw, Err(e)) => Err(e),
            (RenderErrorBehavior::ReturnEmpty, Err(e)) => {
                warn!("Error rendering string: {}", e);
                Ok("".to_string())
            }
        }
    }
}

pub async fn render<T: TemplateCallback>(
    tokens: Tokens,
    vars: &HashMap<String, String>,
    cb: &T,
    opt: &RenderOptions,
    mut depth: usize,
) -> Result<String> {
    depth += 1;
    if depth > MAX_DEPTH {
        return opt.error_behavior.handle(Err(RenderStackExceededError));
    }

    let mut doc_str: Vec<String> = Vec::new();

    for t in tokens.tokens {
        match t {
            Token::Raw { text } => doc_str.push(text),
            Token::Tag { val } => {
                let val = render_value(val, &vars, cb, opt, depth).await;
                doc_str.push(opt.error_behavior.handle(val)?)
            }
            Token::Eof => {}
        }
    }

    Ok(doc_str.join(""))
}

async fn render_value<T: TemplateCallback>(
    val: Val,
    vars: &HashMap<String, String>,
    cb: &T,
    opt: &RenderOptions,
    depth: usize,
) -> Result<String> {
    let v = match val {
        Val::Str { text } => {
            let r = Box::pin(parse_and_render_at_depth(&text, vars, cb, opt, depth)).await?;
            r.to_string()
        }
        Val::Var { name } => match vars.get(name.as_str()) {
            Some(v) => {
                let r = Box::pin(parse_and_render_at_depth(v, vars, cb, opt, depth)).await?;
                r.to_string()
            }
            None => return Err(VariableNotFound(name)),
        },
        Val::Fn { name, args } => {
            let mut resolved_args: HashMap<String, serde_json::Value> = HashMap::new();
            for a in args {
                let v = match a.value.clone() {
                    Val::Bool { value } => serde_json::Value::Bool(value),
                    Val::Null => serde_json::Value::Null,
                    _ => serde_json::Value::String(
                        Box::pin(render_value(a.value, vars, cb, opt, depth)).await?,
                    ),
                };
                resolved_args.insert(a.name, v);
            }
            let result = cb.run(name.as_str(), resolved_args.clone()).await?;
            Box::pin(parse_and_render_at_depth(&result, vars, cb, opt, depth)).await?
        }
        Val::Bool { value } => value.to_string(),
        Val::Null => "".into(),
    };

    Ok(v)
}

#[cfg(test)]
mod parse_and_render_tests {
    use crate::error::Error::{RenderError, RenderStackExceededError, VariableNotFound};
    use crate::error::Result;
    use crate::renderer::TemplateCallback;
    use crate::*;
    use std::collections::HashMap;

    struct EmptyCB {}

    impl TemplateCallback for EmptyCB {
        async fn run(
            &self,
            _fn_name: &str,
            _args: HashMap<String, serde_json::Value>,
        ) -> Result<String> {
            todo!()
        }

        fn transform_arg(
            &self,
            _fn_name: &str,
            _arg_name: &str,
            arg_value: &str,
        ) -> Result<String> {
            Ok(arg_value.to_string())
        }
    }

    #[tokio::test]
    async fn render_empty() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "";
        let vars = HashMap::new();
        let result = "";
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(parse_and_render(template, &vars, &empty_cb, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_text_only() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "Hello World!";
        let vars = HashMap::new();
        let result = "Hello World!";
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(parse_and_render(template, &vars, &empty_cb, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_simple() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let vars = HashMap::from([("foo".to_string(), "bar".to_string())]);
        let result = "bar";
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(parse_and_render(template, &vars, &empty_cb, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_recursive_var() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "foo: ${[ bar ]}".to_string());
        vars.insert("bar".to_string(), "bar: ${[ baz ]}".to_string());
        vars.insert("baz".to_string(), "baz".to_string());

        let result = "foo: bar: baz";
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(parse_and_render(template, &vars, &empty_cb, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_missing_var() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let vars = HashMap::new();
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(
            parse_and_render(template, &vars, &empty_cb, &opt).await,
            Err(VariableNotFound("foo".to_string()))
        );
        Ok(())
    }

    #[tokio::test]
    async fn render_empty_var() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "".to_string());
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(parse_and_render(template, &vars, &empty_cb, &opt).await, Ok("".to_string()));
        Ok(())
    }

    #[tokio::test]
    async fn render_self_referencing_var() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "${[ foo ]}".to_string());
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(
            parse_and_render(template, &vars, &empty_cb, &opt).await,
            Err(RenderStackExceededError)
        );
        Ok(())
    }

    #[tokio::test]
    async fn render_surrounded() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "hello ${[ word ]} world!";
        let vars = HashMap::from([("word".to_string(), "cruel".to_string())]);
        let result = "hello cruel world!";
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        assert_eq!(parse_and_render(template, &vars, &empty_cb, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_valid_fn() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"${[ say_hello(a='John', b='Kate') ]}"#;
        let result = r#"say_hello: 2, Some(String("John")) Some(String("Kate"))"#;
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(format!("{fn_name}: {}, {:?} {:?}", args.len(), args.get("a"), args.get("b")))
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                arg_value: &str,
            ) -> Result<String> {
                Ok(arg_value.to_string())
            }
        }
        assert_eq!(parse_and_render(template, &vars, &CB {}, &opt).await?, result);
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_arg() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"${[ upper(foo='bar') ]}"#;
        let result = r#""BAR""#;
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(match fn_name {
                    "secret" => "abc".to_string(),
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_b64_arg_template() -> Result<()> {
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "bar".to_string());
        let template = r#"${[ upper(foo=b64'Zm9vICdiYXInIGJheg') ]}"#;
        let result = r#""FOO 'BAR' BAZ""#;
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(match fn_name {
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_arg_template() -> Result<()> {
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "bar".to_string());
        let template = r#"${[ upper(foo='${[ foo ]}') ]}"#;
        let result = r#""BAR""#;
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(match fn_name {
                    "secret" => "abc".to_string(),
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_return_template() -> Result<()> {
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "bar".to_string());
        let template = r#"${[ no_op(inner='${[ foo ]}') ]}"#;
        let result = r#""bar""#;
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(match fn_name {
                    "no_op" => args["inner"].to_string(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_nested_fn() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"${[ upper(foo=secret()) ]}"#;
        let result = r#""ABC""#;

        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(match fn_name {
                    "secret" => "abc".to_string(),
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                arg_value: &str,
            ) -> Result<String> {
                Ok(arg_value.to_string())
            }
        }
        assert_eq!(parse_and_render(template, &vars, &CB {}, &opt).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_err() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"hello ${[ error() ]}"#;
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                _fn_name: &str,
                _args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Err(RenderError("Failed to do it!".to_string()))
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                arg_value: &str,
            ) -> Result<String> {
                Ok(arg_value.to_string())
            }
        }

        assert_eq!(
            parse_and_render(template, &vars, &CB {}, &opt).await,
            Err(RenderError("Failed to do it!".to_string()))
        );
        Ok(())
    }
}

#[cfg(test)]
mod parse_and_render_json_tests {
    use crate::error::Result;
    use crate::{RenderOptions, TemplateCallback, parse_and_render_json};
    use std::collections::HashMap;

    struct TestCB {}

    impl TemplateCallback for TestCB {
        async fn run(
            &self,
            fn_name: &str,
            args: HashMap<String, serde_json::Value>,
        ) -> Result<String> {
            match fn_name {
                "json.escape" => Ok(args
                    .get("input")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .replace('\\', "\\\\")
                    .replace('"', "\\\"")),
                _ => unreachable!(),
            }
        }

        fn transform_arg(
            &self,
            _fn_name: &str,
            _arg_name: &str,
            arg_value: &str,
        ) -> Result<String> {
            Ok(arg_value.to_string())
        }
    }

    #[tokio::test]
    async fn renders_bare_string_as_json_string() -> Result<()> {
        let vars = HashMap::from([("model".to_string(), "gpt-5.1".to_string())]);
        let result = parse_and_render_json(
            r#"{"model": ${[ model ]}}"#,
            &vars,
            &TestCB {},
            &RenderOptions::throw(),
        )
        .await?;
        assert_eq!(result, r#"{"model": "gpt-5.1"}"#);
        Ok(())
    }

    #[tokio::test]
    async fn preserves_valid_json_value_types() -> Result<()> {
        let vars = HashMap::from([
            ("number".to_string(), "2048".to_string()),
            ("boolean".to_string(), "true".to_string()),
            ("null_value".to_string(), "null".to_string()),
            ("object".to_string(), r#"{"city":"Shanghai"}"#.to_string()),
            ("array".to_string(), r#"["a","b"]"#.to_string()),
        ]);
        let result = parse_and_render_json(
            r#"{"n":${[number]},"b":${[boolean]},"z":${[null_value]},"o":${[object]},"a":${[array]}}"#,
            &vars,
            &TestCB {},
            &RenderOptions::throw(),
        )
        .await?;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result).unwrap(),
            serde_json::json!({
                "n": 2048,
                "b": true,
                "z": null,
                "o": {"city": "Shanghai"},
                "a": ["a", "b"],
            })
        );
        Ok(())
    }

    #[tokio::test]
    async fn renders_multiple_nested_template_values() -> Result<()> {
        let vars = HashMap::from([
            ("model".to_string(), "${[ model_name ]}".to_string()),
            ("model_name".to_string(), "gpt-5".to_string()),
            ("tokens".to_string(), "1024".to_string()),
        ]);
        let result = parse_and_render_json(
            r#"{"model":${[model]},"max_tokens":${[tokens]}}"#,
            &vars,
            &TestCB {},
            &RenderOptions::throw(),
        )
        .await?;
        assert_eq!(result, r#"{"model":"gpt-5","max_tokens":1024}"#);
        Ok(())
    }

    #[tokio::test]
    async fn retains_quoted_template_text_behavior() -> Result<()> {
        let vars = HashMap::from([("text".to_string(), "Hello \"World\"".to_string())]);
        let result = parse_and_render_json(
            r#"{"value":"${[ json.escape(input=text) ]}"}"#,
            &vars,
            &TestCB {},
            &RenderOptions::throw(),
        )
        .await?;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result).unwrap(),
            serde_json::json!({"value": "Hello \"World\""})
        );
        Ok(())
    }

    #[tokio::test]
    async fn ignores_string_delimiters_inside_json_comments() -> Result<()> {
        let vars = HashMap::from([("model".to_string(), "gpt-5".to_string())]);
        let result = parse_and_render_json(
            "{\n  // a comment with \"quotes\"\n  \"model\": ${[model]}\n}",
            &vars,
            &TestCB {},
            &RenderOptions::throw(),
        )
        .await?;
        assert!(result.contains(r#""model": "gpt-5""#));
        Ok(())
    }

    #[tokio::test]
    async fn returns_missing_variable_error() {
        let result = parse_and_render_json(
            r#"{"model":${[missing]}}"#,
            &HashMap::new(),
            &TestCB {},
            &RenderOptions::throw(),
        )
        .await;
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod render_json_value_raw_tests {
    use crate::error::Result;
    use crate::{
        RenderErrorBehavior, RenderOptions, TemplateCallback, parse_and_render,
        render_json_value_raw,
    };
    use serde_json::json;
    use std::collections::HashMap;

    struct EmptyCB {}

    impl TemplateCallback for EmptyCB {
        async fn run(
            &self,
            _fn_name: &str,
            _args: HashMap<String, serde_json::Value>,
        ) -> Result<String> {
            todo!()
        }

        fn transform_arg(
            &self,
            _fn_name: &str,
            _arg_name: &str,
            arg_value: &str,
        ) -> Result<String> {
            Ok(arg_value.to_string())
        }
    }

    #[tokio::test]
    async fn render_json_value_string() -> Result<()> {
        let v = json!("${[a]}");
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        assert_eq!(render_json_value_raw(v, &vars, &EmptyCB {}, &opt).await?, json!("aaa"));
        Ok(())
    }

    #[tokio::test]
    async fn render_json_value_array() -> Result<()> {
        let v = json!(["${[a]}", "${[a]}"]);
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        let result = render_json_value_raw(v, &vars, &EmptyCB {}, &opt).await?;
        assert_eq!(result, json!(["aaa", "aaa"]));

        Ok(())
    }

    #[tokio::test]
    async fn render_json_value_object() -> Result<()> {
        let v = json!({"${[a]}": "${[a]}"});
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        let result = render_json_value_raw(v, &vars, &EmptyCB {}, &opt).await?;
        assert_eq!(result, json!({"aaa": "aaa"}));

        Ok(())
    }

    #[tokio::test]
    async fn render_json_value_nested() -> Result<()> {
        let v = json!([
            123,
            {"${[a]}": "${[a]}"},
            null,
            "${[a]}",
            false,
            {"x": ["${[a]}"]}
        ]);
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

        let result = render_json_value_raw(v, &vars, &EmptyCB {}, &opt).await?;
        assert_eq!(
            result,
            json!([
                123,
                {"aaa": "aaa"},
                null,
                "aaa",
                false,
                {"x": ["aaa"]}
            ])
        );

        Ok(())
    }

    #[tokio::test]
    async fn render_opt_return_empty() -> Result<()> {
        let vars = HashMap::new();
        let opt = RenderOptions { error_behavior: RenderErrorBehavior::ReturnEmpty };

        let result = parse_and_render("DNE: ${[hello]}", &vars, &EmptyCB {}, &opt).await?;
        assert_eq!(result, "DNE: ".to_string());

        Ok(())
    }
}

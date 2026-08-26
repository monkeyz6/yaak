use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use yaak_templates::parser::{Parser, Token, Val};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateStyle {
    Postman,
    OpenApi,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HasTemplateFunction;

pub fn contains_function(input: &str) -> bool {
    let Ok(tokens) = Parser::new(input).parse() else {
        return false;
    };
    tokens.tokens.iter().any(|token| match token {
        Token::Tag { val } => val_has_function(val),
        _ => false,
    })
}

pub fn contains_function_in_value(value: &Value) -> bool {
    match value {
        Value::String(s) => contains_function(s),
        Value::Array(items) => items.iter().any(contains_function_in_value),
        Value::Object(obj) => obj.values().any(contains_function_in_value),
        _ => false,
    }
}

pub fn contains_function_in_map(map: &BTreeMap<String, Value>) -> bool {
    map.values().any(contains_function_in_value)
}

pub fn rewrite_str(
    input: &str,
    style: TemplateStyle,
    variables: &mut BTreeSet<String>,
) -> Result<String, HasTemplateFunction> {
    let Ok(tokens) = Parser::new(input).parse() else {
        return Ok(input.to_string());
    };
    if tokens.tokens.iter().any(|token| matches!(token, Token::Tag { val } if val_has_function(val)))
    {
        return Err(HasTemplateFunction);
    }

    let mut out = String::new();
    for token in tokens.tokens {
        match token {
            Token::Raw { text } => out.push_str(&text),
            Token::Tag { val: Val::Var { name } } => {
                variables.insert(name.clone());
                out.push_str(&format_var(&name, style));
            }
            Token::Tag { val: Val::Fn { name, .. } } if is_static_secret_function(&name) => {
                // Encrypted / keychain values cannot be represented in Postman or OpenAPI.
                // Drop the secret rather than skipping the whole request.
            }
            Token::Tag { val } => out.push_str(&format!("${{[ {val} ]}}")),
            Token::Eof => {}
        }
    }
    Ok(out)
}

pub fn rewrite_value(
    value: &Value,
    style: TemplateStyle,
    variables: &mut BTreeSet<String>,
) -> Result<Value, HasTemplateFunction> {
    match value {
        Value::String(s) => Ok(Value::String(rewrite_str(s, style, variables)?)),
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(rewrite_value(item, style, variables)?);
            }
            Ok(Value::Array(out))
        }
        Value::Object(obj) => {
            let mut out = Map::new();
            for (key, item) in obj {
                out.insert(key.clone(), rewrite_value(item, style, variables)?);
            }
            Ok(Value::Object(out))
        }
        other => Ok(other.clone()),
    }
}

pub fn rewrite_map(
    map: &BTreeMap<String, Value>,
    style: TemplateStyle,
    variables: &mut BTreeSet<String>,
) -> Result<BTreeMap<String, Value>, HasTemplateFunction> {
    let mut out = BTreeMap::new();
    for (key, value) in map {
        out.insert(key.clone(), rewrite_value(value, style, variables)?);
    }
    Ok(out)
}

fn is_static_secret_function(name: &str) -> bool {
    matches!(name, "secure" | "keychain" | "keyring")
}

fn val_has_function(val: &Val) -> bool {
    match val {
        Val::Fn { name, .. } if is_static_secret_function(name) => false,
        Val::Fn { .. } => true,
        _ => false,
    }
}

fn format_var(name: &str, style: TemplateStyle) -> String {
    match style {
        TemplateStyle::Postman => format!("{{{{{name}}}}}"),
        TemplateStyle::OpenApi => format!("{{{name}}}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_simple_variable_to_postman() {
        let mut vars = BTreeSet::new();
        let rewritten =
            rewrite_str("${[ baseUrl ]}/users", TemplateStyle::Postman, &mut vars).unwrap();
        assert_eq!(rewritten, "{{baseUrl}}/users");
        assert!(vars.contains("baseUrl"));
    }

    #[test]
    fn rewrites_simple_variable_to_openapi() {
        let mut vars = BTreeSet::new();
        let rewritten =
            rewrite_str("${[ baseUrl ]}/users", TemplateStyle::OpenApi, &mut vars).unwrap();
        assert_eq!(rewritten, "{baseUrl}/users");
    }

    #[test]
    fn detects_template_functions() {
        assert!(contains_function("${[ uuid() ]}"));
        assert!(!contains_function("${[ token ]}"));
        assert!(!contains_function("${[ secure(value='secret') ]}"));
        assert!(!contains_function("${[ keychain(service='s', account='a') ]}"));
        assert!(rewrite_str("${[ uuid() ]}", TemplateStyle::Postman, &mut BTreeSet::new()).is_err());
    }

    #[test]
    fn rewrites_secure_functions_to_empty() {
        let mut vars = BTreeSet::new();
        let rewritten = rewrite_str(
            "Bearer ${[ secure(value='secret') ]}",
            TemplateStyle::Postman,
            &mut vars,
        )
        .unwrap();
        assert_eq!(rewritten, "Bearer ");
        assert!(vars.is_empty());
    }
}

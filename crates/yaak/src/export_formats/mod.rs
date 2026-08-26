pub(crate) mod openapi;
pub(crate) mod postman;
pub(crate) mod templates;

use serde_json::{Map, Value};
use std::collections::BTreeMap;
use yaak_models::models::{HttpRequestHeader, HttpUrlParameter};

#[derive(Debug, Clone)]
pub struct FolderExport {
    pub name: String,
    pub description: String,
    pub children: Vec<TreeNode>,
    pub skipped: Vec<crate::export_folder::SkippedItem>,
}

#[derive(Debug, Clone)]
pub enum TreeNode {
    Folder { name: String, description: String, children: Vec<TreeNode> },
    Request(ExportRequest),
}

#[derive(Debug, Clone)]
pub struct ExportRequest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub method: String,
    pub url: String,
    pub url_parameters: Vec<HttpUrlParameter>,
    pub headers: Vec<HttpRequestHeader>,
    pub body_type: Option<String>,
    pub body: BTreeMap<String, Value>,
    pub authentication_type: Option<String>,
    pub authentication: BTreeMap<String, Value>,
}

impl ExportRequest {
    pub fn display_name(&self) -> String {
        if !self.name.trim().is_empty() {
            return self.name.clone();
        }
        let without_vars = self.url.replace("${[", "").replace("]}", "");
        if without_vars.trim().is_empty() {
            "HTTP Request".to_string()
        } else {
            without_vars.trim().to_string()
        }
    }
}

pub fn json_str(map: &BTreeMap<String, Value>, key: &str) -> String {
    match map.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string().trim_matches('"').to_string(),
    }
}

pub fn body_form_items(body: &BTreeMap<String, Value>) -> Vec<Map<String, Value>> {
    match body.get("form") {
        Some(Value::Array(items)) => items.iter().filter_map(|item| item.as_object().cloned()).collect(),
        _ => Vec::new(),
    }
}

pub fn map_bool(map: &Map<String, Value>, key: &str, default: bool) -> bool {
    match map.get(key) {
        Some(Value::Bool(v)) => *v,
        Some(Value::String(s)) => s == "true",
        _ => default,
    }
}

pub fn map_str(map: &Map<String, Value>, key: &str) -> String {
    match map.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string().trim_matches('"').to_string(),
    }
}

pub fn is_path_param(name: &str) -> bool {
    name.starts_with(':')
}

pub fn path_param_key(name: &str) -> String {
    name.trim_start_matches(':').to_string()
}

pub fn extract_path_placeholders(url: &str) -> Vec<String> {
    let mut names = Vec::new();
    let chars: Vec<char> = url.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == ':' {
            let start = i + 1;
            i += 2;
            while i < chars.len() && !matches!(chars[i], '/' | '?' | '#' | ':') {
                i += 1;
            }
            if i > start + 1 {
                let name: String = chars[start..i].iter().collect();
                if !names.contains(&name) {
                    names.push(name);
                }
            }
        } else {
            i += 1;
        }
    }
    names
}

pub fn split_url_hash_query(url: &str) -> (&str, Option<&str>, Option<&str>) {
    let (without_hash, hash) = match url.split_once('#') {
        Some((left, right)) => (left, Some(right)),
        None => (url, None),
    };
    let (base, query) = match without_hash.split_once('?') {
        Some((left, right)) => (left, Some(right)),
        None => (without_hash, None),
    };
    (base, query, hash)
}

pub fn replace_colon_path_params(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let chars: Vec<char> = path.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == ':' {
            out.push('/');
            out.push('{');
            i += 2;
            while i < chars.len() && !matches!(chars[i], '/' | '?' | '#' | ':') {
                out.push(chars[i]);
                i += 1;
            }
            out.push('}');
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

pub fn graphql_parts(body: &BTreeMap<String, Value>) -> (String, String) {
    if let Some(query) = body.get("query").and_then(|v| v.as_str()) {
        let variables = match body.get("variables") {
            Some(Value::String(s)) => s.clone(),
            Some(other) => other.to_string(),
            None => "{}".to_string(),
        };
        return (query.to_string(), variables);
    }
    if let Some(text) = body.get("text").and_then(|v| v.as_str()) {
        if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(text) {
            let query = obj.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let variables = match obj.get("variables") {
                Some(Value::String(s)) => s.clone(),
                Some(other) => other.to_string(),
                None => "{}".to_string(),
            };
            return (query, variables);
        }
        return (text.to_string(), "{}".to_string());
    }
    (String::new(), "{}".to_string())
}

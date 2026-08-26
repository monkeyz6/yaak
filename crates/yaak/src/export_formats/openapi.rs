use super::templates::{TemplateStyle, rewrite_map, rewrite_str};
use super::{
    ExportRequest, FolderExport, TreeNode, body_form_items, extract_path_placeholders, graphql_parts,
    is_path_param, json_str, map_bool, map_str, path_param_key, replace_colon_path_params,
    split_url_hash_query,
};
use crate::export_folder::{SkipReason, SkippedItem};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, HashSet};

pub fn to_openapi(export: &FolderExport) -> crate::Result<(Value, Vec<SkippedItem>, usize)> {
    let mut variables = BTreeSet::new();
    let mut paths = Map::new();
    let mut seen = HashSet::new();
    let mut skipped = Vec::new();
    let mut servers = BTreeSet::new();
    let mut schemes = Map::new();
    let mut exported = 0;

    walk(
        &export.children,
        &export.name,
        &mut paths,
        &mut seen,
        &mut skipped,
        &mut servers,
        &mut schemes,
        &mut variables,
        &mut exported,
    )?;

    let mut server_values = Vec::new();
    for server in &servers {
        let mut item = json!({ "url": server });
        let server_vars = extract_braced_names(server);
        if !server_vars.is_empty() {
            let mut vars = Map::new();
            for name in server_vars {
                vars.insert(name, json!({ "default": "" }));
            }
            item["variables"] = Value::Object(vars);
        }
        server_values.push(item);
    }

    let mut doc = json!({
        "openapi": "3.0.0",
        "info": {
            "title": export.name,
            "description": export.description,
            "version": "1.0.0",
        },
        "paths": paths,
    });
    if !server_values.is_empty() {
        doc["servers"] = Value::Array(server_values);
    }
    if !schemes.is_empty() {
        doc["components"] = json!({ "securitySchemes": schemes });
    }
    let _ = variables;
    Ok((doc, skipped, exported))
}

fn walk(
    nodes: &[TreeNode],
    tag: &str,
    paths: &mut Map<String, Value>,
    seen: &mut HashSet<(String, String)>,
    skipped: &mut Vec<SkippedItem>,
    servers: &mut BTreeSet<String>,
    schemes: &mut Map<String, Value>,
    variables: &mut BTreeSet<String>,
    exported: &mut usize,
) -> crate::Result<()> {
    for node in nodes {
        match node {
            TreeNode::Folder { name, children, .. } => {
                let next = if tag.is_empty() { name.clone() } else { format!("{tag} / {name}") };
                walk(children, &next, paths, seen, skipped, servers, schemes, variables, exported)?;
            }
            TreeNode::Request(request) => {
                write_operation(
                    request, tag, paths, seen, skipped, servers, schemes, variables, exported,
                )?;
            }
        }
    }
    Ok(())
}

fn write_operation(
    request: &ExportRequest,
    tag: &str,
    paths: &mut Map<String, Value>,
    seen: &mut HashSet<(String, String)>,
    skipped: &mut Vec<SkippedItem>,
    servers: &mut BTreeSet<String>,
    schemes: &mut Map<String, Value>,
    variables: &mut BTreeSet<String>,
    exported: &mut usize,
) -> crate::Result<()> {
    let style = TemplateStyle::OpenApi;
    let url = rewrite_str(&request.url, style, variables).expect("functions already filtered");
    let (server, path) = split_server_and_path(&url);
    let path = replace_colon_path_params(&path);
    let method = request.method.to_ascii_lowercase();
    if !seen.insert((path.clone(), method.clone())) {
        skipped.push(SkippedItem {
            name: request.display_name(),
            id: request.id.clone(),
            reason: SkipReason::DuplicatePathMethod,
        });
        return Ok(());
    }
    if let Some(server) = server {
        servers.insert(server);
    }

    let mut parameters = Vec::new();
    let placeholders = extract_path_placeholders(&request.url);
    let mut seen_path = HashSet::new();

    for param in &request.url_parameters {
        let name = rewrite_str(&param.name, style, variables).unwrap_or_else(|_| param.name.clone());
        let value =
            rewrite_str(&param.value, style, variables).unwrap_or_else(|_| param.value.clone());
        if is_path_param(&param.name) || placeholders.contains(&param.name) {
            let key = path_param_key(&param.name);
            if seen_path.insert(key.clone()) {
                parameters.push(json!({
                    "name": key,
                    "in": "path",
                    "required": true,
                    "schema": { "type": "string" },
                    "example": value,
                }));
            }
        } else if param.enabled {
            parameters.push(json!({
                "name": name,
                "in": "query",
                "required": false,
                "schema": { "type": "string" },
                "example": value,
            }));
        }
    }
    for placeholder in placeholders {
        let key = path_param_key(&placeholder);
        if seen_path.insert(key.clone()) {
            parameters.push(json!({
                "name": key,
                "in": "path",
                "required": true,
                "schema": { "type": "string" },
            }));
        }
    }
    for name in extract_braced_names(&path) {
        if seen_path.insert(name.clone()) {
            parameters.push(json!({
                "name": name,
                "in": "path",
                "required": true,
                "schema": { "type": "string" },
            }));
        }
    }

    for header in &request.headers {
        if !header.enabled {
            continue;
        }
        parameters.push(json!({
            "name": rewrite_str(&header.name, style, variables).unwrap_or_else(|_| header.name.clone()),
            "in": "header",
            "required": false,
            "schema": { "type": "string" },
            "example": rewrite_str(&header.value, style, variables).unwrap_or_else(|_| header.value.clone()),
        }));
    }

    let mut operation = json!({
        "operationId": operation_id(request),
        "summary": request.display_name(),
        "tags": [tag],
        "responses": {
            "default": { "description": "Default response" },
        },
    });
    if !request.description.is_empty() {
        operation["description"] = json!(request.description);
    }
    if !parameters.is_empty() {
        operation["parameters"] = Value::Array(parameters);
    }
    if let Some(body) = openapi_body(request, variables) {
        operation["requestBody"] = body;
    }
    if let Some((scheme_name, scheme)) = openapi_security(request, variables) {
        schemes.insert(scheme_name.clone(), scheme);
        operation["security"] = json!([{ scheme_name: [] }]);
    }

    let path_item = paths.entry(path).or_insert_with(|| Value::Object(Map::new()));
    path_item[method] = operation;
    *exported += 1;
    Ok(())
}

fn split_server_and_path(url: &str) -> (Option<String>, String) {
    let (base, _, _) = split_url_hash_query(url);
    if base.starts_with('{') {
        if let Some(end) = base.find('}') {
            let server = base[..=end].to_string();
            let rest = &base[end + 1..];
            let path = if rest.is_empty() {
                "/".to_string()
            } else if rest.starts_with('/') {
                rest.to_string()
            } else {
                format!("/{rest}")
            };
            return (Some(server), path);
        }
    }
    if let Some(scheme_end) = base.find("://") {
        let after_scheme = &base[scheme_end + 3..];
        let host_end = after_scheme.find('/').map(|i| scheme_end + 3 + i).unwrap_or(base.len());
        let server = base[..host_end].to_string();
        let path = if host_end >= base.len() { "/".to_string() } else { base[host_end..].to_string() };
        return (Some(server), if path.is_empty() { "/".into() } else { path });
    }
    let path = if base.is_empty() {
        "/".to_string()
    } else if base.starts_with('/') {
        base.to_string()
    } else {
        format!("/{base}")
    };
    (None, path)
}

fn extract_braced_names(input: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '{' {
            let mut name = String::new();
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == '}' {
                    break;
                }
                name.push(next);
            }
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

fn openapi_body(request: &ExportRequest, variables: &mut BTreeSet<String>) -> Option<Value> {
    let style = TemplateStyle::OpenApi;
    match request.body_type.as_deref() {
        None => None,
        Some("graphql") => {
            let (query, vars) = graphql_parts(&request.body);
            let query = rewrite_str(&query, style, variables).unwrap_or(query);
            let vars_value = serde_json::from_str::<Value>(&vars).unwrap_or(json!({}));
            Some(json!({
                "content": {
                    "application/json": {
                        "example": { "query": query, "variables": vars_value },
                    }
                }
            }))
        }
        Some("application/x-www-form-urlencoded") => {
            Some(json!({
                "content": {
                    "application/x-www-form-urlencoded": {
                        "example": form_example(&request.body, style, variables, false),
                    }
                }
            }))
        }
        Some("multipart/form-data") => {
            Some(json!({
                "content": {
                    "multipart/form-data": {
                        "example": form_example(&request.body, style, variables, true),
                    }
                }
            }))
        }
        Some("binary") => Some(json!({
            "content": {
                "application/octet-stream": {
                    "schema": { "type": "string", "format": "binary" },
                }
            }
        })),
        Some(body_type) => {
            let text = json_str(&request.body, "text");
            let text = rewrite_str(&text, style, variables).unwrap_or(text);
            let mime = if body_type == "other" { "text/plain" } else { body_type };
            let example = if body_type == "application/json" {
                serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text))
            } else {
                Value::String(text)
            };
            Some(json!({
                "content": { mime: { "example": example } }
            }))
        }
    }
}

fn form_example(
    body: &BTreeMap<String, Value>,
    style: TemplateStyle,
    variables: &mut BTreeSet<String>,
    include_files: bool,
) -> Map<String, Value> {
    let mut example = Map::new();
    for item in body_form_items(body) {
        if !map_bool(&item, "enabled", true) {
            continue;
        }
        let name = rewrite_str(&map_str(&item, "name"), style, variables).unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let file = map_str(&item, "file");
        if include_files && !file.is_empty() {
            example.insert(name, json!(file));
        } else {
            let value =
                rewrite_str(&map_str(&item, "value"), style, variables).unwrap_or_default();
            example.insert(name, json!(value));
        }
    }
    example
}

fn openapi_security(
    request: &ExportRequest,
    variables: &mut BTreeSet<String>,
) -> Option<(String, Value)> {
    let style = TemplateStyle::OpenApi;
    let auth = rewrite_map(&request.authentication, style, variables)
        .unwrap_or_else(|_| request.authentication.clone());
    match request.authentication_type.as_deref() {
        Some("bearer") => Some((
            "bearerAuth".into(),
            json!({ "type": "http", "scheme": "bearer" }),
        )),
        Some("basic") => Some(("basicAuth".into(), json!({ "type": "http", "scheme": "basic" }))),
        Some("apikey") => {
            let location = json_str(&auth, "location");
            let name = json_str(&auth, "key");
            let in_ = if location == "query" { "query" } else { "header" };
            let scheme_name = format!("apiKey_{in_}_{}", sanitize_scheme(&name));
            Some((
                scheme_name,
                json!({
                    "type": "apiKey",
                    "in": in_,
                    "name": name,
                }),
            ))
        }
        _ => None,
    }
}

fn sanitize_scheme(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    if sanitized.is_empty() { "key".into() } else { sanitized }
}

fn operation_id(request: &ExportRequest) -> String {
    let mut slug: String = request
        .display_name()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect();
    while slug.contains("__") {
        slug = slug.replace("__", "_");
    }
    let slug = slug.trim_matches('_');
    let suffix = request.id.chars().rev().take(8).collect::<String>().chars().rev().collect::<String>();
    if slug.is_empty() { suffix } else { format!("{slug}_{suffix}") }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export_formats::ExportRequest;
    use std::collections::BTreeMap;
    use yaak_models::models::HttpUrlParameter;

    fn get_user() -> ExportRequest {
        ExportRequest {
            id: "rq_user01".into(),
            name: "Get user".into(),
            description: String::new(),
            method: "GET".into(),
            url: "${[ baseUrl ]}/users/:id".into(),
            url_parameters: vec![HttpUrlParameter {
                name: ":id".into(),
                value: "1".into(),
                enabled: true,
                id: None,
            }],
            headers: vec![],
            body_type: None,
            body: BTreeMap::new(),
            authentication_type: Some("bearer".into()),
            authentication: BTreeMap::from([("token".into(), Value::String("${[ token ]}".into()))]),
        }
    }

    #[test]
    fn uses_folder_path_tags_and_skips_collisions() {
        let export = FolderExport {
            name: "Users".into(),
            description: String::new(),
            children: vec![
                TreeNode::Request(get_user()),
                TreeNode::Folder {
                    name: "Admin".into(),
                    description: String::new(),
                    children: vec![TreeNode::Request(ExportRequest {
                        id: "rq_dup".into(),
                        name: "Get user again".into(),
                        ..get_user()
                    })],
                },
            ],
            skipped: vec![],
        };

        let (doc, skipped, count) = to_openapi(&export).unwrap();
        assert_eq!(count, 1);
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].reason, SkipReason::DuplicatePathMethod);
        assert_eq!(doc["openapi"], "3.0.0");
        assert_eq!(doc["servers"][0]["url"], "{baseUrl}");
        assert_eq!(doc["paths"]["/users/{id}"]["get"]["tags"][0], "Users");
        assert_eq!(doc["paths"]["/users/{id}"]["get"]["security"][0]["bearerAuth"], json!([]));
    }

    #[test]
    fn declares_path_params_from_template_variables() {
        let export = FolderExport {
            name: "Users".into(),
            description: String::new(),
            children: vec![TreeNode::Request(ExportRequest {
                id: "rq_tmpl01".into(),
                name: "Get by var".into(),
                description: String::new(),
                method: "GET".into(),
                url: "${[ baseUrl ]}/users/${[ userId ]}".into(),
                url_parameters: vec![],
                headers: vec![],
                body_type: None,
                body: BTreeMap::new(),
                authentication_type: None,
                authentication: BTreeMap::new(),
            })],
            skipped: vec![],
        };

        let (doc, skipped, count) = to_openapi(&export).unwrap();
        assert_eq!(count, 1);
        assert!(skipped.is_empty());
        assert_eq!(doc["paths"]["/users/{userId}"]["get"]["parameters"][0]["name"], "userId");
        assert_eq!(doc["paths"]["/users/{userId}"]["get"]["parameters"][0]["in"], "path");
        assert_eq!(doc["paths"]["/users/{userId}"]["get"]["parameters"][0]["required"], true);
    }
}

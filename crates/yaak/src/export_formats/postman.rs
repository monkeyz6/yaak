use super::templates::{TemplateStyle, rewrite_map, rewrite_str};
use super::{
    ExportRequest, FolderExport, TreeNode, body_form_items, extract_path_placeholders, graphql_parts,
    is_path_param, json_str, map_bool, map_str, path_param_key, split_url_hash_query,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

const POSTMAN_2_1_SCHEMA: &str =
    "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

pub fn to_postman(export: &FolderExport) -> crate::Result<(Value, usize)> {
    let mut variables = BTreeSet::new();
    let items = write_items(&export.children, &mut variables)?;
    let exported = count_requests(&export.children);

    let collection = json!({
        "info": {
            "name": export.name,
            "description": export.description,
            "schema": POSTMAN_2_1_SCHEMA,
        },
        "item": items,
        "variable": variables.into_iter().map(|key| json!({
            "key": key,
            "value": "",
        })).collect::<Vec<_>>(),
    });
    Ok((collection, exported))
}

fn write_items(
    nodes: &[TreeNode],
    variables: &mut BTreeSet<String>,
) -> crate::Result<Vec<Value>> {
    let mut items = Vec::new();
    for node in nodes {
        match node {
            TreeNode::Folder { name, description, children, .. } => {
                items.push(json!({
                    "name": name,
                    "description": description,
                    "item": write_items(children, variables)?,
                }));
            }
            TreeNode::Request(request) => {
                items.push(write_request(request, variables)?);
            }
        }
    }
    Ok(items)
}

fn write_request(
    request: &ExportRequest,
    variables: &mut BTreeSet<String>,
) -> crate::Result<Value> {
    let style = TemplateStyle::Postman;
    let url = rewrite_str(&request.url, style, variables).expect("functions already filtered");
    let headers = request
        .headers
        .iter()
        .map(|header| {
            json!({
                "key": rewrite_str(&header.name, style, variables).unwrap_or_else(|_| header.name.clone()),
                "value": rewrite_str(&header.value, style, variables).unwrap_or_else(|_| header.value.clone()),
                "disabled": !header.enabled,
            })
        })
        .collect::<Vec<_>>();

    let mut item = json!({
        "name": request.display_name(),
        "request": {
            "method": request.method.to_uppercase(),
            "header": headers,
            "url": postman_url(&url, request, variables),
            "description": request.description,
        },
    });

    if let Some(body) = postman_body(request, variables) {
        item["request"]["body"] = body;
    }
    if let Some(auth) = postman_auth(request, variables) {
        item["request"]["auth"] = auth;
    }
    Ok(item)
}

fn postman_url(
    rewritten_url: &str,
    request: &ExportRequest,
    variables: &mut BTreeSet<String>,
) -> Value {
    let style = TemplateStyle::Postman;
    let (base, _, hash) = split_url_hash_query(rewritten_url);
    let path_placeholders = extract_path_placeholders(request.url.as_str());
    let mut query = Vec::new();
    let mut path_vars = Vec::new();

    for param in &request.url_parameters {
        let name = rewrite_str(&param.name, style, variables).unwrap_or_else(|_| param.name.clone());
        let value =
            rewrite_str(&param.value, style, variables).unwrap_or_else(|_| param.value.clone());
        if is_path_param(&param.name) || path_placeholders.contains(&param.name) {
            path_vars.push(json!({
                "key": path_param_key(&param.name),
                "value": value,
            }));
        } else {
            query.push(json!({
                "key": name,
                "value": value,
                "disabled": !param.enabled,
            }));
        }
    }

    for placeholder in path_placeholders {
        let key = path_param_key(&placeholder);
        if !path_vars.iter().any(|v| v["key"] == key) {
            path_vars.push(json!({ "key": key, "value": "" }));
        }
    }

    let mut url = json!({
        "raw": rewritten_url,
        "query": query,
        "variable": path_vars,
    });

    if let Some(hash) = hash {
        url["hash"] = json!(hash);
    }

    if let Some(idx) = base.find("://") {
        url["protocol"] = json!(&base[..idx]);
        let rest = &base[idx + 3..];
        let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
        if !host.is_empty() {
            url["host"] = json!(host.split('.').collect::<Vec<_>>());
        }
        if !path.is_empty() {
            url["path"] = json!(path.split('/').filter(|s| !s.is_empty()).collect::<Vec<_>>());
        }
    } else if base.starts_with("{{") {
        let (host, path) = match base.find('/') {
            Some(i) => (&base[..i], &base[i + 1..]),
            None => (base, ""),
        };
        url["host"] = json!([host]);
        if !path.is_empty() {
            url["path"] = json!(path.split('/').filter(|s| !s.is_empty()).collect::<Vec<_>>());
        }
    } else if !base.is_empty() {
        url["path"] = json!(
            base.trim_start_matches('/')
                .split('/')
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        );
    }

    url
}

fn postman_body(request: &ExportRequest, variables: &mut BTreeSet<String>) -> Option<Value> {
    let style = TemplateStyle::Postman;
    match request.body_type.as_deref() {
        None => None,
        Some("graphql") => {
            let (query, vars) = graphql_parts(&request.body);
            let query = rewrite_str(&query, style, variables).unwrap_or(query);
            let vars = rewrite_str(&vars, style, variables).unwrap_or(vars);
            Some(json!({
                "mode": "graphql",
                "graphql": { "query": query, "variables": vars },
            }))
        }
        Some("application/x-www-form-urlencoded") => {
            let form = body_form_items(&request.body)
                .into_iter()
                .map(|item| {
                    json!({
                        "key": rewrite_str(&map_str(&item, "name"), style, variables).unwrap_or_default(),
                        "value": rewrite_str(&map_str(&item, "value"), style, variables).unwrap_or_default(),
                        "disabled": !map_bool(&item, "enabled", true),
                    })
                })
                .collect::<Vec<_>>();
            Some(json!({ "mode": "urlencoded", "urlencoded": form }))
        }
        Some("multipart/form-data") => {
            let form = body_form_items(&request.body)
                .into_iter()
                .map(|item| {
                    let file = map_str(&item, "file");
                    if file.is_empty() {
                        json!({
                            "key": rewrite_str(&map_str(&item, "name"), style, variables).unwrap_or_default(),
                            "value": rewrite_str(&map_str(&item, "value"), style, variables).unwrap_or_default(),
                            "disabled": !map_bool(&item, "enabled", true),
                        })
                    } else {
                        json!({
                            "key": rewrite_str(&map_str(&item, "name"), style, variables).unwrap_or_default(),
                            "src": file,
                            "disabled": !map_bool(&item, "enabled", true),
                            "contentType": map_str(&item, "contentType"),
                        })
                    }
                })
                .collect::<Vec<_>>();
            Some(json!({ "mode": "formdata", "formdata": form }))
        }
        Some("binary") => {
            let file_path = json_str(&request.body, "filePath");
            Some(json!({ "mode": "file", "file": { "src": file_path } }))
        }
        Some(body_type) => {
            let text = json_str(&request.body, "text");
            let text = rewrite_str(&text, style, variables).unwrap_or(text);
            let language = if body_type == "application/json" {
                "json"
            } else if body_type == "text/xml" {
                "xml"
            } else {
                "text"
            };
            Some(json!({
                "mode": "raw",
                "raw": text,
                "options": { "raw": { "language": language } },
            }))
        }
    }
}

fn postman_auth(request: &ExportRequest, variables: &mut BTreeSet<String>) -> Option<Value> {
    let style = TemplateStyle::Postman;
    let auth = rewrite_map(&request.authentication, style, variables)
        .unwrap_or_else(|_| request.authentication.clone());
    match request.authentication_type.as_deref() {
        Some("bearer") => Some(json!({
            "type": "bearer",
            "bearer": [
                { "key": "token", "value": json_str(&auth, "token"), "type": "string" },
            ],
        })),
        Some("basic") => Some(json!({
            "type": "basic",
            "basic": [
                { "key": "username", "value": json_str(&auth, "username"), "type": "string" },
                { "key": "password", "value": json_str(&auth, "password"), "type": "string" },
            ],
        })),
        Some("apikey") => {
            let location = json_str(&auth, "location");
            Some(json!({
                "type": "apikey",
                "apikey": [
                    { "key": "key", "value": json_str(&auth, "key"), "type": "string" },
                    { "key": "value", "value": json_str(&auth, "value"), "type": "string" },
                    { "key": "in", "value": if location == "query" { "query" } else { "header" }, "type": "string" },
                ],
            }))
        }
        _ => None,
    }
}

fn count_requests(nodes: &[TreeNode]) -> usize {
    nodes
        .iter()
        .map(|node| match node {
            TreeNode::Folder { children, .. } => count_requests(children),
            TreeNode::Request(_) => 1,
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export_formats::ExportRequest;
    use std::collections::BTreeMap;
    use yaak_models::models::HttpUrlParameter;

    fn request(name: &str, method: &str, url: &str) -> ExportRequest {
        ExportRequest {
            id: "rq_1".into(),
            name: name.into(),
            description: String::new(),
            method: method.into(),
            url: url.into(),
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
    fn nests_folders_and_rewrites_variables() {
        let export = FolderExport {
            name: "Users".into(),
            description: String::new(),
            children: vec![
                TreeNode::Request(request("Get user", "GET", "${[ baseUrl ]}/users/:id")),
                TreeNode::Folder {
                    name: "Admin".into(),
                    description: String::new(),
                    children: vec![TreeNode::Request(ExportRequest {
                        id: "rq_2".into(),
                        name: "List".into(),
                        ..request("List", "GET", "${[ baseUrl ]}/users")
                    })],
                },
            ],
            skipped: vec![],
        };

        let (doc, count) = to_postman(&export).unwrap();
        assert_eq!(count, 2);
        assert_eq!(doc["info"]["name"], "Users");
        assert_eq!(
            doc["info"]["schema"],
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        );
        assert_eq!(doc["item"][0]["request"]["url"]["raw"], "{{baseUrl}}/users/:id");
        assert_eq!(doc["item"][0]["request"]["auth"]["type"], "bearer");
        assert_eq!(doc["item"][0]["request"]["auth"]["bearer"][0]["value"], "{{token}}");
        assert_eq!(doc["item"][1]["name"], "Admin");
        assert_eq!(doc["item"][1]["item"][0]["name"], "List");
        let keys: Vec<&str> = doc["variable"].as_array().unwrap().iter().map(|v| v["key"].as_str().unwrap()).collect();
        assert!(keys.contains(&"baseUrl"));
        assert!(keys.contains(&"token"));
    }
}

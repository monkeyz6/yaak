use crate::export_formats::openapi::to_openapi;
use crate::export_formats::postman::to_postman;
use crate::export_formats::templates::{
    contains_function, contains_function_in_map, contains_function_in_value,
};
use crate::export_formats::{ExportRequest, FolderExport, TreeNode};
use crate::Result;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs::File;
use std::path::Path;
use yaak_models::client_db::ClientDb;
use yaak_models::models::{Folder, HttpRequest};
use yaak_models::query_manager::QueryManager;
use chrono::NaiveDateTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollectionFormat {
    Postman,
    Openapi,
}

impl CollectionFormat {
    pub fn parse(value: &str) -> Result<Self> {
        match value.to_ascii_lowercase().as_str() {
            "postman" => Ok(Self::Postman),
            "openapi" => Ok(Self::Openapi),
            other => Err(crate::Error::InvalidExportFormat(other.to_string())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    Grpc,
    Websocket,
    TemplateFunction,
    UnsupportedAuth,
    DuplicatePathMethod,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Grpc => "gRPC is not supported",
            Self::Websocket => "WebSocket is not supported",
            Self::TemplateFunction => "contains template function",
            Self::UnsupportedAuth => "authentication cannot be mapped",
            Self::DuplicatePathMethod => "duplicate path and method",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedItem {
    pub name: String,
    pub id: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFolderResult {
    pub exported_count: usize,
    pub skipped: Vec<SkippedItem>,
}

pub struct ExportFolderParams<'a> {
    pub query_manager: &'a QueryManager,
    pub folder_id: &'a str,
    pub format: CollectionFormat,
    pub export_path: &'a Path,
}

pub fn export_folder(params: ExportFolderParams<'_>) -> Result<ExportFolderResult> {
    let db = params.query_manager.connect();
    let mut collected = collect_folder(&db, params.folder_id)?;
    let (value, extra_skipped, exported_count) = match params.format {
        CollectionFormat::Postman => {
            let (value, count) = to_postman(&collected)?;
            (value, Vec::new(), count)
        }
        CollectionFormat::Openapi => to_openapi(&collected)?,
    };
    collected.skipped.extend(extra_skipped);

    let file = File::options().create(true).truncate(true).write(true).open(params.export_path)?;
    serde_json::to_writer_pretty(&file, &value)?;
    file.sync_all()?;

    Ok(ExportFolderResult { exported_count, skipped: collected.skipped })
}

fn collect_folder(db: &ClientDb<'_>, folder_id: &str) -> Result<FolderExport> {
    let root = db.get_folder(folder_id)?;
    let mut skipped = Vec::new();

    for request in db.list_grpc_requests_for_folder_recursive(folder_id)? {
        skipped.push(SkippedItem {
            name: display_or_fallback(&request.name, &request.url, "gRPC Request"),
            id: request.id,
            reason: SkipReason::Grpc,
        });
    }
    for request in db.list_websocket_requests_for_folder_recursive(folder_id)? {
        skipped.push(SkippedItem {
            name: display_or_fallback(&request.name, &request.url, "WebSocket Request"),
            id: request.id,
            reason: SkipReason::Websocket,
        });
    }

    let folders = db.list_folders(&root.workspace_id)?;
    let requests = db.list_http_requests(&root.workspace_id)?;
    let children = collect_children(db, folder_id, &folders, &requests, &mut skipped)?;
    Ok(FolderExport {
        name: root.name,
        description: root.description,
        children,
        skipped,
    })
}

fn collect_children(
    db: &ClientDb<'_>,
    folder_id: &str,
    folders: &[Folder],
    requests: &[HttpRequest],
    skipped: &mut Vec<SkippedItem>,
) -> Result<Vec<TreeNode>> {
    let mut pending: Vec<PendingChild> = Vec::new();

    for folder in folders.iter().filter(|folder| folder.folder_id.as_deref() == Some(folder_id)) {
        pending.push(PendingChild {
            sort_priority: folder.sort_priority,
            updated_at: folder.updated_at,
            kind: PendingKind::Folder(folder.clone()),
        });
    }
    for request in requests.iter().filter(|request| request.folder_id.as_deref() == Some(folder_id)) {
        pending.push(PendingChild {
            sort_priority: request.sort_priority,
            updated_at: request.updated_at,
            kind: PendingKind::Request(request.clone()),
        });
    }

    pending.sort_by(|a, b| compare_order(a.sort_priority, a.updated_at, b.sort_priority, b.updated_at));

    let mut children = Vec::new();
    for item in pending {
        match item.kind {
            PendingKind::Folder(folder) => {
                let nested = collect_children(db, &folder.id, folders, requests, skipped)?;
                children.push(TreeNode::Folder {
                    name: folder.name,
                    description: folder.description,
                    children: nested,
                });
            }
            PendingKind::Request(request) => {
                if let Some(node) = resolve_http_request(db, request, skipped)? {
                    children.push(TreeNode::Request(node));
                }
            }
        }
    }
    Ok(children)
}

fn resolve_http_request(
    db: &ClientDb<'_>,
    request: HttpRequest,
    skipped: &mut Vec<SkippedItem>,
) -> Result<Option<ExportRequest>> {
    let (auth_type, authentication, _) = db.resolve_auth_for_http_request(&request)?;
    let headers = db.resolve_headers_for_http_request(&request)?;

    if !is_mappable_auth(auth_type.as_deref()) {
        skipped.push(SkippedItem {
            name: display_or_fallback(&request.name, &request.url, "HTTP Request"),
            id: request.id,
            reason: SkipReason::UnsupportedAuth,
        });
        return Ok(None);
    }

    let resolved = ExportRequest {
        id: request.id.clone(),
        name: request.name.clone(),
        description: request.description,
        method: request.method,
        url: request.url.clone(),
        url_parameters: request.url_parameters,
        headers,
        body_type: request.body_type,
        body: request.body,
        authentication_type: auth_type,
        authentication,
    };

    if request_has_template_function(&resolved) {
        skipped.push(SkippedItem {
            name: resolved.display_name(),
            id: resolved.id,
            reason: SkipReason::TemplateFunction,
        });
        return Ok(None);
    }

    Ok(Some(resolved))
}

fn is_mappable_auth(auth_type: Option<&str>) -> bool {
    match auth_type {
        None | Some("") | Some("none") => true,
        Some("bearer" | "basic" | "apikey") => true,
        Some(_) => false,
    }
}

fn request_has_template_function(request: &ExportRequest) -> bool {
    if contains_function(&request.url) {
        return true;
    }
    if request.headers.iter().any(|h| contains_function(&h.name) || contains_function(&h.value)) {
        return true;
    }
    if request
        .url_parameters
        .iter()
        .any(|p| contains_function(&p.name) || contains_function(&p.value))
    {
        return true;
    }
    if contains_function_in_map(&request.body) || contains_function_in_map(&request.authentication) {
        return true;
    }
    if request.body.values().any(contains_function_in_value) {
        return true;
    }
    false
}

fn display_or_fallback(name: &str, url: &str, fallback: &str) -> String {
    if !name.trim().is_empty() {
        return name.to_string();
    }
    if !url.trim().is_empty() {
        return url.to_string();
    }
    fallback.to_string()
}

fn compare_order(
    a_pri: f64,
    a_updated: NaiveDateTime,
    b_pri: f64,
    b_updated: NaiveDateTime,
) -> Ordering {
    match a_pri.partial_cmp(&b_pri).unwrap_or(Ordering::Equal) {
        Ordering::Equal => a_updated.cmp(&b_updated),
        other => other,
    }
}

struct PendingChild {
    sort_priority: f64,
    updated_at: NaiveDateTime,
    kind: PendingKind,
}

enum PendingKind {
    Folder(Folder),
    Request(HttpRequest),
}

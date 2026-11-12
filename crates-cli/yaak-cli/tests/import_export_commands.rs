mod common;

use common::{cli_cmd, parse_created_id, query_manager, seed_request};
use predicates::str::contains;
use serde_json::Value;
use tempfile::TempDir;
use yaak_models::models::{Folder, GrpcRequest, HttpRequest, HttpUrlParameter};
use yaak_models::util::UpdateSource;

#[test]
fn export_writes_yaak_workspace_file() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("export.json");

    let create_assert =
        cli_cmd(data_dir).args(["workspace", "create", "--name", "Export Me"]).assert().success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");
    seed_request(data_dir, &workspace_id, "req_export");

    cli_cmd(data_dir)
        .args([
            "export",
            export_path.to_str().expect("export path is utf-8"),
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Exported 1 workspace(s)"));

    let exported: Value = serde_json::from_str(
        &std::fs::read_to_string(export_path).expect("export file should exist"),
    )
    .expect("export should be JSON");

    assert_eq!(exported["yaakSchema"], 4);
    assert_eq!(exported["resources"]["workspaces"][0]["id"], workspace_id);
    assert_eq!(exported["resources"]["httpRequests"][0]["id"], "req_export");
}

#[test]
fn import_reads_yaak_workspace_file() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("import.json");

    std::fs::write(
        &import_path,
        r#"{
  "yaakVersion": "test",
  "yaakSchema": 4,
  "resources": {
    "workspaces": [
      {
        "model": "workspace",
        "id": "wrk_import",
        "name": "Imported Workspace"
      }
    ],
    "httpRequests": [
      {
        "model": "http_request",
        "id": "req_import",
        "workspaceId": "wrk_import",
        "name": "Imported Request",
        "method": "GET",
        "url": "https://example.com"
      }
    ]
  }
}"#,
    )
    .expect("write import fixture");

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 workspace, 1 HTTP request"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let workspaces = db.list_workspaces().expect("list imported workspaces");
    let workspace = workspaces
        .iter()
        .find(|workspace| workspace.name == "Imported Workspace")
        .expect("workspace imported");
    assert_ne!(workspace.id, "wrk_import");

    let requests = db.list_http_requests(&workspace.id).expect("list imported requests");
    let request = requests
        .iter()
        .find(|request| request.name == "Imported Request")
        .expect("request imported");
    assert_ne!(request.id, "req_import");
    assert_eq!(request.workspace_id, workspace.id);
    assert_eq!(request.url, "https://example.com");
}

fn write_postman_environment_fixture(path: &std::path::Path) {
    std::fs::write(
        path,
        r#"{
  "name": "Local",
  "_postman_variable_scope": "environment",
  "values": [
    {
      "key": "token",
      "value": "abc123",
      "enabled": true
    }
  ]
}"#,
    )
    .expect("write postman environment fixture");
}

#[test]
fn import_postman_environment_requires_workspace_id() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("postman-env.json");

    cli_cmd(data_dir).args(["workspace", "create", "--name", "Env Target"]).assert().success();
    write_postman_environment_fixture(&import_path);

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .failure()
        .stderr(contains("requires a workspace context"))
        .stderr(contains("--workspace-id"));
}

#[test]
fn import_postman_environment_uses_workspace_id() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("postman-env.json");

    let create_assert =
        cli_cmd(data_dir).args(["workspace", "create", "--name", "Env Target"]).assert().success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");
    write_postman_environment_fixture(&import_path);

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
            "--workspace-id",
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 environment"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let environments = db.list_environments(&workspace_id).expect("list imported environments");

    let imported_environment =
        environments.iter().find(|e| e.name == "Local").expect("postman environment imported");
    assert_eq!(imported_environment.workspace_id, workspace_id);
}

fn seed_folder_export_tree(data_dir: &std::path::Path, workspace_id: &str) {
    let query_manager = query_manager(data_dir);
    query_manager
        .with_tx(|db| {
            db.upsert_folder(
                &Folder {
                    id: "fl_users".into(),
                    workspace_id: workspace_id.into(),
                    name: "Users".into(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )?;
            db.upsert_folder(
                &Folder {
                    id: "fl_admin".into(),
                    workspace_id: workspace_id.into(),
                    folder_id: Some("fl_users".into()),
                    name: "Admin".into(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )?;
            db.upsert_http_request(
                &HttpRequest {
                    id: "rq_get_user".into(),
                    workspace_id: workspace_id.into(),
                    folder_id: Some("fl_users".into()),
                    name: "Get user".into(),
                    method: "GET".into(),
                    url: "${[ baseUrl ]}/users/:id".into(),
                    url_parameters: vec![HttpUrlParameter {
                        name: ":id".into(),
                        value: "1".into(),
                        enabled: true,
                        id: None,
                    }],
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )?;
            db.upsert_http_request(
                &HttpRequest {
                    id: "rq_list".into(),
                    workspace_id: workspace_id.into(),
                    folder_id: Some("fl_admin".into()),
                    name: "List".into(),
                    method: "GET".into(),
                    url: "${[ baseUrl ]}/users".into(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )?;
            db.upsert_http_request(
                &HttpRequest {
                    id: "rq_fn".into(),
                    workspace_id: workspace_id.into(),
                    folder_id: Some("fl_users".into()),
                    name: "Random id".into(),
                    method: "GET".into(),
                    url: "https://example.com/${[ uuid() ]}".into(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )?;
            db.upsert_grpc_request(
                &GrpcRequest {
                    id: "gr_users".into(),
                    workspace_id: workspace_id.into(),
                    folder_id: Some("fl_users".into()),
                    name: "UserService".into(),
                    url: "https://example.com".into(),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )?;
            Ok::<_, yaak_models::error::Error>(())
        })
        .expect("seed folder export tree");
}

#[test]
fn export_folder_writes_nested_postman_collection() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("users.postman_collection.json");

    let create_assert =
        cli_cmd(data_dir).args(["workspace", "create", "--name", "Folder Export"]).assert().success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");
    seed_folder_export_tree(data_dir, &workspace_id);

    cli_cmd(data_dir)
        .args([
            "export",
            export_path.to_str().expect("export path is utf-8"),
            "--folder-id",
            "fl_users",
            "--format",
            "postman",
        ])
        .assert()
        .success()
        .stdout(contains("Exported 2 HTTP requests"))
        .stderr(contains("Skipped 2:"))
        .stderr(contains("Random id"))
        .stderr(contains("UserService"));

    let exported: Value = serde_json::from_str(
        &std::fs::read_to_string(&export_path).expect("export file should exist"),
    )
    .expect("export should be JSON");

    assert_eq!(exported["info"]["name"], "Users");
    assert_eq!(
        exported["info"]["schema"],
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    );
    let items = exported["item"].as_array().expect("collection items");
    let get_user = items.iter().find(|item| item["name"] == "Get user").expect("Get user item");
    let admin = items.iter().find(|item| item["name"] == "Admin").expect("Admin folder");
    assert_eq!(get_user["request"]["url"]["raw"], "{{baseUrl}}/users/:id");
    assert_eq!(admin["item"][0]["name"], "List");
}

#[test]
fn export_folder_writes_openapi_with_folder_tags() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("users.openapi.json");

    let create_assert =
        cli_cmd(data_dir).args(["workspace", "create", "--name", "Folder Export"]).assert().success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");
    seed_folder_export_tree(data_dir, &workspace_id);

    cli_cmd(data_dir)
        .args([
            "export",
            export_path.to_str().expect("export path is utf-8"),
            "--folder-id",
            "fl_users",
            "--format",
            "openapi",
        ])
        .assert()
        .success()
        .stdout(contains("Exported 2 HTTP requests"));

    let exported: Value = serde_json::from_str(
        &std::fs::read_to_string(&export_path).expect("export file should exist"),
    )
    .expect("export should be JSON");

    assert_eq!(exported["openapi"], "3.0.0");
    assert_eq!(exported["info"]["title"], "Users");
    assert_eq!(exported["servers"][0]["url"], "{baseUrl}");
    assert_eq!(exported["paths"]["/users/{id}"]["get"]["tags"][0], "Users");
    assert_eq!(exported["paths"]["/users"]["get"]["tags"][0], "Users / Admin");
}

fn write_linked_fixture(path: &std::path::Path, requests: &[(&str, &str, &str)]) {
    let requests = requests
        .iter()
        .map(|(id, name, url)| {
            format!(
                r#"{{ "model": "http_request", "id": "{id}", "workspaceId": "wrk_link",
                     "name": "{name}", "method": "GET", "url": "{url}" }}"#
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    std::fs::write(
        path,
        format!(
            r#"{{
  "yaakVersion": "test",
  "yaakSchema": 4,
  "resources": {{
    "workspaces": [{{ "model": "workspace", "id": "wrk_link", "name": "Linked Workspace" }}],
    "httpRequests": [{requests}]
  }}
}}"#
        ),
    )
    .expect("write linked fixture");
}

#[test]
fn re_import_merges_into_linked_workspace() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("linked.json");

    write_linked_fixture(
        &import_path,
        &[
            ("req_a", "Request A", "https://example.com/a"),
            ("req_b", "Request B", "https://example.com/b"),
        ],
    );
    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 workspace, 2 HTTP requests"));

    let workspace_id = {
        let query_manager = query_manager(data_dir);
        let db = query_manager.connect();
        db.list_workspaces()
            .expect("list workspaces")
            .into_iter()
            .find(|w| w.name == "Linked Workspace")
            .expect("workspace imported")
            .id
    };

    // The source doc changes A, drops B, and adds C. The default selection applies the
    // update and the create but leaves the removal as an offer.
    write_linked_fixture(
        &import_path,
        &[
            ("req_a", "Request A", "https://example.com/a-v2"),
            ("req_c", "Request C", "https://example.com/c"),
        ],
    );
    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
            "--workspace-id",
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Imported 2 HTTP requests"))
        .stdout(contains("Skipped 1 removed from source"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let requests = db.list_http_requests(&workspace_id).expect("list requests");
    assert_eq!(requests.len(), 3, "merge must not duplicate: {requests:?}");
    assert_eq!(
        requests.iter().find(|r| r.name == "Request A").expect("request A").url,
        "https://example.com/a-v2"
    );
    assert!(requests.iter().any(|r| r.name == "Request B"), "removal must not auto-apply");
    assert!(requests.iter().any(|r| r.name == "Request C"));
}

#[test]
fn re_import_leaves_deleted_resources_alone() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("linked.json");

    write_linked_fixture(
        &import_path,
        &[
            ("req_a", "Request A", "https://example.com/a"),
            ("req_b", "Request B", "https://example.com/b"),
        ],
    );
    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .success();

    let workspace_id = {
        let query_manager = query_manager(data_dir);
        let db = query_manager.connect();
        let workspace_id = db
            .list_workspaces()
            .expect("list workspaces")
            .into_iter()
            .find(|w| w.name == "Linked Workspace")
            .expect("workspace imported")
            .id;
        let request_b = db
            .list_http_requests(&workspace_id)
            .expect("list requests")
            .into_iter()
            .find(|r| r.name == "Request B")
            .expect("request B imported");
        drop(db);
        query_manager
            .with_tx(|tx| tx.delete_http_request_by_id(&request_b.id, &UpdateSource::Sync))
            .expect("delete request B");
        workspace_id
    };

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
            "--workspace-id",
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Skipped 1 ignored"));

    let query_manager = query_manager(data_dir);
    let requests =
        query_manager.connect().list_http_requests(&workspace_id).expect("list requests");
    assert_eq!(requests.len(), 1, "a deleted request must not come back: {requests:?}");
    assert_eq!(requests[0].name, "Request A");
}

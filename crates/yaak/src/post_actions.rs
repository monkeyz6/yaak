use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use serde_json::Value;
use serde_json_path::JsonPath;
use std::str::FromStr;
use yaak_crypto::manager::EncryptionManager;
use yaak_models::models::{EnvironmentVariable, HttpRequest, PostResponseAction};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_templates::{FnArg, Token, Tokens, Val};

const SET_ENVIRONMENT_VARIABLE: &str = "set_environment_variable";

/// Response bodies larger than this are never parsed for post-response actions.
pub const MAX_POST_ACTION_BODY_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum PostActionBody<'a> {
    Json(&'a [u8]),
    EventStream,
    TooLarge { limit: u64 },
    Unreadable(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct PostActionOutcome {
    pub action_id: Option<String>,
    pub variable_name: String,
    pub environment_id: String,
    pub environment_name: String,
    pub status: &'static str,
    pub message: String,
}

pub fn execute_post_response_actions(
    query_manager: &QueryManager,
    request: &HttpRequest,
    environment_id: Option<&str>,
    response_status: i32,
    body: PostActionBody,
    encryption_manager: Option<&EncryptionManager>,
    update_source: &UpdateSource,
) -> Vec<PostActionOutcome> {
    let actions = request
        .post_response_actions
        .iter()
        .filter(|action| action.enabled)
        .collect::<Vec<_>>();
    if actions.is_empty() {
        return Vec::new();
    }

    if !(200..300).contains(&response_status) {
        return actions
            .into_iter()
            .map(|action| {
                skipped(action, &format!("Skipped because the response status was {response_status}"))
            })
            .collect();
    }

    let target = query_manager.with_conn(|db| match environment_id {
        Some(id) => db.get_environment(id).ok(),
        None => db.get_base_environment(&request.workspace_id).ok(),
    });
    let Some(target) = target else {
        return actions
            .into_iter()
            .map(|action| failure(action, "No target environment was available"))
            .collect();
    };

    let response_body = match body {
        PostActionBody::Json(bytes) => bytes,
        PostActionBody::EventStream => {
            return actions
                .into_iter()
                .map(|action| {
                    failure_for(action, &target, "SSE response bodies are not supported")
                })
                .collect();
        }
        PostActionBody::TooLarge { limit } => {
            let message = format!(
                "Response body exceeds the {} MB limit for post-response actions",
                limit / (1024 * 1024)
            );
            return actions
                .into_iter()
                .map(|action| failure_for(action, &target, &message))
                .collect();
        }
        PostActionBody::Unreadable(message) => {
            let message = format!("Failed to read response body: {message}");
            return actions
                .into_iter()
                .map(|action| failure_for(action, &target, &message))
                .collect();
        }
    };

    let json: Value = match serde_json::from_slice(response_body) {
        Ok(json) => json,
        Err(_) => {
            return actions
                .into_iter()
                .map(|action| failure_for(action, &target, "Response body is not valid JSON"))
                .collect();
        }
    };

    let extracted = actions
        .into_iter()
        .map(|action| (action, extract_value(action, &json)))
        .collect::<Vec<_>>();

    query_manager
        .with_tx(|db| {
            let mut environment = db.get_environment(&target.id)?;
            let mut outcomes = Vec::with_capacity(extracted.len());

            for (action, result) in &extracted {
                let value = match result {
                    Ok(value) => value,
                    Err(message) => {
                        outcomes.push(failure_for(action, &environment, message));
                        continue;
                    }
                };

                let value = if action.secure {
                    match encrypt_value(encryption_manager, &request.workspace_id, value) {
                        Ok(encrypted) => encrypted,
                        Err(message) => {
                            outcomes.push(failure_for(action, &environment, &message));
                            continue;
                        }
                    }
                } else {
                    value.clone()
                };
                let value = &value;

                if let Some(variable) = environment
                    .variables
                    .iter_mut()
                    .find(|variable| variable.name == action.variable_name)
                {
                    variable.value = value.clone();
                    variable.enabled = true;
                } else {
                    environment.variables.push(EnvironmentVariable {
                        enabled: true,
                        name: action.variable_name.clone(),
                        value: value.clone(),
                        id: None,
                    });
                }

                let (status, message) = if environment.public && !action.secure {
                    (
                        "warning",
                        "Variable stored as plain text in a public environment; it may be shared \
                         or written to sync files. Enable the action's encrypt option to protect it",
                    )
                } else if action.secure {
                    ("success", "Variable updated (encrypted)")
                } else {
                    ("success", "Variable updated")
                };
                outcomes.push(PostActionOutcome {
                    action_id: action.id.clone(),
                    variable_name: action.variable_name.clone(),
                    environment_id: environment.id.clone(),
                    environment_name: environment.name.clone(),
                    status,
                    message: message.to_string(),
                });
            }

            if outcomes.iter().any(|outcome| outcome.status != "error") {
                db.upsert_environment(&environment, update_source)?;
            }
            Ok(outcomes)
        })
        .unwrap_or_else(|err: yaak_models::error::Error| {
            extracted
                .iter()
                .map(|(action, _)| {
                    failure_for(action, &target, &format!("Failed to update environment: {err}"))
                })
                .collect()
        })
}

fn encrypt_value(
    encryption_manager: Option<&EncryptionManager>,
    workspace_id: &str,
    value: &str,
) -> Result<String, String> {
    let Some(encryption_manager) = encryption_manager else {
        return Err("Encryption is not available in this context".to_string());
    };
    let encrypted = encryption_manager
        .encrypt(workspace_id, value.as_bytes())
        .map_err(|err| format!("Failed to encrypt value: {err}"))?;
    let encoded = format!("YENC_{}", BASE64_STANDARD.encode(encrypted));
    let tokens = Tokens {
        tokens: vec![Token::Tag {
            val: Val::Fn {
                name: "secure".to_string(),
                args: vec![FnArg { name: "value".to_string(), value: Val::Str { text: encoded } }],
            },
        }],
    };
    Ok(tokens.to_string())
}

fn extract_value(action: &PostResponseAction, json: &Value) -> Result<String, String> {
    if action.action_type != SET_ENVIRONMENT_VARIABLE {
        return Err(format!("Unsupported post-response action type: {}", action.action_type));
    }
    if action.variable_name.trim().is_empty() {
        return Err("Environment variable name is required".to_string());
    }

    let path = JsonPath::from_str(action.json_path.trim())
        .map_err(|err| format!("Invalid JSONPath: {err}"))?;
    let nodes = path.query(json);
    let Some(value) = nodes.first() else {
        return Err("JSONPath did not match any values".to_string());
    };

    Ok(match value {
        Value::String(value) => value.clone(),
        value => serde_json::to_string(value).map_err(|err| err.to_string())?,
    })
}

fn failure(action: &PostResponseAction, message: &str) -> PostActionOutcome {
    PostActionOutcome {
        action_id: action.id.clone(),
        variable_name: action.variable_name.clone(),
        environment_id: String::new(),
        environment_name: String::new(),
        status: "error",
        message: message.to_string(),
    }
}

fn skipped(action: &PostResponseAction, message: &str) -> PostActionOutcome {
    PostActionOutcome { status: "skipped", ..failure(action, message) }
}

fn failure_for(
    action: &PostResponseAction,
    environment: &yaak_models::models::Environment,
    message: &str,
) -> PostActionOutcome {
    PostActionOutcome {
        environment_id: environment.id.clone(),
        environment_name: environment.name.clone(),
        ..failure(action, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use yaak_models::init_in_memory;
    use yaak_models::models::{Environment, Workspace};

    fn action(path: &str) -> PostResponseAction {
        PostResponseAction {
            enabled: true,
            action_type: SET_ENVIRONMENT_VARIABLE.to_string(),
            json_path: path.to_string(),
            variable_name: "TOKEN".to_string(),
            ..Default::default()
        }
    }

    fn setup() -> (QueryManager, HttpRequest, Environment) {
        let (query_manager, _blob_manager, _rx) =
            init_in_memory().expect("Failed to initialize test database");
        let workspace = query_manager
            .connect()
            .upsert_workspace(
                &Workspace { name: "Test".to_string(), ..Default::default() },
                &UpdateSource::Background,
            )
            .expect("Failed to create workspace");
        let environment = query_manager
            .connect()
            .upsert_environment(
                &Environment {
                    workspace_id: workspace.id.clone(),
                    name: "Private".to_string(),
                    parent_model: "environment".to_string(),
                    ..Default::default()
                },
                &UpdateSource::Background,
            )
            .expect("Failed to create environment");
        let request = HttpRequest { workspace_id: workspace.id, ..Default::default() };
        (query_manager, request, environment)
    }

    #[test]
    fn extracts_first_jsonpath_match() {
        let json = json!({ "items": [{ "id": 1 }, { "id": 2 }] });
        assert_eq!(extract_value(&action("$.items[*].id"), &json), Ok("1".to_string()));
    }

    #[test]
    fn serializes_object_values() {
        let json = json!({ "value": { "ok": true } });
        assert_eq!(extract_value(&action("$.value"), &json), Ok(r#"{"ok":true}"#.to_string()));
    }

    #[test]
    fn reports_invalid_and_missing_paths() {
        let json = json!({ "value": 1 });
        assert!(extract_value(&action("$["), &json).unwrap_err().contains("Invalid JSONPath"));
        assert_eq!(
            extract_value(&action("$.missing"), &json),
            Err("JSONPath did not match any values".to_string())
        );
    }

    #[test]
    fn updates_active_environment_in_rule_order() {
        let (query_manager, mut request, environment) = setup();
        let mut first = action("$.first");
        first.variable_name = "TOKEN".to_string();
        let mut second = action("$.second");
        second.variable_name = "TOKEN".to_string();
        request.post_response_actions = vec![first, second];

        let outcomes = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            200,
            PostActionBody::Json(br#"{"first":"old","second":"new"}"#),
            None,
            &UpdateSource::Background,
        );

        assert_eq!(outcomes.iter().map(|o| o.status).collect::<Vec<_>>(), vec!["success", "success"]);
        let saved = query_manager.connect().get_environment(&environment.id).unwrap();
        assert_eq!(saved.variables.len(), 1);
        assert_eq!(saved.variables[0].name, "TOKEN");
        assert_eq!(saved.variables[0].value, "new");
        assert!(saved.variables[0].enabled);
    }

    #[test]
    fn uses_workspace_environment_when_none_is_selected() {
        let (query_manager, mut request, _environment) = setup();
        request.post_response_actions = vec![action("$.token")];

        let outcomes = execute_post_response_actions(
            &query_manager,
            &request,
            None,
            200,
            PostActionBody::Json(br#"{"token":"global"}"#),
            None,
            &UpdateSource::Background,
        );

        let base = query_manager.connect().get_base_environment(&request.workspace_id).unwrap();
        assert_eq!(outcomes[0].environment_id, base.id);
        assert_eq!(base.variables[0].value, "global");
    }

    #[test]
    fn failed_extraction_preserves_existing_value_and_continues() {
        let (query_manager, mut request, mut environment) = setup();
        environment.variables.push(EnvironmentVariable {
            enabled: false,
            name: "TOKEN".to_string(),
            value: "keep".to_string(),
            id: None,
        });
        let environment = query_manager
            .connect()
            .upsert_environment(&environment, &UpdateSource::Background)
            .unwrap();
        let missing = action("$.missing");
        let mut valid = action("$.next");
        valid.variable_name = "NEXT".to_string();
        request.post_response_actions = vec![missing, valid];

        let outcomes = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            200,
            PostActionBody::Json(br#"{"next":true}"#),
            None,
            &UpdateSource::Background,
        );

        assert_eq!(outcomes[0].status, "error");
        assert_eq!(outcomes[1].status, "success");
        let saved = query_manager.connect().get_environment(&environment.id).unwrap();
        assert_eq!(saved.variables.iter().find(|v| v.name == "TOKEN").unwrap().value, "keep");
        assert_eq!(saved.variables.iter().find(|v| v.name == "NEXT").unwrap().value, "true");
    }

    #[test]
    fn warns_when_writing_to_public_environment() {
        let (query_manager, mut request, mut environment) = setup();
        environment.public = true;
        let environment = query_manager
            .connect()
            .upsert_environment(&environment, &UpdateSource::Background)
            .unwrap();
        request.post_response_actions = vec![action("$.token")];

        let outcomes = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            200,
            PostActionBody::Json(br#"{"token":"secret-value"}"#),
            None,
            &UpdateSource::Background,
        );

        assert_eq!(outcomes[0].status, "warning");
        assert!(!outcomes[0].message.contains("secret-value"));
    }

    #[test]
    fn secure_action_without_encryption_manager_fails_without_writing() {
        let (query_manager, mut request, environment) = setup();
        let mut secure_action = action("$.token");
        secure_action.secure = true;
        request.post_response_actions = vec![secure_action];

        let outcomes = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            200,
            PostActionBody::Json(br#"{"token":"plain"}"#),
            None,
            &UpdateSource::Background,
        );

        assert_eq!(outcomes[0].status, "error");
        assert!(outcomes[0].message.contains("Encryption is not available"));
        let saved = query_manager.connect().get_environment(&environment.id).unwrap();
        assert!(saved.variables.is_empty());
    }

    #[test]
    fn non_2xx_response_skips_all_actions() {
        let (query_manager, mut request, environment) = setup();
        request.post_response_actions = vec![action("$.token")];

        let outcomes = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            401,
            PostActionBody::Json(br#"{"token":"from-an-error-response"}"#),
            None,
            &UpdateSource::Background,
        );

        assert_eq!(outcomes[0].status, "skipped");
        assert!(outcomes[0].message.contains("401"));
        let saved = query_manager.connect().get_environment(&environment.id).unwrap();
        assert!(saved.variables.is_empty());
    }

    #[test]
    fn event_stream_and_oversized_bodies_report_errors() {
        let (query_manager, mut request, environment) = setup();
        request.post_response_actions = vec![action("$.token")];

        let sse = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            200,
            PostActionBody::EventStream,
            None,
            &UpdateSource::Background,
        );
        assert_eq!(sse[0].status, "error");
        assert!(sse[0].message.contains("SSE"));

        let too_large = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            200,
            PostActionBody::TooLarge { limit: MAX_POST_ACTION_BODY_BYTES },
            None,
            &UpdateSource::Background,
        );
        assert_eq!(too_large[0].status, "error");
        assert!(too_large[0].message.contains("20 MB"));

        let unreadable = execute_post_response_actions(
            &query_manager,
            &request,
            Some(&environment.id),
            200,
            PostActionBody::Unreadable("disk gone".to_string()),
            None,
            &UpdateSource::Background,
        );
        assert_eq!(unreadable[0].status, "error");
        assert!(unreadable[0].message.contains("disk gone"));
    }

    #[test]
    fn invalid_selected_environment_does_not_fall_back_to_workspace_environment() {
        let (query_manager, mut request, _environment) = setup();
        request.post_response_actions = vec![action("$.token")];

        let outcomes = execute_post_response_actions(
            &query_manager,
            &request,
            Some("ev_missing"),
            200,
            PostActionBody::Json(br#"{"token":"must-not-be-written"}"#),
            None,
            &UpdateSource::Background,
        );

        assert_eq!(outcomes[0].status, "error");
        let base = query_manager.connect().get_base_environment(&request.workspace_id).unwrap();
        assert!(base.variables.is_empty());
    }
}

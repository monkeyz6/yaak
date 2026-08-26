use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error(transparent)]
    Send(#[from] crate::send::SendHttpRequestError),

    #[error(transparent)]
    Model(#[from] yaak_models::error::Error),

    #[error(transparent)]
    Plugin(#[from] yaak_plugins::error::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid export format '{0}'. Use postman or openapi")]
    InvalidExportFormat(String),
}

pub type Result<T> = std::result::Result<T, Error>;

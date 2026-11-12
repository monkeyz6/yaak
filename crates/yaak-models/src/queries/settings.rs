use crate::client_db::{ClientDb, WriteDb};
use crate::error::Result;
use crate::models::{Settings, SettingsIden};
use crate::util::UpdateSource;

impl<'a> ClientDb<'a> {
    /// The settings row, or the defaults if it has not been written yet.
    /// [`WriteDb::ensure_settings`] persists it at startup.
    pub fn get_settings(&self) -> Settings {
        self.find_optional::<Settings>(SettingsIden::Id, "default").unwrap_or_else(default_settings)
    }
}

impl<'a> WriteDb<'a> {
    /// Create the settings row if it does not exist.
    pub fn ensure_settings(&self) -> Result<Settings> {
        if let Some(s) = self.find_optional::<Settings>(SettingsIden::Id, "default") {
            return Ok(s);
        }
        self.upsert(&default_settings(), &UpdateSource::Background)
    }

    pub fn upsert_settings(&self, settings: &Settings, source: &UpdateSource) -> Result<Settings> {
        self.upsert(settings, source)
    }
}

fn default_settings() -> Settings {
    Settings::default()
}

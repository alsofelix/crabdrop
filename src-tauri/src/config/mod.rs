use dirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default)]
pub struct Config {
    pub storage: StorageConfig,
    pub credentials: CredentialsConfig,
}

#[derive(Serialize, Deserialize, Default)]
pub struct StorageConfig {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
}

#[derive(Serialize, Deserialize, Default)]
pub struct CredentialsConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl Config {
    pub fn load() -> anyhow::Result<Config> {
        let config_path = ensure_config_existance()?;
        let content = std::fs::read_to_string(config_path)?;
        let config: Config = toml::from_str(&content)?;

        Ok(config)
    }

    pub fn to_toml(&self) -> anyhow::Result<String> {
        Ok(toml::to_string_pretty(self)?)
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let content = self.to_toml()?;
        let config_path = get_config_path();

        std::fs::write(config_path, content)?;

        Ok(())
    }

    pub fn is_valid(&self) -> bool {
        !self.storage.bucket.is_empty()
            && !self.storage.region.is_empty()
            && !self.credentials.access_key_id.is_empty()
            && !self.credentials.secret_access_key.is_empty()
    }
}

fn get_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap()
        .join("crabdrop")
        .join("config.toml")
}

fn ensure_config_existance() -> anyhow::Result<PathBuf> {
    let config_path = get_config_path();

    if !config_path.exists() {
        std::fs::create_dir_all(config_path.parent().unwrap())?;

        let default_config = Config::default();
        let toml = toml::to_string_pretty(&default_config)?;
        std::fs::write(&config_path, toml)?;
    }

    Ok(config_path)
}

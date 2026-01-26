use dirs;
use serde::{Deserialize, Serialize};
use std::fs;
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
pub fn load_config() -> anyhow::Result<Config> {
    let config_path = ensure_config_existance()?;

    let content = fs::read_to_string(config_path)?;

    let config: Config = toml::from_str(&content)?;

    Ok(config)
}

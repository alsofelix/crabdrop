use dirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "crabdrop";
const KEYRING_ACCOUNT: &str = "default";

#[derive(Serialize, Deserialize, Default)]
pub struct Config {
    pub storage: StorageConfig,

    #[serde(default, skip_serializing)]
    pub credentials: CredentialsConfig,
}

#[derive(Serialize, Deserialize, Default)]
pub struct StorageConfig {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
}

#[derive(Deserialize, Default, Clone)]
pub struct CredentialsConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl CredentialsConfig {
    pub fn is_empty(&self) -> bool {
        self.access_key_id.trim().is_empty() && self.secret_access_key.trim().is_empty()
    }

    pub fn clear(&mut self) {
        self.access_key_id.clear();
        self.secret_access_key.clear();
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Config> {
        let config_path = ensure_config_existance()?;
        let content = std::fs::read_to_string(config_path)?;
        let mut config: Config = if content.trim().is_empty() {
            Config::default()
        } else {
            toml::from_str(&content)?
        };

        if !config.credentials.is_empty() {
            config.credentials.clear();
            config.save()?;
        }

        config.credentials = load_credentials_from_keyring()?;

        Ok(config)
    }

    pub fn to_toml(&self) -> anyhow::Result<String> {
        Ok(toml::to_string_pretty(self)?)
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let content = self.to_toml()?;
        let config_path = get_config_path();

        std::fs::write(config_path, content)?;

        if !self.credentials.is_empty() {
            save_credential_to_keyring(&self.credentials)?;
        }

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

fn load_credentials_from_keyring() -> anyhow::Result<CredentialsConfig> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;

    let s = match entry.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(CredentialsConfig::default()),
        Err(e) => return Err(e.into()),
    };
    let stored: CredentialsConfig = serde_json::from_str(&s)?;

    Ok(stored)
}

fn save_credential_to_keyring(credentials_config: &CredentialsConfig) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;

    let payload = serde_json::json!({
        "access_key_id": credentials_config.access_key_id,
        "secret_access_key": credentials_config.secret_access_key,
    })
    .to_string();

    entry.set_password(&payload)?;

    Ok(())
}

use crate::config::Config;
use crate::types::File;
use aws_sdk_s3;
use aws_sdk_s3::config::{Builder, Credentials, Region};
use aws_sdk_s3::Client;
use tauri::utils::config::PatternKind::Brownfield;

struct S3Client {
    client: Client,
    bucket_name: String,
}

impl S3Client {
    pub fn new(config: &Config) -> anyhow::Result<Self> {
        let creds = get_credentials(config)?;
        let client = Client::from_conf(creds);

        Ok(Self {
            client,
            bucket_name: config.storage.bucket.clone(),
        })
    }

    pub async fn list_dir(&self, prefix: &str) -> anyhow::Result<Vec<File>> {
        let mut vector: Vec<File> = Vec::new();

        let objs = self
            .client
            .list_objects_v2()
            .bucket(&self.bucket_name)
            .prefix(prefix)
            .delimiter("/")
            .send()
            .await?;

        for file in objs.contents() {
            let key = file
                .key()
                .ok_or(anyhow::anyhow!("Expected a key"))?
                .to_string();
            let f = File {
                name: key.split("/").last().unwrap_or(&key).to_string(),
                key,
                size: file.size(),
                is_folder: false,
                last_modified: file.last_modified().map(|d| d.secs()),
            };
            vector.push(f)
        }

        for folder in objs.common_prefixes() {
            let key = folder
                .prefix()
                .ok_or(anyhow::anyhow!("Expected a key"))?
                .to_string();

            let f = File {
                name: key
                    .trim_end_matches("/")
                    .split("/")
                    .last()
                    .unwrap_or(&key)
                    .to_string(),
                key,
                size: None,
                is_folder: true,
                last_modified: None,
            };

            vector.push(f);
        }

        Ok(vector)
    }
}

fn get_credentials(config: &Config) -> anyhow::Result<aws_sdk_s3::config::Config> {
    let credentials = Credentials::new(
        &config.credentials.access_key_id,
        &config.credentials.secret_access_key,
        None,
        None,
        "crabdrop",
    );

    let config = Builder::new()
        .region(Region::new(config.storage.region.clone()))
        .credentials_provider(credentials)
        .build();

    Ok(config)
}

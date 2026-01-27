use aws_sdk_s3;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::{Credentials, Builder, Region};
use crate::config::{Config};

struct S3Client {
    client: Client,
    bucket_name: String,
}

impl S3Client {
    pub fn new(config: &Config) -> anyhow::Result<Self> {
        let creds = get_credentials(config)?;
        let client = Client::from_conf(creds);

        Ok(
            Self {
                client,
                bucket_name: config.storage.bucket.clone()
            }
        )
    }
}

fn get_credentials(config: &Config) -> anyhow::Result<aws_sdk_s3::config::Config> {
    let credentials = Credentials::new(
        &config.credentials.access_key_id,
        &config.credentials.secret_access_key,
        None,
        None,
        "crabdrop"
    );

    let config = Builder::new()
        .region(Region::new(config.storage.region.clone()))
        .credentials_provider(credentials)
        .build();

    Ok(config)

}
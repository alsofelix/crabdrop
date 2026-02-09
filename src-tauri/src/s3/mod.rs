use crate::config::Config;
use crate::crypto::{decrypt, encrypt};
use crate::metadata;
use crate::types::File;
use anyhow::anyhow;
use aws_sdk_s3;
use aws_sdk_s3::config::{Builder, Credentials, Region};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use aws_sdk_s3::Client;
use std::io::{Read, Seek};
use std::path::Path;
use std::time::Duration;
use tauri::Emitter;

const THRESHOLD: u64 = 100 * 1024 * 1024;
const CHUNK_SIZE: u64 = 50 * 1024 * 1024;

const CRABDROP_METADATA_FILE_NAME: &str = "CRABDROP_METADATA_DO_NOT_DELETE";

#[derive(Clone)]
pub struct S3Client {
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
        let mut continuation_token: Option<String> = None;

        let config = Config::load()?;
        let metadata = self
            .get_metadata(config.credentials.encryption_passphrase.as_bytes())
            .await?;

        loop {
            let mut request = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket_name)
                .prefix(prefix)
                .delimiter("/");

            if let Some(token) = continuation_token.take() {
                request = request.continuation_token(token);
            }

            let objs = request.send().await?;

            for file in objs.contents() {
                let key = file
                    .key()
                    .ok_or(anyhow::anyhow!("Expected a key"))?
                    .to_string();

                let raw_name = key.split("/").last().unwrap_or(&key).to_string();
                let encrypted = metadata::is_in_meta(&metadata, &raw_name)?;
                let name = if encrypted {
                    metadata::get_filename(&metadata, &raw_name)?
                } else {
                    raw_name
                };

                let f = File {
                    name,
                    key,
                    size: file.size(),
                    is_folder: false,
                    last_modified: file.last_modified().map(|d| d.secs()),
                    encrypted,
                };
                vector.push(f)
            }

            for folder in objs.common_prefixes() {
                let key = folder
                    .prefix()
                    .ok_or(anyhow::anyhow!("Expected a key"))?
                    .to_string();

                let encrypted_step = key
                    .split("/")
                    .last()
                    .ok_or(anyhow::anyhow!("Error on parsing"))?
                    .to_string();

                let encrypted = metadata::is_in_meta(&metadata, &encrypted_step)?;

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
                    encrypted,
                };

                vector.push(f);
            }

            if objs.is_truncated() == Some(true) {
                continuation_token = objs.next_continuation_token().map(|s| s.to_string());
            } else {
                break;
            }
        }

        vector.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        Ok(vector)
    }

    pub async fn det_upload(
        &self,
        key: &str,
        path: &Path,
        app: &tauri::AppHandle,
        emit_event: bool,
        upload_id: &str,
        encrypted: bool,
        password: Option<&[u8]>,
    ) -> anyhow::Result<()> {
        let size = std::fs::metadata(path)?.len();

        if size < THRESHOLD {
            let data = std::fs::read(path)?;
            if emit_event {
                app.emit(
                    "upload_start",
                    serde_json::json!({
                        "uploadId": upload_id,
                        "filename": path.file_name().ok_or_else(|| anyhow::anyhow!("Invalid path"))?.to_string_lossy(),
                        "multipart": false,
                        "isFolder": false,
                    }),
                )
                    .ok();
            }
            self.upload_file(key, data, encrypted, password).await?;
            if emit_event {
                app.emit(
                    "upload_complete",
                    serde_json::json!({"uploadId": upload_id}),
                )
                .ok();
            }
        } else {
            self.upload_file_multipart(key, path, app, emit_event, &upload_id)
                .await?;
        }

        Ok(())
    }

    pub async fn upload_file(
        &self,
        key: &str,
        mut data: Vec<u8>,
        encrypted: bool,
        password: Option<&[u8]>,
    ) -> anyhow::Result<()> {
        let mut uuid = String::new();
        let name = key.rsplit_once("/");
        if encrypted {
            uuid = encrypt(
                &mut data,
                password.ok_or(anyhow!("No password"))?,
                key.as_bytes(),
            )?;

            self.insert_meta(
                password.ok_or(anyhow!("No password"))?,
                &uuid,
                key.split("/")
                    .last()
                    .ok_or(anyhow!("Filename error massive"))?,
            )
            .await?;
        }
        let bytestream = ByteStream::from(data);

        self.client
            .put_object()
            .bucket(&self.bucket_name)
            .key(if encrypted {
                if key.contains("/") {
                    format!(
                        "{}/{}",
                        key.rsplit_once("/")
                            .ok_or(anyhow::anyhow!("Problem assigning UUID"))?
                            .0,
                        uuid
                    )
                } else {
                    uuid
                }
            } else {
                key.to_owned()
            })
            .body(bytestream)
            .send()
            .await?;

        Ok(())
    }

    pub async fn get_metadata(&self, password: &[u8]) -> anyhow::Result<Vec<u8>> {
        match self.get_file(CRABDROP_METADATA_FILE_NAME).await {
            Some(mut metadata) => {
                decrypt(
                    &mut metadata,
                    password,
                    CRABDROP_METADATA_FILE_NAME.as_bytes(),
                )?;

                Ok(metadata)
            }
            None => self.create_metadata(password, None).await,
        }
    }

    pub async fn create_metadata(
        &self,
        password: &[u8],
        data: Option<&[u8]>,
    ) -> anyhow::Result<Vec<u8>> {
        // this is a bit of a not great way to do this, its 3am
        let mut dummy_data = serde_json::to_vec(&serde_json::json!({}))?;
        let mut dummy_encrypted = dummy_data.clone();

        if data.is_some() {
            dummy_data = data.unwrap().to_vec();
            dummy_encrypted = dummy_data.clone();
        }

        let _ = encrypt(
            &mut dummy_encrypted,
            password,
            CRABDROP_METADATA_FILE_NAME.as_bytes(),
        )?;

        let bytestream = ByteStream::from(dummy_encrypted);

        self.client
            .put_object()
            .bucket(&self.bucket_name)
            .key(CRABDROP_METADATA_FILE_NAME)
            .body(bytestream)
            .send()
            .await?;

        Ok(dummy_data)
    }

    async fn insert_meta(&self, password: &[u8], uuid: &str, filename: &str) -> anyhow::Result<()> {
        let metadata = self.get_metadata(password).await?;

        let new_data = metadata::put_filename(&metadata, &uuid, filename)?;

        self.create_metadata(password, Some(&new_data)).await?;
        Ok(())
    }

    async fn get_file(&self, key: &str) -> Option<Vec<u8>> {
        let file = self
            .client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await
            .ok()?;

        let res = file.body.collect().await.ok()?.into_bytes();

        Some(res.to_vec())
    }

    pub async fn delete_file(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?;
        Ok(())
    }

    pub async fn delete_prefix(&self, prefix: &str) -> anyhow::Result<()> {
        let mut continuation_token: Option<String> = None;

        loop {
            let mut request = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket_name)
                .prefix(prefix);

            if let Some(token) = continuation_token.take() {
                request = request.continuation_token(token);
            }

            let response = request.send().await?;

            let keys: Vec<String> = response
                .contents()
                .iter()
                .filter_map(|obj| obj.key().map(|k| k.to_string()))
                .collect();

            for chunk in keys.chunks(1000) {
                let delete_objects: Vec<_> = chunk
                    .iter()
                    .map(|key| {
                        aws_sdk_s3::types::ObjectIdentifier::builder()
                            .key(key)
                            .build()
                    })
                    .collect::<Result<Vec<_>, _>>()?;

                if !delete_objects.is_empty() {
                    self.client
                        .delete_objects()
                        .bucket(&self.bucket_name)
                        .delete(
                            aws_sdk_s3::types::Delete::builder()
                                .set_objects(Some(delete_objects))
                                .build()?,
                        )
                        .send()
                        .await?;
                }
            }

            if response.is_truncated() == Some(true) {
                continuation_token = response.next_continuation_token().map(|s| s.to_string());
            } else {
                break;
            }
        }

        Ok(())
    }

    pub async fn upload_folder(&self, key: &str) -> anyhow::Result<()> {
        let folder_name = if !key.ends_with("/") {
            format!("{}/", key)
        } else {
            key.to_string()
        };

        self.upload_file(&folder_name, vec![], false, None).await
    }

    pub async fn download_file(&self, key: &str) -> anyhow::Result<ByteStream> {
        let file = self
            .client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?;

        Ok(file.body)
    }

    pub async fn upload_file_multipart(
        &self,
        key: &str,
        path: &Path,
        app: &tauri::AppHandle,
        emit_events: bool,
        upload_id_: &str,
    ) -> anyhow::Result<()> {
        let con = self
            .client
            .create_multipart_upload()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?;

        let upload_id = con
            .upload_id()
            .ok_or(anyhow::anyhow!("No upload ID returned"))?;

        let mut file = std::fs::File::open(path)?;
        let file_size = file.metadata()?.len();
        let mut offset: u64 = 0;

        if emit_events {
            app.emit(
                "upload_start",
                serde_json::json!({
                    "uploadId": upload_id_,
                    "filename": path.file_name().ok_or_else(|| anyhow::anyhow!("Invalid path"))?.to_string_lossy(),
                    "multipart": true,
                    "totalParts": (file_size as f64 / CHUNK_SIZE as f64).ceil() as u64,
                    "isFolder": false,
                }),
            )
                .ok();
        }

        let mut completed_parts: Vec<CompletedPart> = vec![];

        while offset < file_size {
            let remaining = file_size - offset;

            let this_chunk_size = std::cmp::min(CHUNK_SIZE, remaining);

            let mut buffer = vec![0u8; this_chunk_size as usize];
            file.seek(std::io::SeekFrom::Start(offset))?;

            file.read_exact(&mut buffer)?;

            let part = self
                .client
                .upload_part()
                .bucket(&self.bucket_name)
                .key(key)
                .upload_id(upload_id)
                .part_number((completed_parts.len() + 1) as i32)
                .body(ByteStream::from(buffer))
                .send()
                .await?;

            offset += this_chunk_size;

            let completed_part = CompletedPart::builder()
                .part_number((completed_parts.len() + 1) as i32)
                .e_tag(
                    part.e_tag()
                        .ok_or_else(|| anyhow::anyhow!("Missing ETag"))?,
                )
                .build();

            completed_parts.push(completed_part);

            if emit_events {
                app.emit(
                    "upload_progress",
                    serde_json::json!({
                        "uploadId": upload_id_,
                        "filename": path.file_name().ok_or_else(|| anyhow::anyhow!("Invalid path"))?.to_string_lossy(),
                        "part": completed_parts.len(),
                        "totalParts": (file_size as f64 / CHUNK_SIZE as f64).ceil() as u64,
                    }),
                )
                    .ok();
            }
        }

        self.client
            .complete_multipart_upload()
            .bucket(&self.bucket_name)
            .key(key)
            .upload_id(upload_id)
            .multipart_upload(
                CompletedMultipartUpload::builder()
                    .set_parts(Some(completed_parts))
                    .build(),
            )
            .send()
            .await?;

        if emit_events {
            app.emit(
                "upload_complete",
                serde_json::json!({"uploadId": upload_id_}),
            )
            .ok();
        }
        Ok(())
    }

    pub async fn gen_presigned_url(&self, key: &str, expiry_secs: u64) -> anyhow::Result<String> {
        let config = PresigningConfig::expires_in(Duration::from_secs(expiry_secs))?;

        let url = self
            .client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .presigned(config)
            .await?;

        Ok(url.uri().to_string())
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

    let mut configuration = Builder::new()
        .region(Region::new(config.storage.region.clone()))
        .credentials_provider(credentials)
        .behavior_version_latest();

    if !config.storage.endpoint.trim().is_empty() {
        configuration = configuration
            .endpoint_url(&config.storage.endpoint)
            .force_path_style(true);
    }

    Ok(configuration.build())
}

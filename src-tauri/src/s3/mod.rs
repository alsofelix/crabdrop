use crate::config::Config;
use crate::types::File;
use aws_sdk_s3;
use aws_sdk_s3::config::{Builder, Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use aws_sdk_s3::Client;
use std::io::{Read, Seek};
use std::path::Path;
use tauri::Emitter;

const THRESHOLD: u64 = 100 * 1024 * 1024;
const CHUNK_SIZE: u64 = 50 * 1024 * 1024;

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

    pub async fn det_upload(
        &self,
        key: &str,
        path: &Path,
        app: &tauri::AppHandle,
        emit_event: bool,
    ) -> anyhow::Result<()> {
        let size = std::fs::metadata(path)?.len();

        if size < THRESHOLD {
            let data = std::fs::read(path)?;
            if emit_event {
                app.emit(
                    "upload_start",
                    serde_json::json!({
                        "filename": path.file_name().unwrap().to_string_lossy(),
                        "multipart": false,
                        "isFolder": false,
                    }),
                )
                .ok();
            }
            self.upload_file(key, data).await?;
            if emit_event {
                app.emit("upload_complete", serde_json::json!({})).ok();
            }
        } else {
            self.upload_file_multipart(key, path, app, emit_event)
                .await?;
        }

        Ok(())
    }

    pub async fn upload_file(&self, key: &str, data: Vec<u8>) -> anyhow::Result<()> {
        let bytestream = ByteStream::from(data);

        self.client
            .put_object()
            .bucket(&self.bucket_name)
            .key(key)
            .body(bytestream)
            .send()
            .await?;

        Ok(())
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

    pub async fn upload_folder(&self, key: &str) -> anyhow::Result<()> {
        let folder_name = if !key.ends_with("/") {
            format!("{}/", key)
        } else {
            key.to_string()
        };

        self.upload_file(&folder_name, vec![]).await
    }

    pub async fn download_file(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        let file = self
            .client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?;

        let bytes = file.body.collect().await?;

        Ok(bytes.to_vec())
    }

    pub async fn upload_file_multipart(
        &self,
        key: &str,
        path: &Path,
        app: &tauri::AppHandle,
        emit_events: bool,
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
                    "filename": path.file_name().unwrap().to_string_lossy(),
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
                .e_tag(part.e_tag().unwrap().to_string())
                .build();

            completed_parts.push(completed_part);

            if emit_events {
                app.emit(
                    "upload_progress",
                    serde_json::json!({
                        "filename": path.file_name().unwrap().to_string_lossy(),
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
            app.emit("upload_complete", serde_json::json!({})).ok();
        }
        Ok(())
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
        .behavior_version_latest()
        .build();

    Ok(config)
}

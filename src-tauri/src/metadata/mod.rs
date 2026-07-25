use crate::crypto::decrypt;
use anyhow::anyhow;
use std::collections::HashMap;

pub const CRABDROP_METADATA_FILE_NAME: &str = "CRABDROP_METADATA_DO_NOT_DELETE";
pub const ENCRYPTION_PASSPHRASE_MISMATCH_ERROR: &str =
    "Encryption passphrase does not match this bucket's encryption metadata. Restore the correct passphrase in Settings before uploading encrypted files.";

pub fn validate_encryption_passphrase(
    encrypted_metadata: Option<&[u8]>,
    password: &[u8],
) -> anyhow::Result<()> {
    let Some(encrypted_metadata) = encrypted_metadata else {
        return Ok(());
    };

    let mut metadata = encrypted_metadata.to_vec();
    decrypt(
        &mut metadata,
        password,
        CRABDROP_METADATA_FILE_NAME.as_bytes(),
    )
    .map_err(|_| anyhow!(ENCRYPTION_PASSPHRASE_MISMATCH_ERROR))
}

pub fn get_filename(data: &[u8], file_uuid: &str) -> anyhow::Result<String> {
    let map: HashMap<String, String> = serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    map.get(file_uuid)
        .cloned()
        .ok_or_else(|| anyhow!("Missing in metadata"))
}

pub fn put_filename(data: &[u8], uuid: &str, filename: &str) -> anyhow::Result<Vec<u8>> {
    let mut map: HashMap<String, String> =
        serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    map.entry(uuid.to_string())
        .or_insert_with(|| filename.to_string());

    Ok(serde_json::to_string(&map)?.into_bytes())
}

pub fn is_in_meta(data: &[u8], uuid: &str) -> anyhow::Result<bool> {
    let map: HashMap<String, String> = serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;
    Ok(map.contains_key(uuid))
}

#[cfg(test)]
mod tests {
    use super::{
        validate_encryption_passphrase, CRABDROP_METADATA_FILE_NAME,
        ENCRYPTION_PASSPHRASE_MISMATCH_ERROR,
    };
    use crate::crypto::encrypt;

    #[test]
    fn existing_metadata_rejects_a_different_encryption_passphrase() {
        let mut encrypted_metadata = serde_json::to_vec(&serde_json::json!({})).unwrap();
        encrypt(
            &mut encrypted_metadata,
            b"bucket-passphrase",
            CRABDROP_METADATA_FILE_NAME.as_bytes(),
        )
        .unwrap();

        let error =
            validate_encryption_passphrase(Some(&encrypted_metadata), b"different-passphrase")
                .unwrap_err();

        assert_eq!(error.to_string(), ENCRYPTION_PASSPHRASE_MISMATCH_ERROR);
    }

    #[test]
    fn existing_metadata_accepts_its_matching_encryption_passphrase() {
        let mut encrypted_metadata = serde_json::to_vec(&serde_json::json!({})).unwrap();
        encrypt(
            &mut encrypted_metadata,
            b"bucket-passphrase",
            CRABDROP_METADATA_FILE_NAME.as_bytes(),
        )
        .unwrap();

        validate_encryption_passphrase(Some(&encrypted_metadata), b"bucket-passphrase").unwrap();
    }

    #[test]
    fn a_bucket_without_metadata_accepts_the_first_encryption_passphrase() {
        validate_encryption_passphrase(None, b"first-passphrase").unwrap();
    }
}

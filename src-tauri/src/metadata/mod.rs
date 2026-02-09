use anyhow::anyhow;
use std::collections::HashMap;

pub fn get_filename(data: &[u8], file_uuid: &str) -> anyhow::Result<String> {
    let map: HashMap<String, String> = serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    if map.contains_key(file_uuid) {
        Ok(map.get(file_uuid).unwrap().to_string())
    } else {
        Err(anyhow!("Missing in metadata"))
    }
}



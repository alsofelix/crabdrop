use anyhow::anyhow;
use bimap::BiMap;

pub fn get_filename(data: &[u8], file_uuid: &str) -> anyhow::Result<String> {
    let map: BiMap<String, String> = serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    if map.contains_left(file_uuid) {
        Ok(map.get_by_left(file_uuid).unwrap().to_string())
    } else {
        Err(anyhow!("Missing in metadata"))
    }
}

pub fn get_uuid(data: &[u8], file_name: &str) -> anyhow::Result<Option<String>> {
    let map: BiMap<String, String> = serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    if map.contains_right(file_name) {
        return Ok(Some(map.get_by_right(file_name).unwrap().to_string()));
    }
    
    Ok(None)
}

pub fn put_filename(data: &[u8], uuid: &str, filename: &str) -> anyhow::Result<Vec<u8>> {
    let mut map: BiMap<String, String> =
        serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    if !map.contains_left(uuid) {
        map.insert(uuid.to_string(), filename.to_string());
    };

    Ok(serde_json::to_string(&map)?.into_bytes())
}

pub fn is_in_meta(data: &[u8], uuid: &str) -> anyhow::Result<bool> {
    let map: BiMap<String, String> =
        serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;
    Ok(map.contains_left(uuid))
}

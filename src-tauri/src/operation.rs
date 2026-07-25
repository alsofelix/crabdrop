use aws_sdk_s3::error::{ProvideErrorMetadata, SdkError};
use std::future::Future;
use std::time::Duration;

pub const QUICK_OPERATION_TIMEOUT: Duration = Duration::from_secs(15);

pub async fn run_quick_operation<T, F>(name: &str, operation: F) -> Result<T, String>
where
    F: Future<Output = anyhow::Result<T>>,
{
    run_with_timeout(name, QUICK_OPERATION_TIMEOUT, operation).await
}

async fn run_with_timeout<T, F>(
    name: &str,
    duration: Duration,
    operation: F,
) -> Result<T, String>
where
    F: Future<Output = anyhow::Result<T>>,
{
    match tokio::time::timeout(duration, operation).await {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(_) => Err(format!(
            "{name} timed out after {}.",
            format_duration(duration)
        )),
    }
}

fn format_duration(duration: Duration) -> String {
    if duration.subsec_nanos() == 0 && duration.as_secs() > 0 {
        let seconds = duration.as_secs();
        let unit = if seconds == 1 { "second" } else { "seconds" };
        format!("{seconds} {unit}")
    } else {
        let milliseconds = duration.as_millis();
        let unit = if milliseconds == 1 {
            "millisecond"
        } else {
            "milliseconds"
        };
        format!("{milliseconds} {unit}")
    }
}

pub fn friendly_service_error(
    action: &str,
    code: Option<&str>,
    message: Option<&str>,
) -> String {
    let action = action.to_lowercase();
    match code {
        Some("NoSuchBucket") => format!(
            "Bucket not found while {action}. Check the bucket name (including capitalization), endpoint, and region."
        ),
        Some("InvalidAccessKeyId") => "The access key ID is invalid.".to_string(),
        Some("SignatureDoesNotMatch") => {
            "The secret access key is incorrect, or the endpoint and region do not match.".to_string()
        }
        Some("AccessDenied") => format!(
            "Access denied while {action}. Check this key's permissions for the bucket."
        ),
        Some(code) => format!(
            "Storage service error while {action} ({code}): {}",
            message.unwrap_or("No additional details were provided.")
        ),
        None => format!(
            "Storage service error while {action}: {}",
            message.unwrap_or("No additional details were provided.")
        ),
    }
}

pub fn friendly_sdk_error<E, R>(action: &str, error: &SdkError<E, R>) -> String
where
    E: ProvideErrorMetadata,
{
    let action = action.to_lowercase();
    match error {
        SdkError::TimeoutError(_) => {
            format!("The storage request timed out while {action}. Try again.")
        }
        SdkError::DispatchFailure(error) if error.is_timeout() => {
            format!("The storage request timed out while {action}. Try again.")
        }
        SdkError::DispatchFailure(_) => format!(
            "Could not reach the storage endpoint while {action}. Check the endpoint URL, network connection, DNS, and TLS settings."
        ),
        SdkError::ServiceError(_) => {
            friendly_service_error(&action, error.code(), error.message())
        }
        SdkError::ConstructionFailure(_) => format!(
            "Could not build the storage request while {action}. Check the endpoint URL and configuration."
        ),
        SdkError::ResponseError(_) => format!(
            "The storage endpoint returned an unreadable response while {action}. Check that the endpoint is S3-compatible."
        ),
        _ => format!("The storage request failed while {action}."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_sdk_s3::error::{ConnectorError, ErrorMetadata};
    use std::io;
    use std::time::Duration;

    #[tokio::test]
    async fn quick_operations_return_a_specific_timeout_error() {
        let result = run_with_timeout(
            "Connection check",
            Duration::from_millis(1),
            async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok::<_, anyhow::Error>(())
            },
        )
        .await;

        assert_eq!(
            result.unwrap_err(),
            "Connection check timed out after 1 millisecond."
        );
    }

    #[test]
    fn missing_buckets_get_an_actionable_error() {
        assert_eq!(
            friendly_service_error(
                "Connecting",
                Some("NoSuchBucket"),
                Some("The specified bucket does not exist.")
            ),
            "Bucket not found while connecting. Check the bucket name (including capitalization), endpoint, and region."
        );
    }

    #[test]
    fn authentication_and_permission_errors_name_the_failed_setting() {
        assert_eq!(
            friendly_service_error("Connecting", Some("InvalidAccessKeyId"), None),
            "The access key ID is invalid."
        );
        assert_eq!(
            friendly_service_error("Connecting", Some("SignatureDoesNotMatch"), None),
            "The secret access key is incorrect, or the endpoint and region do not match."
        );
        assert_eq!(
            friendly_service_error("Creating folder", Some("AccessDenied"), None),
            "Access denied while creating folder. Check this key's permissions for the bucket."
        );
    }

    #[test]
    fn transport_errors_explain_whether_the_endpoint_was_reached() {
        let timeout = SdkError::<ErrorMetadata, ()>::timeout_error(io::Error::new(
            io::ErrorKind::TimedOut,
            "example timeout",
        ));
        assert_eq!(
            friendly_sdk_error("Connecting", &timeout),
            "The storage request timed out while connecting. Try again."
        );

        let dispatch = SdkError::<ErrorMetadata, ()>::dispatch_failure(ConnectorError::io(
            io::Error::new(io::ErrorKind::ConnectionRefused, "example refusal").into(),
        ));
        assert_eq!(
            friendly_sdk_error("Connecting", &dispatch),
            "Could not reach the storage endpoint while connecting. Check the endpoint URL, network connection, DNS, and TLS settings."
        );

        let dispatch_timeout =
            SdkError::<ErrorMetadata, ()>::dispatch_failure(ConnectorError::timeout(
                io::Error::new(io::ErrorKind::TimedOut, "example connector timeout").into(),
            ));
        assert_eq!(
            friendly_sdk_error("Connecting", &dispatch_timeout),
            "The storage request timed out while connecting. Try again."
        );
    }
}

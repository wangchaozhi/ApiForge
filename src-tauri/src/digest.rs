use std::collections::HashMap;

use md5::{Digest as _, Md5};
use rand::RngCore as _;
use sha2::Sha256;

fn split_directives(input: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut quoted = false;
    let mut escaped = false;
    let mut start = 0;
    for (index, ch) in input.char_indices() {
        if escaped {
            escaped = false;
        } else if ch == '\\' && quoted {
            escaped = true;
        } else if ch == '"' {
            quoted = !quoted;
        } else if ch == ',' && !quoted {
            result.push(input[start..index].trim());
            start = index + 1;
        }
    }
    result.push(input[start..].trim());
    result
}

fn parse_challenge(challenge: &str) -> Result<HashMap<String, String>, String> {
    let raw = challenge
        .trim()
        .strip_prefix("Digest ")
        .or_else(|| challenge.trim().strip_prefix("digest "))
        .ok_or_else(|| "server did not return a Digest challenge".to_string())?;
    let mut values = HashMap::new();
    for directive in split_directives(raw) {
        let Some((key, value)) = directive.split_once('=') else {
            continue;
        };
        let value = value.trim();
        let unquoted = value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(value)
            .replace("\\\"", "\"")
            .replace("\\\\", "\\");
        values.insert(key.trim().to_ascii_lowercase(), unquoted);
    }
    Ok(values)
}

fn hex_hash(algorithm: &str, value: &str) -> Result<String, String> {
    let bytes = match algorithm {
        "MD5" | "MD5-SESS" => Md5::digest(value.as_bytes()).to_vec(),
        "SHA-256" | "SHA-256-SESS" => Sha256::digest(value.as_bytes()).to_vec(),
        other => return Err(format!("unsupported Digest algorithm: {other}")),
    };
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub(crate) fn authorization_header(
    challenge: &str,
    method: &str,
    request_url: &str,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let values = parse_challenge(challenge)?;
    let realm = values
        .get("realm")
        .ok_or_else(|| "Digest challenge is missing realm".to_string())?;
    let nonce = values
        .get("nonce")
        .ok_or_else(|| "Digest challenge is missing nonce".to_string())?;
    let algorithm = values
        .get("algorithm")
        .map(String::as_str)
        .unwrap_or("MD5")
        .to_ascii_uppercase();
    let url = reqwest::Url::parse(request_url)
        .map_err(|error| format!("invalid Digest request URL: {error}"))?;
    let mut uri = url.path().to_string();
    if let Some(query) = url.query() {
        uri.push('?');
        uri.push_str(query);
    }

    let qop = values
        .get("qop")
        .and_then(|options| {
            options
                .split(',')
                .map(str::trim)
                .find(|option| option.eq_ignore_ascii_case("auth"))
        })
        .map(|_| "auth");
    if values.get("qop").is_some() && qop.is_none() {
        return Err("Digest qop=auth-int is not supported".to_string());
    }

    let mut cnonce_bytes = [0_u8; 16];
    rand::rng().fill_bytes(&mut cnonce_bytes);
    let cnonce = cnonce_bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let nc = "00000001";

    let mut ha1 = hex_hash(&algorithm, &format!("{username}:{realm}:{password}"))?;
    if algorithm.ends_with("-SESS") {
        ha1 = hex_hash(&algorithm, &format!("{ha1}:{nonce}:{cnonce}"))?;
    }
    let ha2 = hex_hash(
        &algorithm,
        &format!("{}:{uri}", method.to_ascii_uppercase()),
    )?;
    let response = if let Some(qop) = qop {
        hex_hash(
            &algorithm,
            &format!("{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}"),
        )?
    } else {
        hex_hash(&algorithm, &format!("{ha1}:{nonce}:{ha2}"))?
    };

    let mut parts = vec![
        format!("username=\"{}\"", quote(username)),
        format!("realm=\"{}\"", quote(realm)),
        format!("nonce=\"{}\"", quote(nonce)),
        format!("uri=\"{}\"", quote(&uri)),
        format!("response=\"{response}\""),
        format!("algorithm={algorithm}"),
    ];
    if let Some(opaque) = values.get("opaque") {
        parts.push(format!("opaque=\"{}\"", quote(opaque)));
    }
    if let Some(qop) = qop {
        parts.push(format!("qop={qop}"));
        parts.push(format!("nc={nc}"));
        parts.push(format!("cnonce=\"{cnonce}\""));
    }
    Ok(format!("Digest {}", parts.join(", ")))
}

#[cfg(test)]
mod tests {
    use super::authorization_header;

    #[test]
    fn creates_rfc_7616_md5_authorization() {
        let header = authorization_header(
            "Digest realm=\"testrealm@host.com\", qop=\"auth\", nonce=\"dcd98b7102dd2f0e8b11d0f600bfb0c093\", opaque=\"5ccc069c403ebaf9f0171e9517f40e41\"",
            "GET",
            "http://www.example.com/dir/index.html",
            "Mufasa",
            "Circle Of Life",
        ).expect("authorization header");
        assert!(header.starts_with("Digest username=\"Mufasa\""));
        assert!(header.contains("uri=\"/dir/index.html\""));
        assert!(header.contains("qop=auth"));
        assert!(header.contains("response=\""));
    }

    #[test]
    fn rejects_auth_int_only_challenges() {
        let error = authorization_header(
            "Digest realm=\"test\", qop=\"auth-int\", nonce=\"nonce\"",
            "POST",
            "https://example.com/",
            "user",
            "pass",
        )
        .expect_err("auth-int should be rejected");
        assert!(error.contains("auth-int"));
    }
}

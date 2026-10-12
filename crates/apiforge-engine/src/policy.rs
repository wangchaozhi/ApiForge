//! Execution policy: what a request is allowed to touch on the machine running the engine.
//!
//! The desktop app and a personal local agent run with [`ExecutionPolicy::trusted`]. A relay
//! agent shared over a network runs with [`ExecutionPolicy::relay`], which keeps callers away
//! from the host's filesystem, its proxies, and private/internal network addresses (SSRF).

use crate::{
    error::EngineError,
    models::{EngineBody, EngineRequest},
};
use reqwest::{
    Url,
    dns::{Addrs, Name, Resolve, Resolving},
};
use std::{
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionPolicy {
    /// Allow multipart file parts and client certificates to be read from local paths.
    pub allow_filesystem: bool,
    /// Allow custom and system proxies.
    pub allow_proxy: bool,
    /// Refuse loopback, private, link-local and other non-public destinations,
    /// including after DNS resolution and on every redirect hop.
    pub block_private_networks: bool,
    /// Abort when a response body grows beyond this many bytes.
    pub max_response_bytes: Option<usize>,
}

impl ExecutionPolicy {
    /// The user's own machine: everything the desktop app can do.
    pub const fn trusted() -> Self {
        Self {
            allow_filesystem: true,
            allow_proxy: true,
            block_private_networks: false,
            max_response_bytes: None,
        }
    }

    /// A shared relay reachable by other people.
    pub const fn relay(max_response_bytes: usize) -> Self {
        Self {
            allow_filesystem: false,
            allow_proxy: false,
            block_private_networks: true,
            max_response_bytes: Some(max_response_bytes),
        }
    }

    /// Reject a request before any network activity when it needs something the policy forbids.
    pub fn check_request(&self, request: &EngineRequest) -> Result<(), EngineError> {
        if !self.allow_filesystem {
            if let EngineBody::Multipart { fields } = &request.body {
                if fields
                    .iter()
                    .any(|field| field.kind == "file" && !field.value.trim().is_empty())
                {
                    return Err(EngineError::Policy(
                        "multipart file uploads from local paths are disabled".into(),
                    ));
                }
            }
            let certificate_type = request.network.client_certificate_type.as_str();
            if !certificate_type.is_empty() && certificate_type != "none" {
                return Err(EngineError::Policy(
                    "client certificates are disabled".into(),
                ));
            }
        }
        if !self.allow_proxy && !request.network.proxy_url.trim().is_empty() {
            return Err(EngineError::Policy("custom proxies are disabled".into()));
        }
        let url =
            Url::parse(&request.url).map_err(|error| EngineError::InvalidUrl(error.to_string()))?;
        self.check_url(&url)
    }

    /// Validate a destination URL. Applied to the initial URL and to every redirect target.
    pub fn check_url(&self, url: &Url) -> Result<(), EngineError> {
        if !matches!(url.scheme(), "http" | "https") {
            return Err(EngineError::InvalidUrl(format!(
                "unsupported scheme {}",
                url.scheme()
            )));
        }
        if !self.block_private_networks {
            return Ok(());
        }
        match url.host() {
            None => Err(EngineError::Policy("URL has no host".into())),
            Some(url::Host::Ipv4(ip)) if !is_public_ip(IpAddr::V4(ip)) => Err(private(ip)),
            Some(url::Host::Ipv6(ip)) if !is_public_ip(IpAddr::V6(ip)) => Err(private(ip)),
            Some(url::Host::Domain(domain)) if is_local_hostname(domain) => Err(
                EngineError::Policy(format!("{domain} is a local host name")),
            ),
            Some(_) => Ok(()),
        }
    }
}

fn private(ip: impl std::fmt::Display) -> EngineError {
    EngineError::Policy(format!("{ip} is not a public address"))
}

fn is_local_hostname(domain: &str) -> bool {
    let domain = domain.trim_end_matches('.').to_ascii_lowercase();
    domain == "localhost"
        || domain.ends_with(".localhost")
        || domain.ends_with(".local")
        || domain.ends_with(".internal")
}

/// True only for globally routable unicast addresses.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0 // "this network"
        || (a == 100 && (64..128).contains(&b)) // carrier-grade NAT
        || (a == 192 && b == 0 && c == 0) // IETF protocol assignments
        || (a == 198 && (18..20).contains(&b)) // benchmarking
        || a >= 240) // reserved
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_ipv4(v4);
    }
    let segments = ip.segments();
    // NAT64 well-known prefix embeds an IPv4 destination.
    if segments[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
        let [a, b] = segments[6].to_be_bytes();
        let [c, d] = segments[7].to_be_bytes();
        return is_public_ipv4(Ipv4Addr::new(a, b, c, d));
    }
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00 // unique local
        || (segments[0] & 0xffc0) == 0xfe80 // link local
        || (segments[0] & 0xffc0) == 0xfec0 // site local (deprecated)
        || (segments[0] == 0x2001 && segments[1] == 0x0db8) // documentation
        || segments[..6] == [0, 0, 0, 0, 0, 0]) // IPv4-compatible / reserved
}

/// DNS resolver that drops non-public addresses, so host names that point at internal
/// services (including through DNS rebinding) cannot be reached.
#[derive(Clone, Copy, Debug, Default)]
pub struct PublicOnlyResolver;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addresses = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|address| is_public_ip(address.ip()))
                .collect::<Vec<SocketAddr>>();
            if addresses.is_empty() {
                return Err(Box::new(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("{host} does not resolve to a public address"),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_public_and_internal_addresses() {
        for ip in [
            "1.1.1.1",
            "93.184.216.34",
            "2606:4700:4700::1111",
            "::ffff:8.8.8.8",
            "64:ff9b::808:808",
        ] {
            assert!(is_public_ip(ip.parse().unwrap()), "expected public: {ip}");
        }
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
            "::1",
            "::",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "64:ff9b::a00:1",
            "2001:db8::1",
        ] {
            assert!(
                !is_public_ip(ip.parse().unwrap()),
                "expected internal: {ip}"
            );
        }
    }

    #[test]
    fn relay_policy_rejects_local_destinations_and_schemes() {
        let policy = ExecutionPolicy::relay(1024);
        for url in [
            "http://127.0.0.1:8080/",
            "http://[::1]/",
            "http://localhost/",
            "http://api.localhost/",
            "http://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
        ] {
            assert!(
                policy.check_url(&Url::parse(url).unwrap()).is_err(),
                "expected blocked: {url}"
            );
        }
        assert!(
            policy
                .check_url(&Url::parse("https://example.com/").unwrap())
                .is_ok()
        );
        assert!(
            ExecutionPolicy::trusted()
                .check_url(&Url::parse("http://127.0.0.1/").unwrap())
                .is_ok()
        );
    }
}

use apiforge_engine::ExecutionPolicy;
use clap::{Parser, ValueEnum};
use rand::RngCore as _;
use std::{
    fs,
    net::SocketAddr,
    path::{Path, PathBuf},
};

pub const DEFAULT_LISTEN: &str = "127.0.0.1:47811";
const MIN_TOKEN_LENGTH: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Mode {
    /// Personal agent on your own machine: can reach localhost, intranet hosts, local files
    /// for multipart uploads and client certificates, and proxies.
    Local,
    /// Shared relay for a hosted web deployment: public destinations only, no local files,
    /// no proxies, no shared cookie jar, bounded response size.
    Relay,
}

#[derive(Debug, Parser)]
#[command(name = "apiforge-agent", version, about)]
pub struct Args {
    /// Address to listen on. Keep the loopback default for a personal agent.
    #[arg(long, env = "APIFORGE_AGENT_LISTEN", default_value = DEFAULT_LISTEN)]
    pub listen: SocketAddr,

    #[arg(long, env = "APIFORGE_AGENT_MODE", value_enum, default_value_t = Mode::Local)]
    pub mode: Mode,

    /// Access token clients must send as `Authorization: Bearer <token>`.
    #[arg(
        long,
        env = "APIFORGE_AGENT_TOKEN",
        hide_env_values = true,
        conflicts_with = "token_file"
    )]
    pub token: Option<String>,

    /// Read the access token from this file. In local mode the default token file is
    /// created on first start when neither --token nor --token-file is given.
    #[arg(long, env = "APIFORGE_AGENT_TOKEN_FILE")]
    pub token_file: Option<PathBuf>,

    /// Browser origin allowed to call the agent (repeatable). Any origin is allowed when
    /// omitted; requests still need the token.
    #[arg(
        long = "allow-origin",
        env = "APIFORGE_AGENT_ALLOW_ORIGINS",
        value_delimiter = ','
    )]
    pub allow_origins: Vec<String>,

    /// Serve the built web app (`npm run build` → dist/) from this directory.
    #[arg(long, env = "APIFORGE_AGENT_STATIC_DIR")]
    pub static_dir: Option<PathBuf>,

    /// Largest response body relayed in relay mode, in bytes.
    #[arg(long, env = "APIFORGE_AGENT_MAX_RESPONSE_BYTES", default_value_t = 20 * 1024 * 1024)]
    pub max_response_bytes: usize,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub listen: SocketAddr,
    pub mode: Mode,
    pub token: String,
    pub token_source: TokenSource,
    pub allow_origins: Vec<String>,
    pub static_dir: Option<PathBuf>,
    pub policy: ExecutionPolicy,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenSource {
    Explicit,
    File(PathBuf),
    Generated(PathBuf),
}

impl Config {
    pub fn from_args(args: Args) -> Result<Self, String> {
        let (token, token_source) = resolve_token(&args)?;
        if token.len() < MIN_TOKEN_LENGTH {
            return Err(format!(
                "the access token must be at least {MIN_TOKEN_LENGTH} characters"
            ));
        }
        if let Some(dir) = &args.static_dir
            && !dir.join("index.html").is_file()
        {
            return Err(format!(
                "{} does not contain index.html; run `npm run build` first",
                dir.display()
            ));
        }
        let policy = match args.mode {
            Mode::Local => ExecutionPolicy::trusted(),
            Mode::Relay => ExecutionPolicy::relay(args.max_response_bytes),
        };
        Ok(Self {
            listen: args.listen,
            mode: args.mode,
            token,
            token_source,
            allow_origins: args
                .allow_origins
                .into_iter()
                .map(|origin| origin.trim().trim_end_matches('/').to_string())
                .filter(|origin| !origin.is_empty())
                .collect(),
            static_dir: args.static_dir,
            policy,
        })
    }
}

fn resolve_token(args: &Args) -> Result<(String, TokenSource), String> {
    if let Some(token) = &args.token {
        return Ok((token.trim().to_string(), TokenSource::Explicit));
    }
    if let Some(path) = &args.token_file {
        return read_token(path).map(|token| (token, TokenSource::File(path.clone())));
    }
    if args.mode == Mode::Relay {
        return Err(
            "relay mode needs an explicit access token (--token, --token-file or APIFORGE_AGENT_TOKEN)"
                .into(),
        );
    }
    let path = default_token_path()
        .ok_or("cannot determine a config directory; pass --token or --token-file")?;
    if path.is_file() {
        return read_token(&path).map(|token| (token, TokenSource::File(path)));
    }
    let token = generate_token();
    write_private_file(&path, &token)
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    Ok((token, TokenSource::Generated(path)))
}

fn read_token(path: &Path) -> Result<String, String> {
    fs::read_to_string(path)
        .map(|token| token.trim().to_string())
        .map_err(|error| format!("cannot read {}: {error}", path.display()))
}

pub fn generate_token() -> String {
    let mut bytes = [0_u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn default_token_path() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
        })
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    }?;
    Some(base.join("apiforge").join("agent-token"))
}

fn write_private_file(path: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    #[cfg(unix)]
    {
        use std::{io::Write as _, os::unix::fs::OpenOptionsExt as _};
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(contents.as_bytes())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, contents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(extra: &[&str]) -> Args {
        Args::try_parse_from(["apiforge-agent"].iter().chain(extra)).unwrap()
    }

    #[test]
    fn relay_mode_requires_an_explicit_token() {
        let error = Config::from_args(args(&["--mode", "relay"])).unwrap_err();
        assert!(error.contains("explicit access token"));
        let config = Config::from_args(args(&[
            "--mode",
            "relay",
            "--token",
            "0123456789abcdef",
            "--allow-origin",
            "https://forge.example.com/,https://other.example.com",
        ]))
        .unwrap();
        assert_eq!(config.policy, ExecutionPolicy::relay(20 * 1024 * 1024));
        assert_eq!(
            config.allow_origins,
            ["https://forge.example.com", "https://other.example.com"]
        );
    }

    #[test]
    fn short_tokens_are_rejected_and_generated_tokens_are_long() {
        assert!(Config::from_args(args(&["--token", "short"])).is_err());
        let token = generate_token();
        assert_eq!(token.len(), 48);
        assert_ne!(token, generate_token());
    }
}

//! ApiForge agent: executes requests for the web app with the same engine as the desktop app,
//! so browsers are not limited by CORS, forbidden headers or TLS settings.

mod config;
mod server;

#[cfg(test)]
mod tests;

use clap::Parser as _;
use config::{Args, Config, Mode, TokenSource};

#[tokio::main]
async fn main() {
    let config = match Config::from_args(Args::parse()) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("apiforge-agent: {error}");
            std::process::exit(2);
        }
    };

    let listener = match tokio::net::TcpListener::bind(config.listen).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "apiforge-agent: cannot listen on {}: {error}",
                config.listen
            );
            std::process::exit(1);
        }
    };
    print_banner(&config);

    let app = server::router(&config);
    if let Err(error) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        eprintln!("apiforge-agent: server error: {error}");
        std::process::exit(1);
    }
}

fn print_banner(config: &Config) {
    let mode = match config.mode {
        Mode::Local => "local (localhost, intranet, local files and proxies allowed)",
        Mode::Relay => "relay (public destinations only)",
    };
    println!(
        "ApiForge agent {} listening on http://{}",
        env!("CARGO_PKG_VERSION"),
        config.listen
    );
    println!("Mode: {mode}");
    match &config.token_source {
        TokenSource::Explicit => println!("Token: provided by --token / APIFORGE_AGENT_TOKEN"),
        TokenSource::File(path) => println!("Token: read from {}", path.display()),
        TokenSource::Generated(path) => {
            println!("Token: generated and saved to {}", path.display())
        }
    }
    if config.mode == Mode::Local {
        println!();
        println!("In the ApiForge web app open Settings → Request agent and enter:");
        println!("  Agent URL: http://{}", config.listen);
        println!("  Token:     {}", config.token);
    }
    if let Some(dir) = &config.static_dir {
        println!("Serving web app from {}", dir.display());
    }
    if config.allow_origins.is_empty() {
        println!("Allowed origins: any (token required)");
    } else {
        println!("Allowed origins: {}", config.allow_origins.join(", "));
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    println!("Shutting down");
}

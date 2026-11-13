use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use silence_engine::agent::AppCtx;
use silence_engine::audit::AuditLog;
use silence_engine::rpc::{self, RpcState};
use silence_router::Catalog;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "silence-engine", about = "5ilence Engine sidecar")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Serve {
        #[arg(long)]
        pipe: Option<String>,
        #[arg(long)]
        tcp: Option<String>,
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        data_dir: Option<PathBuf>,
    },
    /// Run an eval suite (evals/README.md).
    Evals {
        #[arg(long)]
        dir: PathBuf,
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        repo_root: Option<PathBuf>,
        /// Override the model of every task (catalog id).
        #[arg(long)]
        model: Option<String>,
        /// Only these task ids (comma separated).
        #[arg(long, value_delimiter = ',')]
        only: Vec<String>,
        /// Only tasks whose resolved model is this one (nightly: claude-haiku).
        #[arg(long)]
        pinned: Option<String>,
        /// Attempts per task; a task passes only if all pass.
        #[arg(long, default_value_t = 1)]
        repeat: u32,
        /// Re-run a failed task once; a pass marks it flaky.
        #[arg(long)]
        retry_failed: bool,
        /// Stop starting tasks after spending this many USD.
        #[arg(long)]
        max_cost: Option<f64>,
        /// Append to evals/history/runs.jsonl and regenerate SUMMARY.md.
        #[arg(long)]
        history: bool,
        /// Label stored in history (manual, nightly, weekly…).
        #[arg(long, default_value = "manual")]
        profile: String,
        /// Provider to run on (default: SILENCE_EVAL_SOURCE, else claude-cli).
        #[arg(long)]
        source: Option<String>,
    },
    /// Pin the cheapest passing model per task in <suite>/models.yaml.
    EvalsCalibrate {
        #[arg(long)]
        dir: PathBuf,
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        repo_root: Option<PathBuf>,
        /// Only these task ids (re-calibrates pinned ones too).
        #[arg(long, value_delimiter = ',')]
        only: Vec<String>,
        /// Re-calibrate every task.
        #[arg(long)]
        all: bool,
        /// Passes in a row needed to pin a model.
        #[arg(long, default_value_t = 2)]
        repeat: u32,
        #[arg(long, default_value_t = 5.0)]
        max_cost: f64,
        #[arg(long)]
        history: bool,
        /// Provider to run on (default: SILENCE_EVAL_SOURCE, else claude-cli).
        #[arg(long)]
        source: Option<String>,
    },
    /// Regenerate evals/history/SUMMARY.md from runs.jsonl (no API calls).
    EvalsReport {
        #[arg(long)]
        repo_root: Option<PathBuf>,
    },
    /// Internal: MCP stdio bridge the Claude CLI spawns; relays to the Engine's per-turn
    /// loopback listener. Not for direct use.
    #[command(hide = true)]
    McpBridge {
        #[arg(long)]
        port: u16,
        #[arg(long)]
        token: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "silence_engine=info,silence_tools=info".into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Serve {
            pipe,
            tcp,
            config,
            data_dir,
        } => serve(pipe, tcp, config, data_dir).await,
        Cmd::Evals {
            dir,
            config,
            repo_root,
            model,
            only,
            pinned,
            repeat,
            retry_failed,
            max_cost,
            history,
            profile,
            source,
        } => {
            let repo = repo_root.unwrap_or_else(|| PathBuf::from("."));
            let cfg = config.unwrap_or_else(|| repo.join("config/models.yaml"));
            let opts = silence_engine::eval_runner::RunOptions {
                model,
                only,
                pinned,
                repeat,
                retry_failed,
                max_cost,
                history,
                profile,
                source: silence_engine::eval_runner::source_or_default(source),
            };
            let code = silence_engine::eval_runner::run(&dir, &cfg, &repo, &opts).await?;
            std::process::exit(code);
        }
        Cmd::EvalsCalibrate {
            dir,
            config,
            repo_root,
            only,
            all,
            repeat,
            max_cost,
            history,
            source,
        } => {
            let repo = repo_root.unwrap_or_else(|| PathBuf::from("."));
            let cfg = config.unwrap_or_else(|| repo.join("config/models.yaml"));
            let opts = silence_engine::eval_calibrate::CalibrateOptions {
                only,
                all,
                repeat,
                max_cost,
                history,
                source: silence_engine::eval_runner::source_or_default(source),
            };
            let code = silence_engine::eval_calibrate::calibrate(&dir, &cfg, &repo, &opts).await?;
            std::process::exit(code);
        }
        Cmd::EvalsReport { repo_root } => {
            let repo = repo_root.unwrap_or_else(|| PathBuf::from("."));
            let path = silence_engine::eval_history::write_summary(&repo)?;
            println!("{}", path.display());
            Ok(())
        }
        Cmd::McpBridge { port, token } => silence_engine::agent::run_bridge(port, &token).await,
    }
}

async fn serve(
    pipe: Option<String>,
    tcp: Option<String>,
    config: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> Result<()> {
    let config = config.unwrap_or_else(|| PathBuf::from("config/models.yaml"));
    let catalog = Catalog::load(&config).context("load model catalog")?;
    let data_dir = data_dir.unwrap_or_else(|| {
        dirs_data().join("silence")
    });
    std::fs::create_dir_all(&data_dir)?;
    let audit = AuditLog::open(&data_dir)?;
    let ctx = Arc::new(AppCtx::new(catalog, audit));
    let state = Arc::new(RpcState::new(ctx));

    if let Some(addr) = tcp {
        silence_engine::bind_policy::ensure_loopback_tcp_bind(&addr)?;
        let listener = tokio::net::TcpListener::bind(&addr).await?;
        let local = listener.local_addr()?;
        eprintln!("silence-engine ready tcp={local}");
        loop {
            let (stream, _) = listener.accept().await?;
            let state = state.clone();
            tokio::spawn(async move {
                let (r, w) = stream.into_split();
                if let Err(err) = rpc::serve_connection(state, r, w).await {
                    tracing::warn!("conn: {err}");
                }
            });
        }
    } else {
        let name = pipe.unwrap_or_else(|| default_pipe());
        eprintln!("silence-engine ready pipe={name}");
        serve_pipe(state, &name).await
    }
}

fn default_pipe() -> String {
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\silence-{}", std::process::id())
    }
    #[cfg(not(windows))]
    {
        format!("/tmp/silence-{}.sock", std::process::id())
    }
}

fn dirs_data() -> PathBuf {
    if let Some(p) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(p);
    }
    PathBuf::from(".silence-local")
}

#[cfg(windows)]
async fn serve_pipe(state: Arc<RpcState>, name: &str) -> Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let mut first = true;
    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(first)
            .create(name)
            .context("create named pipe")?;
        first = false;
        server.connect().await.context("pipe connect")?;
        let state = state.clone();
        tokio::spawn(async move {
            let (rh, wh) = tokio::io::split(server);
            if let Err(err) = rpc::serve_connection(state, rh, wh).await {
                tracing::warn!("pipe conn: {err}");
            }
        });
    }
}

#[cfg(not(windows))]
async fn serve_pipe(state: Arc<RpcState>, name: &str) -> Result<()> {
    let _ = std::fs::remove_file(name);
    let listener = tokio::net::UnixListener::bind(name)?;
    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            let (r, w) = stream.into_split();
            if let Err(err) = rpc::serve_connection(state, r, w).await {
                tracing::warn!("sock: {err}");
            }
        });
    }
}

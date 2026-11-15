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
        /// Run on this source (provider id): same model family or tier there.
        #[arg(long)]
        source: Option<String>,
        /// Effort for every task (low|medium|high|xhigh|max).
        #[arg(long)]
        effort: Option<String>,
        /// Least recently run tasks first (history), so a capped run rotates through the suite.
        #[arg(long)]
        rotate: bool,
        /// Only tasks a change since this commit can affect (evals/affects.yaml); none = exit 0
        /// without calling a model.
        #[arg(long)]
        affected_since: Option<String>,
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
        /// Run the ladder on this source (default: `source` in evals/config.yaml). Pins keep the
        /// base ids (`claude-haiku`…), so they work for every source.
        #[arg(long)]
        source: Option<String>,
    },
    /// Run a profile (smoke | nightly | weekly) on the source of evals/config.yaml. Same steps on
    /// a dev PC (`npm run evals:smoke`) and in CI (`--ci`).
    EvalsProfile {
        #[arg(long)]
        profile: String,
        /// Provider id or `per-task`; default: evals/config.yaml (`ci.source` with --ci).
        #[arg(long)]
        source: Option<String>,
        /// CI run: use `ci.source`, do nothing while CI is off.
        #[arg(long)]
        ci: bool,
        /// Only tasks a change since this commit can affect (evals/affects.yaml).
        #[arg(long)]
        affected_since: Option<String>,
        /// Check the settings and the source only; print `skip=true|false`.
        #[arg(long)]
        check: bool,
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        repo_root: Option<PathBuf>,
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
    /// Sandbox for agent commands (Windows). `setup` asks for admin (UAC) once.
    Sandbox {
        #[command(subcommand)]
        action: SandboxCmd,
    },
    /// Internal: runs one sandboxed command as the sandbox user (spec on stdin).
    #[command(hide = true)]
    SandboxRunner,
}

#[derive(Subcommand)]
enum SandboxCmd {
    /// Create the hidden sandbox user, its folders and encrypted password (one UAC prompt).
    Setup {
        #[arg(long, hide = true)]
        elevated: bool,
    },
    /// Remove the sandbox user, folders, and every ACE it got on workspaces (one UAC prompt).
    Uninstall {
        #[arg(long, hide = true)]
        elevated: bool,
    },
    /// Print the sandbox state as JSON.
    Status,
    /// Let the sandbox write in a workspace (or only read it, with --read).
    Grant {
        path: PathBuf,
        #[arg(long)]
        read: bool,
    },
    /// Run a PowerShell command in the sandbox, in a granted workspace, with the network proxy
    /// (registries + `.silence/network.json` + `--allow`). For manual testing.
    Exec {
        #[arg(long)]
        ws: PathBuf,
        #[arg(long, default_value_t = 120)]
        timeout_secs: u64,
        /// Extra host pattern for this run (`example.com`, `*.example.com`). Repeatable.
        #[arg(long)]
        allow: Vec<String>,
        #[arg(trailing_var_arg = true, required = true, allow_hyphen_values = true)]
        command: Vec<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // The runner's stdout/stderr ARE the sandboxed command's output: no logging, no clap help.
    if std::env::args().nth(1).as_deref() == Some(silence_sandbox::RUNNER_ARG) {
        std::process::exit(silence_sandbox::runner_main());
    }
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
            effort,
            rotate,
            affected_since,
        } => {
            let repo = repo_root.unwrap_or_else(|| PathBuf::from("."));
            let cfg = config.unwrap_or_else(|| repo.join("config/models.yaml"));
            // No --source: the local default of evals/config.yaml (`per-task` = pinned models).
            let settings = silence_engine::eval_config::load(&repo)?;
            let source = silence_engine::eval_config::resolve_source(source.as_deref(), &settings.source);
            let opts = silence_engine::eval_runner::RunOptions {
                model,
                only,
                pinned,
                repeat,
                retry_failed,
                max_cost,
                history,
                profile,
                source,
                effort,
                rotate,
                affected_since,
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
            let settings = silence_engine::eval_config::load(&repo)?;
            let opts = silence_engine::eval_calibrate::CalibrateOptions {
                only,
                all,
                repeat,
                max_cost,
                history,
                source: silence_engine::eval_config::resolve_source(source.as_deref(), &settings.source),
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
        Cmd::EvalsProfile { profile, source, ci, affected_since, check, config, repo_root } => {
            let repo = repo_root.unwrap_or_else(|| PathBuf::from("."));
            let cfg = config.unwrap_or_else(|| repo.join("config/models.yaml"));
            let o = silence_engine::eval_profile::ProfileOptions { profile, source, ci, affected_since, check };
            let code = silence_engine::eval_profile::run_profile(&repo, &cfg, &o).await?;
            std::process::exit(code);
        }
        Cmd::McpBridge { port, token } => silence_engine::agent::run_bridge(port, &token).await,
        Cmd::SandboxRunner => std::process::exit(silence_sandbox::runner_main()),
        Cmd::Sandbox { action: SandboxCmd::Exec { ws, timeout_secs, allow, command } } => {
            sandbox_exec(ws, timeout_secs, allow, command).await
        }
        Cmd::Sandbox { action } => tokio::task::spawn_blocking(move || sandbox_cmd(action)).await?,
    }
}

fn sandbox_cmd(action: SandboxCmd) -> Result<()> {
    let exe = std::env::current_exe()?;
    match action {
        SandboxCmd::Setup { elevated: true } => silence_sandbox::setup_elevated(),
        SandboxCmd::Setup { elevated: false } => {
            silence_sandbox::setup(&exe)?;
            println!("{}", serde_json::to_string(&silence_sandbox::status())?);
            Ok(())
        }
        SandboxCmd::Uninstall { elevated: true } => silence_sandbox::uninstall_elevated(),
        SandboxCmd::Uninstall { elevated: false } => silence_sandbox::uninstall(&exe),
        SandboxCmd::Status => {
            println!("{}", serde_json::to_string(&silence_sandbox::status())?);
            Ok(())
        }
        SandboxCmd::Grant { path, read: true } => silence_sandbox::grant_read(&path),
        SandboxCmd::Grant { path, read: false } => {
            let took = silence_sandbox::grant_workspace(&path)?;
            eprintln!("granted {} in {} ms", path.display(), took.as_millis());
            Ok(())
        }
        SandboxCmd::Exec { .. } => unreachable!("handled in sandbox_exec"),
    }
}

/// `sandbox exec`: start the proxy for this run, give the command a credential for it, run it as
/// the sandbox user, then print what the proxy allowed / refused.
async fn sandbox_exec(ws: PathBuf, timeout_secs: u64, allow: Vec<String>, command: Vec<String>) -> Result<()> {
    use silence_sandbox::proxy::{workspace_allowlist, Grant, Proxy, DEFAULT_PORTS};
    use std::io::Write;
    let exe = std::env::current_exe()?;
    let (proxy, mut events) = Proxy::start().await?;
    let mut hosts = workspace_allowlist(&ws);
    hosts.extend(allow);
    let cred = proxy.issue(Grant { session: "cli-exec".into(), allow: hosts, ports: DEFAULT_PORTS.to_vec() });
    let mut env = silence_sandbox::default_env(&ws);
    env.extend(cred.env());
    let script = command.join(" ");
    let spec = silence_sandbox::RunSpec {
        command_line: format!("powershell.exe -NoProfile -NonInteractive -Command \"{}\"", script.replace('"', "\\\"")),
        cwd: ws.clone(),
        env,
        limits: silence_sandbox::Limits::standard(),
    };
    let t = std::time::Instant::now();
    let out = tokio::task::spawn_blocking(move || {
        silence_sandbox::run(&spec, &exe, Some(std::time::Duration::from_secs(timeout_secs)))
    })
    .await??;
    proxy.revoke(&cred);
    std::io::stdout().write_all(&out.stdout)?;
    std::io::stderr().write_all(&out.stderr)?;
    // Connections finish just before the command exits; give their events a moment.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    while let Ok(ev) = events.try_recv() {
        eprintln!(
            "[sandbox] net {} {}:{} {}{}",
            if ev.allowed { "allow" } else { "DENY" },
            ev.host,
            ev.port,
            ev.reason.map(|r| format!("({r}) ")).unwrap_or_default(),
            if ev.allowed { format!("up={} down={}", ev.bytes_up, ev.bytes_down) } else { String::new() }
        );
    }
    proxy.shutdown();
    eprintln!("[sandbox] exit={} timed_out={} {} ms", out.code, out.timed_out, t.elapsed().as_millis());
    std::process::exit(if out.timed_out { 124 } else { out.code });
}

async fn serve(
    pipe: Option<String>,
    tcp: Option<String>,
    config: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> Result<()> {
    // First: take the RPC token out of our env before anything can spawn a child process.
    let (token, generated) = silence_engine::rpc_auth::take_from_env();
    let config = config.unwrap_or_else(|| PathBuf::from("config/models.yaml"));
    let catalog = Catalog::load(&config).context("load model catalog")?;
    let data_dir = data_dir.unwrap_or_else(|| {
        dirs_data().join("silence")
    });
    std::fs::create_dir_all(&data_dir)?;
    let audit = AuditLog::open(&data_dir)?;
    let ctx = Arc::new(AppCtx::new(catalog, audit));
    // Evals (`eval.*`) resolve against the working directory, like `silence-engine evals`.
    let repo_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let config_abs = if config.is_absolute() { config.clone() } else { repo_root.join(&config) };
    let state = Arc::new(RpcState::with_paths(ctx, repo_root, config_abs).with_auth_token(token.clone()));
    if generated {
        // Manual runs (`npm run runtime`): nobody gave us a token, so show the one we made.
        // Studio always passes SILENCE_RPC_TOKEN, so this line never appears there.
        eprintln!("silence-engine rpc token={token} (first request: auth.hello)");
    }

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
    // Only this user and SYSTEM may open the pipe (the sandbox user is another account).
    let owner_only = silence_sandbox::owner_only::OwnerOnly::new().context("pipe security descriptor")?;
    let mut first = true;
    loop {
        // SAFETY: `owner_only` outlives every call; the pointer is a valid SECURITY_ATTRIBUTES.
        let server = unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(name, owner_only.as_ptr())
        }
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

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use silence_protocol::McpServerConfig;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

pub struct McpClient {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
    _child: Mutex<Child>,
}

impl McpClient {
    pub async fn start(cfg: &McpServerConfig) -> Result<Self> {
        let mut cmd = Command::new(&cfg.command);
        cmd.args(&cfg.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (k, v) in &cfg.env {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().context("spawn mcp")?;
        let stdin = child.stdin.take().context("mcp stdin")?;
        let stdout = child.stdout.take().context("mcp stdout")?;
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let pending_reader = pending.clone();
        tokio::spawn(async move {
            if let Err(err) = read_loop(stdout, pending_reader).await {
                tracing::warn!("mcp read loop: {err}");
            }
        });
        let client = Self {
            stdin: Mutex::new(stdin),
            pending,
            _child: Mutex::new(child),
        };
        client.initialize().await?;
        Ok(client)
    }

    async fn initialize(&self) -> Result<()> {
        let _ = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "silence-engine", "version": "0.1.0"}
                }),
            )
            .await?;
        self.notify("notifications/initialized", json!({})).await
    }

    pub async fn list_tools(&self) -> Result<Vec<McpTool>> {
        let result = self.request("tools/list", json!({})).await?;
        let tools = result
            .get("tools")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(tools
            .into_iter()
            .filter_map(|t| {
                Some(McpTool {
                    name: t.get("name")?.as_str()?.to_string(),
                    description: t
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    schema: t
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({"type": "object"})),
                })
            })
            .collect())
    }

    pub async fn call_tool(&self, name: &str, args: Value) -> Result<String> {
        let result = self
            .request("tools/call", json!({"name": name, "arguments": args}))
            .await?;
        Ok(result.to_string())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        write_message(&mut *self.stdin.lock().await, &msg).await?;
        tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .context("mcp timeout")?
            .context("mcp cancelled")
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        write_message(&mut *self.stdin.lock().await, &msg).await?;
        Ok(())
    }
}

pub struct McpHost {
    servers: Mutex<HashMap<String, Arc<McpClient>>>,
}

impl McpHost {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
        }
    }

    pub async fn add(&self, cfg: McpServerConfig) -> Result<Vec<McpTool>> {
        let client = McpClient::start(&cfg).await?;
        let tools = client.list_tools().await?;
        self.servers
            .lock()
            .await
            .insert(cfg.name.clone(), Arc::new(client));
        Ok(tools)
    }

    pub async fn remove(&self, name: &str) {
        self.servers.lock().await.remove(name);
    }

    pub async fn list(&self) -> Vec<String> {
        self.servers.lock().await.keys().cloned().collect()
    }

    pub async fn call(&self, server: &str, tool: &str, args: Value) -> Result<String> {
        let client = self
            .servers
            .lock()
            .await
            .get(server)
            .cloned()
            .ok_or_else(|| anyhow!("mcp server not connected: {server}"))?;
        client.call_tool(tool, args).await
    }

    pub async fn all_tools(&self) -> Vec<(String, McpTool)> {
        let snapshot: Vec<(String, Arc<McpClient>)> = self
            .servers
            .lock()
            .await
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let mut out = Vec::new();
        for (name, client) in snapshot {
            if let Ok(tools) = client.list_tools().await {
                for t in tools {
                    out.push((name.clone(), t));
                }
            }
        }
        out
    }
}

impl Default for McpHost {
    fn default() -> Self {
        Self::new()
    }
}

async fn write_message(stdin: &mut ChildStdin, msg: &Value) -> Result<()> {
    let body = serde_json::to_vec(msg)?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin.write_all(header.as_bytes()).await?;
    stdin.write_all(&body).await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_loop(
    stdout: tokio::process::ChildStdout,
    pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>,
) -> Result<()> {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut content_len: Option<usize> = None;
        loop {
            let mut line = String::new();
            let n = reader.read_line(&mut line).await?;
            if n == 0 {
                return Ok(());
            }
            if line.trim_end().is_empty() {
                break;
            }
            if let Some(rest) = line.strip_prefix("Content-Length:") {
                content_len = Some(rest.trim().parse().unwrap_or(0));
            }
        }
        let len = match content_len {
            Some(0) | None => continue,
            Some(n) => n,
        };
        let mut buf = vec![0u8; len];
        reader.read_exact(&mut buf).await?;
        let v: Value = serde_json::from_slice(&buf)?;
        if let Some(id) = v.get("id") {
            let key = match id {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            if let Some(tx) = pending.lock().await.remove(&key) {
                let payload = v.get("result").cloned().unwrap_or(v.clone());
                let _ = tx.send(payload);
            }
        }
    }
}

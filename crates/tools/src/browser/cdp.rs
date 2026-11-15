//! Minimal Chrome DevTools Protocol client over one websocket (one page target).
//! Commands get an id and wait for the matching reply; everything else is an event handed to
//! `on_event`. No generated protocol types: params and results stay `serde_json::Value`.

use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

pub type OnEvent = Arc<dyn Fn(&str, &Value) + Send + Sync>;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct Cdp {
    out: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next: AtomicU64,
}

impl Cdp {
    /// `ws_url` must be a loopback `ws://` URL (the caller got it from the browser it launched).
    pub async fn connect(ws_url: &str, on_event: OnEvent) -> Result<Self> {
        let (ws, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .map_err(|e| anyhow!("connect to browser: {e}"))?;
        let (mut sink, mut stream) = ws.split();
        let (out, mut out_rx) = mpsc::unbounded_channel::<Message>();
        tokio::spawn(async move {
            while let Some(m) = out_rx.recv().await {
                if sink.send(m).await.is_err() {
                    break;
                }
            }
        });
        let pending: Pending = Arc::default();
        let p = pending.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = stream.next().await {
                let Message::Text(text) = msg else { continue };
                let Ok(v) = serde_json::from_str::<Value>(text.as_ref()) else { continue };
                if let Some(id) = v.get("id").and_then(Value::as_u64) {
                    let tx = p.lock().unwrap().remove(&id);
                    if let Some(tx) = tx {
                        let r = match v.get("error") {
                            Some(e) => Err(e.get("message").and_then(Value::as_str).unwrap_or("cdp error").to_string()),
                            None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = tx.send(r);
                    }
                } else if let Some(method) = v.get("method").and_then(Value::as_str) {
                    on_event(method, v.get("params").unwrap_or(&Value::Null));
                }
            }
            // Socket closed: fail whatever still waits.
            for (_, tx) in p.lock().unwrap().drain() {
                let _ = tx.send(Err("browser connection closed".into()));
            }
        });
        Ok(Self {
            out,
            pending,
            next: AtomicU64::new(1),
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.call_timeout(method, params, Duration::from_secs(20)).await
    }

    pub async fn call_timeout(&self, method: &str, params: Value, timeout: Duration) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let msg = json!({"id": id, "method": method, "params": params}).to_string();
        if self.out.send(Message::Text(msg.into())).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err(anyhow!("browser connection closed"));
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => Err(anyhow!("{method}: {e}")),
            Ok(Err(_)) => Err(anyhow!("browser connection closed")),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(anyhow!("{method}: no answer from the browser in {}s", timeout.as_secs()))
            }
        }
    }

    /// `Runtime.evaluate` with `returnByValue`; a thrown exception becomes `Err`.
    pub async fn eval(&self, expression: &str) -> Result<Value> {
        let r = self
            .call(
                "Runtime.evaluate",
                json!({"expression": expression, "returnByValue": true, "awaitPromise": true, "userGesture": true}),
            )
            .await?;
        if let Some(ex) = r.get("exceptionDetails") {
            let msg = ex
                .pointer("/exception/description")
                .and_then(Value::as_str)
                .or_else(|| ex.get("text").and_then(Value::as_str))
                .unwrap_or("script error");
            return Err(anyhow!("page script failed: {msg}"));
        }
        Ok(r.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }
}

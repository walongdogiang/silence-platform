use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub struct TerminalSession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub rx: Mutex<mpsc::Receiver<Vec<u8>>>,
}

impl TerminalSession {
    pub fn start(cwd: &str, cols: u16, rows: u16) -> Result<Self> {
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("open pty")?;
        let mut cmd = if cfg!(windows) {
            CommandBuilder::new("powershell.exe")
        } else {
            CommandBuilder::new("bash")
        };
        cmd.cwd(cwd);
        let _child = pair.slave.spawn_command(cmd).context("spawn pty cmd")?;
        let mut reader = pair.master.try_clone_reader().context("pty reader")?;
        let writer = pair.master.take_writer().context("pty writer")?;
        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            writer: Arc::new(Mutex::new(writer)),
            rx: Mutex::new(rx),
        })
    }

    pub async fn write(&self, data: &str) -> Result<()> {
        let mut w = self.writer.lock().await;
        w.write_all(data.as_bytes())?;
        w.flush()?;
        Ok(())
    }
}

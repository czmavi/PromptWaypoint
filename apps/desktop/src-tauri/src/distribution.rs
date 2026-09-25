use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
pub struct Distribution {
    child: Mutex<Option<Child>>,
    operation: tokio::sync::Mutex<()>,
}
const BASE: &str = "http://127.0.0.1:7431";
const UPDATES: &str =
    "https://github.com/czmavi/prompt-waypoint-releases/releases/latest/download/latest.json";
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join(".pmai-agent"))
}
fn local_token(app: &tauri::AppHandle) -> Result<String, String> {
    std::fs::read_to_string(directory(app)?.join("local-token"))
        .map(|s| s.trim().into())
        .map_err(|_| "Local Agent token is unavailable".into())
}
async fn responds(app: &tauri::AppHandle) -> bool {
    let Ok(token) = local_token(app) else {
        return false;
    };
    let Ok(http) = client() else {
        return false;
    };
    http.get(format!("{BASE}/state"))
        .timeout(Duration::from_millis(500))
        .bearer_auth(token)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}
fn provider_path(app: &tauri::AppHandle) -> Result<std::ffi::OsString, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let mut paths: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    paths.extend([
        home.join(".local/bin"),
        home.join(".npm-global/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        let mut dirs: Vec<_> = entries.flatten().map(|e| e.path().join("bin")).collect();
        dirs.sort();
        dirs.reverse();
        paths.extend(dirs);
    }
    if let Ok(entries) = std::fs::read_dir(home.join(".vscode/extensions")) {
        let platform = if std::env::consts::ARCH == "aarch64" {
            "macos-aarch64"
        } else {
            "macos-x86_64"
        };
        let mut dirs: Vec<_> = entries
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("openai.chatgpt-")
            })
            .map(|e| e.path().join("bin").join(platform))
            .collect();
        dirs.sort();
        dirs.reverse();
        paths.extend(dirs);
    }
    std::env::join_paths(paths).map_err(|e| e.to_string())
}
async fn start(app: &tauri::AppHandle) -> Result<String, String> {
    if responds(app).await {
        return local_token(app);
    }
    let state = app.state::<Distribution>();
    {
        let mut child = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(process) = child.as_mut() {
            if process.try_wait().map_err(|e| e.to_string())?.is_some() {
                *child = None;
            }
        }
        if child.is_none() {
            // Never launch against an unrelated or unauthenticated listener.
            if std::net::TcpStream::connect_timeout(
                &"127.0.0.1:7431".parse().unwrap(),
                Duration::from_millis(300),
            )
            .is_ok()
            {
                return Err(
                    "Port 7431 is already in use. Stop the other Local Agent or check its token."
                        .into(),
                );
            }
            let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
            let binaries = resources.join("agent-bin").join(std::env::consts::ARCH);
            let executable = binaries.join("prompt-waypoint-agent");
            if !executable.is_file() {
                return Err("Bundled agent is unavailable in this development build. Run deno task agent or build the macOS distribution.".into());
            }
            *child = Some(
                Command::new(executable)
                    .env("PMAI_MANAGED_AGENT", "1")
                    .env("PMAI_AGENT_DIR", directory(app)?)
                    .env("PMAI_AGENT_PORT", "7431")
                    .env(
                        "PMAI_CLAUDE_DISCOVERY_BIN",
                        binaries.join("claude-discovery"),
                    )
                    .env("PATH", provider_path(app)?)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|e| format!("Could not start Local Agent: {e}"))?,
            );
        }
    }
    for _ in 0..50 {
        if responds(app).await {
            return local_token(app);
        }
        {
            let mut child = state.child.lock().map_err(|e| e.to_string())?;
            if let Some(process) = child.as_mut() {
                if process.try_wait().map_err(|e| e.to_string())?.is_some() {
                    *child = None;
                    return Err("Local Agent exited during startup. Check provider configuration and the agent data directory.".into());
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err("Local Agent did not become ready. Retry the connection.".into())
}
#[tauri::command]
pub async fn start_local_agent(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<Distribution>();
    let _guard = state.operation.lock().await;
    start(&app).await
}
async fn stop_for_update(app: &tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<Distribution>();
    let owned = {
        let mut child = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(process) = child.as_mut() {
            if process.try_wait().map_err(|e| e.to_string())?.is_some() {
                *child = None;
            }
        }
        child.is_some()
    };
    if !owned {
        if std::net::TcpStream::connect_timeout(
            &"127.0.0.1:7431".parse().unwrap(),
            Duration::from_millis(300),
        )
        .is_ok()
        {
            return Err("Stop the separately running Local Agent before updating, then restart it with the new version.".into());
        }
        return Ok(false);
    }
    let response = client()?
        .post(format!("{BASE}/lifecycle/drain"))
        .bearer_auth(local_token(app)?)
        .send()
        .await
        .map_err(|_| "Could not prepare Local Agent for update".to_string())?;
    if !response.status().is_success() {
        return Err("Finish or stop active tasks before updating, then try again.".into());
    }
    // Closing the parent pipe asks the agent to flush and exit gracefully.
    if let Some(child) = state.child.lock().map_err(|e| e.to_string())?.as_mut() {
        child.stdin.take();
    }
    for _ in 0..100 {
        {
            let mut child = state.child.lock().map_err(|e| e.to_string())?;
            if let Some(process) = child.as_mut() {
                if process.try_wait().map_err(|e| e.to_string())?.is_some() {
                    *child = None;
                    return Ok(true);
                }
            } else {
                return Ok(true);
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err("Agent shutdown has not completed. Update was postponed; try again shortly.".into())
}
pub fn close_owned_agent(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<Distribution>().child.lock() {
        if let Some(child) = guard.as_mut() {
            child.stdin.take();
        }
    }
}
fn updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let key = option_env!("PMAI_UPDATER_PUBLIC_KEY")
        .filter(|s| !s.trim().is_empty())
        .ok_or("Automatic updates are unavailable in this development build.")?;
    app.updater_builder()
        .pubkey(key.trim())
        .endpoints(vec![UPDATES.parse().unwrap()])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}
#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: String,
}
#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        notes: u.body.unwrap_or_default(),
    }))
}
#[tauri::command]
pub async fn install_app_update(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Distribution>();
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "An agent or update operation is already in progress")?;
    let update = updater(&app)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    let restart_agent = stop_for_update(&app).await?;
    if let Err(error) = update.install(bytes) {
        if restart_agent {
            let _ = start(&app).await;
        }
        return Err(error.to_string());
    }
    let _ = app.emit("update-installed", ());
    app.restart();
}

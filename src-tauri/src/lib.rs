use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn is_socket_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

fn resolve_python_runner() -> Option<(PathBuf, Vec<String>, PathBuf)> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    // Helper para localizar o ambiente de desenvolvimento Python (venv + run.py)
    let find_dev_runner = || -> Option<(PathBuf, Vec<String>, PathBuf)> {
        let api_rel = cwd.join(r"..\Gexcel EVO - api e-fatura");
        let api_dir = if api_rel.exists() {
            api_rel
        } else {
            PathBuf::from(r"C:\DEV\Ecossistema_Gexcel\3_Gexcel_Evo_CRM\Gexcel EVO - api e-fatura")
        };

        if api_dir.exists() {
            let mut py_exe = api_dir.join("venv").join("Scripts").join("python.exe");
            if !py_exe.exists() {
                py_exe = api_dir.join(".venv").join("Scripts").join("python.exe");
            }
            let run_script = api_dir.join("run.py");
            if py_exe.exists() && run_script.exists() {
                return Some((py_exe, vec!["run.py".into()], api_dir));
            }
        }
        None
    };

    // Helper para procurar motor compilado no ecossistema oficial (%LOCALAPPDATA%\GExcelAYD)
    let find_appdata_engine = || -> Option<(PathBuf, Vec<String>, PathBuf)> {
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(local_appdata);
            let candidates = [
                base.join(r"GExcelAYD\gexcelEvo\engines\gevo_ef2026"),
                base.join(r"GExcelAYD\gexcelEvo\engines\efatura"),
                base.join(r"GExcelAYD"),
            ];
            for folder in &candidates {
                for exe_name in &["gevo_ef2026.exe", "gevo_efatura_api.exe"] {
                    let exe_path = folder.join(exe_name);
                    if exe_path.exists() {
                        return Some((exe_path, vec![], folder.clone()));
                    }
                }
            }
        }
        None
    };

    // Helper para procurar executável na pasta da app ou CWD
    let find_local_engine = || -> Option<(PathBuf, Vec<String>, PathBuf)> {
        for dir in &[&exe_dir, &cwd] {
            for exe_name in &["gevo_ef2026.exe", "gevo_efatura_api.exe"] {
                let candidate = dir.join(exe_name);
                if candidate.exists() {
                    return Some((candidate, vec![], (*dir).clone()));
                }
            }
        }
        None
    };

    // 1. Em modo de Desenvolvimento (debug_assertions), priorizar sempre o código-fonte Python (.py)
    #[cfg(debug_assertions)]
    {
        if let Some(dev_runner) = find_dev_runner() {
            return Some(dev_runner);
        }
    }

    // 2. Em Produção ou se o código-fonte não estiver acessível, procurar o executável oficial
    if let Some(appdata_engine) = find_appdata_engine() {
        return Some(appdata_engine);
    }

    if let Some(local_engine) = find_local_engine() {
        return Some(local_engine);
    }

    // 3. Fallback final para ambiente DEV
    find_dev_runner()
}

#[tauri::command]
fn ligar_motor() -> Result<String, String> {
    // 1. Verificar e iniciar Motor Python (porta 8015)
    if !is_socket_open(8015) {
        if let Some((prog, args, work_dir)) = resolve_python_runner() {
            let mut cmd = Command::new(&prog);
            for a in args {
                cmd.arg(a);
            }
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(app_dir) = exe_path.parent() {
                    cmd.env("GEXCEL_APP_DIR", app_dir);
                }
            }
            if let Ok(cwd) = std::env::current_dir() {
                cmd.env("GEXCEL_APP_CWD", cwd);
            }
            cmd.current_dir(&work_dir);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.spawn();
        }
    }

    // 2. Aguardar até 10 segundos pela prontidão do serviço
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(500));
        if is_socket_open(8015) {
            return Ok("Motor e-Fatura operacional na porta 8015!".into());
        }
    }

    Ok("Comando de arranque enviado ao motor.".into())
}

#[tauri::command]
fn verificar_motor() -> bool {
    is_socket_open(8015)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Iniciar o motor em segundo plano no arranque da aplicação Desktop
            std::thread::spawn(|| {
                let _ = ligar_motor();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ligar_motor, verificar_motor])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

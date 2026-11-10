import os
import sys
import paramiko

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def load_env(path):
    env = {}
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    return env


def run_ssh(ssh, cmd):
    print(f">>> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out:
        print(out)
    if err:
        print(f"[STDERR] {err}")
    return exit_status, out, err


def sftp_mkdir_p(sftp, remote_dir):
    dirs = []
    d = remote_dir
    while d and d != '/':
        dirs.append(d)
        d = os.path.dirname(d)
    for folder in reversed(dirs):
        try:
            sftp.stat(folder)
        except IOError:
            try:
                sftp.mkdir(folder)
            except IOError:
                pass


def upload_dir_filtered(sftp, local_dir, remote_dir, skip_dirs=None, allowed_exts=None):
    skip_dirs = set(skip_dirs or [])
    sftp_mkdir_p(sftp, remote_dir)
    for root, dirs, files in os.walk(local_dir):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.')]
        rel = os.path.relpath(root, local_dir)
        target_root = remote_dir if rel == '.' else f"{remote_dir}/{rel.replace(os.sep, '/')}"
        sftp_mkdir_p(sftp, target_root)
        for fname in files:
            if allowed_exts and not fname.lower().endswith(allowed_exts) and fname != '.env':
                continue
            local_path = os.path.join(root, fname)
            remote_path = f"{target_root}/{fname}"
            sftp.put(local_path, remote_path)


def build_caddy_site_block(domain: str, web_root: str) -> str:
    return f"""{domain} {{
    encode zstd gzip

    handle /api/collections/* {{
        reverse_proxy 127.0.0.1:8090
    }}
    handle /api/admins/* {{
        reverse_proxy 127.0.0.1:8090
    }}
    handle /api/superusers/* {{
        reverse_proxy 127.0.0.1:8090
    }}
    handle /api/safedrive* {{
        reverse_proxy 127.0.0.1:8095
    }}
    handle /api/bridge* {{
        reverse_proxy 127.0.0.1:8095
    }}
    handle /api/legacy* {{
        reverse_proxy 127.0.0.1:8095
    }}
    handle /api/* {{
        reverse_proxy 127.0.0.1:8015
    }}
    handle {{
        root * {web_root}
        try_files {{path}} /index.html
        file_server
    }}
}}"""


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    evo_root = os.path.dirname(base_dir)
    evo05_dir = os.path.join(evo_root, 'EVO-05_API_Efatura')
    scr_dir = os.path.join(evo_root, '03.9_SCR_EVO_Scrapers_Gov')

    env = load_env(os.path.join(base_dir, 'deploy.env'))
    host = env.get('HETZNER_HOST')
    user = env.get('HETZNER_USER', 'root')
    pw = env.get('HETZNER_PASS')
    repo = env.get('GITHUB_REPO', 'https://github.com/gexcel2013-svg/gexcel_evo_efatura.git')

    if not host or not pw:
        print("Credenciais Hetzner em falta no deploy.env")
        sys.exit(1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"A ligar a {user}@{host}...")
    ssh.connect(host, username=user, password=pw, timeout=20)
    sftp = ssh.open_sftp()

    # 1. Atualizar código Frontend EVO-06 APENAS no canal DEV (/opt/gexcel/evo06/dev)
    target_dir = "/opt/gexcel/evo06/dev"
    run_ssh(ssh, f"mkdir -p {target_dir}")
    status, out, _ = run_ssh(ssh, f"test -d {target_dir}/.git && echo 'EXISTS' || echo 'NEW'")
    if 'NEW' in out:
        run_ssh(ssh, f"git clone {repo} {target_dir}")
    else:
        run_ssh(ssh, f"cd {target_dir} && git fetch origin && git reset --hard origin/main")

    # 2. Deploy do Motor Backend EVO-05 (:8015) + Scrapers SCR-01..03
    print("A sincronizar motor EVO-05_API_Efatura para /opt/gexcel/evo05...")
    run_ssh(ssh, "mkdir -p /opt/gexcel/evo05 /opt/gexcel/evo05/docs /opt/gexcel/evo05/certs /opt/gexcel/03.9_SCR_EVO_Scrapers_Gov")

    for fname in os.listdir(evo05_dir):
        fpath = os.path.join(evo05_dir, fname)
        if os.path.isfile(fpath) and (fname.endswith('.py') or fname in ('.env', 'requirements.txt')):
            sftp.put(fpath, f"/opt/gexcel/evo05/{fname}")

    wsdl_local = os.path.join(evo05_dir, 'docs', 'fatshareInvoices.wsdl.txt')
    if os.path.exists(wsdl_local):
        sftp.put(wsdl_local, "/opt/gexcel/evo05/docs/fatshareInvoices.wsdl.txt")

    certs_local = os.path.join(evo05_dir, 'certs')
    if os.path.exists(certs_local):
        upload_dir_filtered(
            sftp,
            certs_local,
            "/opt/gexcel/evo05/certs",
            skip_dirs={'__pycache__'},
            allowed_exts=('.cer', '.pem', '.key', '.pfx', '.crt', '.p7b'),
        )

    for scr_sub in ('SCR-01_Logins_Gov', 'SCR-02_Scrap_Efatura', 'SCR-03_Scrap_RecibosVerdes'):
        sub_local = os.path.join(scr_dir, scr_sub)
        if os.path.exists(sub_local):
            upload_dir_filtered(
                sftp,
                sub_local,
                f"/opt/gexcel/03.9_SCR_EVO_Scrapers_Gov/{scr_sub}",
                skip_dirs={'__pycache__', '.venv', 'venv', 'node_modules', '.git', 'build', 'dist'},
                allowed_exts=('.py', '.json'),
            )

    # 3. Garantir dependências Python e serviço systemd gevo-evo05-efatura.service (:8015)
    run_ssh(
        ssh,
        "/opt/gexcel/evo07/venv/bin/pip install -q zeep lxml cryptography python-dotenv requests fastapi uvicorn psutil requests-file requests-toolbelt isodate platformdirs"
    )

    service_unit = """[Unit]
Description=evoGex.com-05 API e-Fatura, Recibos Verdes e Anulados (Porta 8015)
After=network.target gevo-evo12-pb.service

[Service]
Type=simple
WorkingDirectory=/opt/gexcel/evo05
Environment="PYTHONUNBUFFERED=1"
Environment="PORT=8015"
LimitNOFILE=65536
ExecStart=/opt/gexcel/evo07/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8015
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
    with sftp.open('/etc/systemd/system/gevo-evo05-efatura.service', 'w') as f:
        f.write(service_unit)

    run_ssh(ssh, "systemctl daemon-reload && systemctl enable gevo-evo05-efatura.service && systemctl restart gevo-evo05-efatura.service")

    sftp.close()
    run_ssh(ssh, "systemctl reload caddy")

    # 4. Validar serviço :8015 e endpoint DEV
    run_ssh(ssh, "sleep 1 && systemctl is-active gevo-evo05-efatura.service")
    run_ssh(ssh, "curl -s https://dev.efatura.evogex.com/api/entidades | head -c 250")
    ssh.close()
    print("\nDeploy Hetzner no canal DEV (dev.efatura.evogex.com) concluído com sucesso!")


if __name__ == '__main__':
    main()

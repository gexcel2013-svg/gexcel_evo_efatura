import os
import sys
import paramiko

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

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

    # 1. Preparar diretórios dev, beta e stable para EVO-06 (Importador e-Fatura)
    for env_name in ['dev', 'beta', 'stable']:
        target_dir = f"/opt/gexcel/evo06/{env_name}"
        run_ssh(ssh, f"mkdir -p {target_dir}")
        status, out, _ = run_ssh(ssh, f"test -d {target_dir}/.git && echo 'EXISTS' || echo 'NEW'")
        if 'NEW' in out:
            run_ssh(ssh, f"git clone {repo} {target_dir}")
        else:
            run_ssh(ssh, f"cd {target_dir} && git fetch origin && git reset --hard origin/main")

    # 2. Garantir entradas Caddy para dev.efatura.gexcelapps.com, beta.efatura.gexcelapps.com e efatura.gexcelapps.com
    _, caddy_content, _ = run_ssh(ssh, "cat /etc/caddy/Caddyfile")
    if "efatura.gexcelapps.com" not in caddy_content:
        caddy_block = """

# ==========================================================
# EVO-06: GEXCEL IMPORTADOR E-FATURA, RECIBOS VERDES & ANULADOS
# ==========================================================
dev.efatura.gexcelapps.com {
    root * /opt/gexcel/evo06/dev/dist
    encode zstd gzip
    file_server
    try_files {path} /index.html
}

beta.efatura.gexcelapps.com {
    root * /opt/gexcel/evo06/beta/dist
    encode zstd gzip
    file_server
    try_files {path} /index.html
}

efatura.gexcelapps.com {
    root * /opt/gexcel/evo06/stable/dist
    encode zstd gzip
    file_server
    try_files {path} /index.html
}
"""
        sftp = ssh.open_sftp()
        with sftp.open('/etc/caddy/Caddyfile', 'w') as f:
            f.write(caddy_content.rstrip() + "\n" + caddy_block)
        sftp.close()
        run_ssh(ssh, "systemctl reload caddy")
    else:
        print("Domínios *.efatura.gexcelapps.com já configurados no Caddyfile.")
        run_ssh(ssh, "systemctl reload caddy")

    # 3. Validar ficheiros servidos
    run_ssh(ssh, "ls -lh /opt/gexcel/evo06/stable/dist/index.html /opt/gexcel/evo06/dev/dist/index.html")
    ssh.close()
    print("Deploy Hetzner de EVO-06 concluído com sucesso!")

if __name__ == '__main__':
    main()

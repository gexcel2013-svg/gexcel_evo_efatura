import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { spawn } from 'child_process';
import path from 'path';
import net from 'net';
import fs from 'fs';

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

function gexcelMotorPlugin(): Plugin {
  return {
    name: 'gexcel-motor-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/motor/ligar' && (req.method === 'POST' || req.method === 'GET')) {
          res.setHeader('Content-Type', 'application/json');
          try {
            // 1. Verificar e iniciar Motor Python (8015) se desligado
            const motorRunning = await isPortOpen(8015);
            if (!motorRunning) {
              const apiDir = path.resolve(process.cwd(), '../EVO-05_API_Efatura');
              let pyExe = path.join(apiDir, 'venv/Scripts/python.exe');
              if (!fs.existsSync(pyExe)) {
                pyExe = path.join(apiDir, '.venv/Scripts/python.exe');
              }

              if (fs.existsSync(pyExe)) {
                console.log('[GEXCEL MOTOR] A iniciar Motor Python (:8015) via:', pyExe);
                const apiProc = spawn(pyExe, ['run.py'], {
                  cwd: apiDir,
                  detached: true,
                  stdio: 'ignore',
                  windowsHide: true,
                });
                apiProc.unref();
              } else {
                console.warn('[GEXCEL MOTOR] python.exe nao encontrado em:', apiDir);
              }
            }

            // 3. Aguardar até 10 segundos pela prontidão dos serviços
            let motorReady = false;
            for (let i = 0; i < 20; i++) {
              await new Promise((r) => setTimeout(r, 500));
              if (await isPortOpen(8015)) {
                motorReady = true;
                break;
              }
            }

            res.end(
              JSON.stringify({
                success: true,
                motor_online: motorReady,
                message: motorReady
                  ? 'Motor e-Fatura operacional!'
                  : 'Comando de arranque enviado ao motor.',
              })
            );
          } catch (err: unknown) {
            res.statusCode = 500;
            const message = err instanceof Error ? err.message : String(err);
            res.end(JSON.stringify({ success: false, error: message }));
          }
          return;
        }

        if (req.url === '/api/motor/status' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          const motor = await isPortOpen(8015);
          res.end(JSON.stringify({ motor, pocketbase: true }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), gexcelMotorPlugin()],
});

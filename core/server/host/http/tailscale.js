import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

// Read-only view of the local Tailscale client: its MagicDNS name and whether
// `tailscale serve` already forwards HTTPS to the QuizForge connection port.
// QuizForge never changes Tailscale settings itself.
const run = promisify(execFile);
const WINDOWS_PATH = 'C:\\Program Files\\Tailscale\\tailscale.exe';
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}\.)+ts\.net$/;

export function tailscaleCommand(platform = process.platform, exists = existsSync) {
  return platform === 'win32' && exists(WINDOWS_PATH) ? WINDOWS_PATH : 'tailscale';
}

// Interpret `tailscale status --json` and `tailscale serve status --json`.
export function parseTailscale(statusText, serveText, port) {
  let status;
  try { status = JSON.parse(statusText); } catch { return { state: 'unavailable' }; }
  if (status?.BackendState !== 'Running') return { state: 'stopped' };
  const name = typeof status.Self?.DNSName === 'string' ? status.Self.DNSName.replace(/\.$/, '').toLowerCase() : '';
  if (!NAME.test(name)) return { state: 'stopped' };
  const ips = (Array.isArray(status.Self?.TailscaleIPs) ? status.Self.TailscaleIPs : []).filter(ip => typeof ip === 'string' && /^100\.|^fd7a:115c:a1e0:/i.test(ip));
  let serve = null;
  try { serve = JSON.parse(serveText || '{}'); } catch { serve = null; }
  const targets = [];
  for (const [address, site] of Object.entries(serve?.Web || {})) {
    const [host, httpsPort = '443'] = address.toLowerCase().split(':');
    const proxy = site?.Handlers?.['/']?.Proxy;
    if (host !== name || typeof proxy !== 'string') continue;
    const match = /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\/?$/i.exec(proxy.trim());
    if (match) targets.push({ httpsPort, port: Number(match[1]) });
  }
  const served = targets.find(target => target.port === port);
  const url = served ? `https://${name}${served.httpsPort === '443' ? '' : ':' + served.httpsPort}/` : null;
  return { state: 'running', name, ips, url, otherPort: served ? null : targets[0]?.port ?? null };
}

export class TailscaleProbe {
  constructor({ command = tailscaleCommand(), execute = run, ttl = 30000 } = {}) { this.command = command; this.execute = execute; this.ttl = ttl; this.value = { state: 'unavailable' }; this.at = 0; this.pending = null; }
  async read(port, { force = false } = {}) {
    if (!force && this.pending) return this.pending;
    if (!force && Date.now() - this.at < this.ttl && this.port === port) return this.value;
    const options = { windowsHide: true, timeout: 4000, maxBuffer: 1024 * 1024, encoding: 'utf8' };
    this.pending = (async () => {
      let next;
      try {
        const status = await this.execute(this.command, ['status', '--json'], options);
        const serve = await this.execute(this.command, ['serve', 'status', '--json'], options).catch(() => ({ stdout: '{}' }));
        next = parseTailscale(status.stdout, serve.stdout, port);
      } catch (error) {
        // Not installed (ENOENT) and a stopped client both leave no usable address.
        next = { state: error?.code === 'ENOENT' ? 'missing' : 'stopped' };
      }
      this.value = next; this.port = port; this.at = Date.now(); return next;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}

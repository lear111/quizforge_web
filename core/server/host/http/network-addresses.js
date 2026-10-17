import net from 'node:net';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export function ipv6Bytes(host) {
  let value = host.replace(/^\[|\]$/g, '').toLowerCase(); if (net.isIP(value) !== 6 || value.includes('%')) return null;
  if (value.includes('.')) { const point = value.lastIndexOf(':'), ipv4 = value.slice(point + 1).split('.').map(Number); value = value.slice(0, point + 1) + ((ipv4[0] << 8) | ipv4[1]).toString(16) + ':' + ((ipv4[2] << 8) | ipv4[3]).toString(16); }
  const [first, second] = value.split('::'), left = first ? first.split(':') : [], right = second ? second.split(':') : [], words = second === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right], bytes = Buffer.alloc(16);
  if (words.length !== 8) return null; for (let i = 0; i < 8; i++) bytes.writeUInt16BE(parseInt(words[i], 16), 2 * i); return bytes;
}
export function hostKey(host) {
  if (typeof host !== 'string' || host.includes('%')) return null; const value = host.replace(/^\[|\]$/g, '').toLowerCase(); if (!value.includes(':')) return value;
  const bytes = ipv6Bytes(value); if (!bytes) return null;
  if (bytes.subarray(0, 10).every(byte => byte === 0) && bytes.readUInt16BE(10) === 0xffff) return [...bytes.subarray(12)].join('.');
  return bytes.toString('hex');
}
export const sameHost = (left, right) => hostKey(left) !== null && hostKey(left) === hostKey(right);
export const url = (host, port, scheme = 'http') => `${scheme}://${host.includes(':') ? '[' + host.replace(/^\[|\]$/g, '') + ']' : host}:${port}/`;
export function privateAddress(address) {
  const value = hostKey(address); if (!value) return false;
  if (net.isIP(value) === 4) { const [a, b] = value.split('.').map(Number); return a === 127 || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254; }
  const bytes = ipv6Bytes(address); return bytes !== null && (value === hostKey('::1') || (bytes[0] & 0xfe) === 0xfc || bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80);
}
export function interfaceAddresses() { return Object.entries(os.networkInterfaces()).flatMap(([interfaceName,entries])=>(entries||[]).map(entry=>({...entry,interfaceName}))); }
let adapterCache=null,adapterExpires=0;
export function displayAdapterMetadata(){
  if(process.platform!=='win32')return Promise.resolve(null);
  if(adapterCache&&Date.now()<adapterExpires)return adapterCache;
  adapterExpires=Date.now()+60000;
  const command="[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @{adapters=@(Get-CimInstance Win32_NetworkAdapter -Filter 'NetConnectionStatus = 2' | ForEach-Object { @{name=$_.NetConnectionID;up=$true;physical=([bool]$_.PhysicalAdapter -and $_.PNPDeviceID -notmatch '^(ROOT|SWD)\\\\');index=$_.InterfaceIndex} });routes=@(Get-CimInstance Win32_IP4RouteTable -Filter \"Destination = '0.0.0.0'\" | ForEach-Object { @{index=$_.InterfaceIndex;metric=$_.Metric1} })} | ConvertTo-Json -Depth 4 -Compress";
  adapterCache=promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:5000,maxBuffer:256*1024,encoding:'utf8'}).then(({stdout})=>JSON.parse(stdout)).catch(()=>null);
  return adapterCache;
}
export function recommendedAddresses(entries,metadata=null){
  const valid=entries.filter(entry=>!entry.internal&&net.isIP(entry.address.split('%')[0])&&!entry.address.startsWith('169.254.')&&!entry.address.includes('%')&&!/^fe[89ab]|^ff/i.test(entry.address));
  const virtual=/vmware|vmnet|virtual|vethernet|hyper-v|wsl|docker|vbox|tailscale|mihomo|zerotier|hamachi|loopback|(?:^|[\s_-])(?:tun|tap|utun)\d*/i;
  const adapters=Array.isArray(metadata?.adapters)?metadata.adapters:null;
  let candidates=valid.filter(entry=>!virtual.test(entry.interfaceName||'')&&(!adapters||adapters.some(adapter=>adapter.name===entry.interfaceName&&adapter.up===true&&adapter.physical===true)));
  const metric=name=>{const adapter=adapters?.find(value=>value.name===name);const routes=Array.isArray(metadata?.routes)?metadata.routes:[];return Math.min(...routes.filter(route=>route.index===adapter?.index).map(route=>Number(route.metric)||0),Infinity);};
  const names=[...new Set(candidates.map(entry=>entry.interfaceName))].sort((a,b)=>metric(a)-metric(b)||Number(!/wlan|wi-?fi|ethernet|以太网|^eth|^en/i.test(a||''))-Number(!/wlan|wi-?fi|ethernet|以太网|^eth|^en/i.test(b||''))||String(a).localeCompare(String(b)));
  candidates=candidates.filter(entry=>entry.interfaceName===names[0]);
  const ipv4=candidates.find(entry=>net.isIP(entry.address)===4);
  const ipv6=candidates.filter(entry=>net.isIP(entry.address)===6).sort((a,b)=>Number(!/^[23]/.test(a.address))-Number(!/^[23]/.test(b.address))||a.address.localeCompare(b.address))[0];
  return [ipv4,ipv6].filter(Boolean);
}
export function sameIpv6Subnet(local, remote, prefix) { const left = ipv6Bytes(local), right = ipv6Bytes(remote); if (!left || !right || prefix < 64 || prefix > 128) return false; for (let i = 0; i < prefix; i++) { const mask = 1 << (7 - i % 8); if ((left[Math.floor(i / 8)] & mask) !== (right[Math.floor(i / 8)] & mask)) return false; } return true; }
export function ipv6Available() { return new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(0, '::1', () => server.close(() => resolve(true))); }); }

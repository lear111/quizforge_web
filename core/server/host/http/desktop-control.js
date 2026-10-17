// Tells the launcher why startup failed, as one readable line for its status.
export function reportDesktopFailure(reason, output = process.stdout) {
  const text = String(reason).replace(/[\r\n]+/g, ' ').slice(0, 300);
  output.write('QUIZFORGE_DESKTOP ' + JSON.stringify({ event: 'failed', pid: process.pid, reason: text }) + '\n');
}

// A private pipe owned by the desktop launcher, never an HTTP shutdown route.
export class DesktopControl {
  constructor(stop, { input = process.stdin, output = process.stdout } = {}) {
    this.input = input; this.output = output; this.stop = stop;
    this.buffer = ''; this.requested = false; this.armed = false;
    this.data = chunk => {
      this.buffer += chunk.toString('utf8');
      if (this.buffer.length > 1024) return this.requestStop();
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const command = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
        if (command === 'quit') this.requestStop();
      }
    };
    this.end = () => this.requestStop();
    input.on('data', this.data); input.once('end', this.end); input.once('error', this.end);
    output.on('error', this.end);
  }
  requestStop() {
    if (this.requested) return;
    this.requested = true;
    if (this.armed) this.stop();
  }
  arm(service) {
    this.armed = true;
    if (this.requested) { this.stop(); return; }
    this.output.write('QUIZFORGE_DESKTOP ' + JSON.stringify({ event: 'ready', pid: process.pid, port: service.port() }) + '\n');
  }
  dispose() {
    this.input.off('data', this.data); this.input.off('end', this.end); this.input.off('error', this.end);
    this.output.off('error', this.end);
    this.input.pause();
  }
}

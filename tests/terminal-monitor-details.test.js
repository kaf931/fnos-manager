import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMonitor } from '../server/terminal/monitor.js';
function sample(n = 0) {
  return `cpu ${100 + n * 20} 0 50 ${850 + n * 80} 0 0 0 0\ncpu0 ${100 + n * 20} 0 50 ${850 + n * 80} 0 0 0 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 500 kB\nSwapFree: 400 kB\n__DISK__\n/dev/sda ext4 100 40 60 40% /\n__HOST__\nserver-a\nadmin\n6.8.0\n__OS__\nPRETTY_NAME="Test Linux 1.0"\n__UPTIME__\n86461.0 100\n__LOAD__\n0.5 0.3 0.1 1/100 123\n__NET__\neth0: ${1000 + n * 300} 1 0 0 0 0 0 0 ${2000 + n * 600} 1 0 0 0 0 0 0\nlo: 50 1 0 0 0 0 0 0 50 1 0 0 0 0 0 0\n__ADDR__\n2: eth0 inet 192.168.1.2/24 brd 192.168.1.255 scope global eth0\n2: eth0 inet6 fe80::1/64 scope link\n__PROCESS__\n123 5.5 1024 worker name\n999 0.1 512 sshd\n`;
}
test('details include host, swap, load, cores and bounded process names without arguments', () => {
  const first = parseMonitor(sample());
  assert.equal(first.host.name, 'server-a');
  assert.equal(first.host.system, 'Test Linux 1.0');
  assert.equal(first.host.uptime, 86461);
  assert.equal(first.swap.percent, 20);
  assert.equal(first.cpu.cores.length, 1);
  assert.deepEqual(first.load, [0.5, 0.3, 0.1]);
  assert.equal(first.processes[0].name, 'worker name');
  assert.equal(first.processes[0].memory, 1048576);
  assert.equal(first.network[0].addresses[0], '192.168.1.2');
});
test('per-core and network rates use each session previous counters and handle resets', () => {
  const first = parseMonitor(sample());
  first.sampledAt -= 3000;
  const next = parseMonitor(sample(1), first);
  assert.equal(next.cpu.cores[0].percent, 20);
  assert.ok(next.network[0].receiveRate > 90 && next.network[0].receiveRate <= 100);
  assert.ok(next.network[0].transmitRate > 190 && next.network[0].transmitRate <= 200);
  const reset = parseMonitor(sample(0), next);
  assert.equal(reset.network[0].receiveRate, null);
});

test('process samples retain distinct CPU and memory ranking candidates with bounded output', () => {
  const candidates = Array.from(
    { length: 25 },
    (_, i) => `${i + 1} ${25 - i}.0 ${i + 1} process-${i + 1}`,
  );
  const data = parseMonitor(
    sample().split('__PROCESS__')[0] + '__PROCESS__\n' + [candidates[0], ...candidates].join('\n'),
  );
  assert.equal(data.processes.length, 20);
  assert.equal(new Set(data.processes.map((p) => p.pid)).size, 20);
  assert.equal(data.processes.at(-1).pid, 20);
});

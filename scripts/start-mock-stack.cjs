const { spawn } = require('child_process');

const core = spawn(process.execPath, ['/scripts/mock-graph.cjs'], {
  stdio: 'inherit',
  env: { ...process.env, MOCK_PORT: '9998' },
});

const proxy = spawn(process.execPath, ['/scripts/mock-graph-compat-proxy.cjs'], {
  stdio: 'inherit',
  env: { ...process.env, MOCK_CORE_PORT: '9998', MOCK_PORT: '9999' },
});

function stop() {
  core.kill('SIGTERM');
  proxy.kill('SIGTERM');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
core.on('exit', (code) => {
  proxy.kill('SIGTERM');
  process.exit(code || 0);
});
proxy.on('exit', (code) => {
  core.kill('SIGTERM');
  process.exit(code || 0);
});

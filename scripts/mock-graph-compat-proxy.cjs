const http = require('http');

const TARGET_PORT = Number(process.env.MOCK_CORE_PORT || 9998);
const LISTEN_PORT = Number(process.env.MOCK_PORT || 9999);

function rewritePath(path) {
  if (path.includes('act_partial_success')) {
    return { path: path.replaceAll('act_partial_success', 'act_partial'), state: 'success' };
  }
  if (path.includes('act_partial_fail_page_2')) {
    return { path: path.replaceAll('act_partial_fail_page_2', 'act_partial'), state: 'fail_page_2' };
  }
  return { path, state: null };
}

function setPartialState(state, callback) {
  if (!state) return callback();
  const request = http.get({ hostname: '127.0.0.1', port: TARGET_PORT, path: `/set_partial_state?state=${state}` }, (response) => {
    response.resume();
    response.on('end', callback);
  });
  request.on('error', callback);
}

const server = http.createServer((req, res) => {
  const rewritten = rewritePath(req.url);
  setPartialState(rewritten.state, () => {
    const proxy = http.request({
      hostname: '127.0.0.1',
      port: TARGET_PORT,
      path: rewritten.path,
      method: req.method,
      headers: req.headers,
    }, (upstream) => {
      res.writeHead(upstream.statusCode || 500, upstream.headers);
      upstream.pipe(res);
    });

    proxy.on('error', () => {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'mock proxy unavailable' }));
    });
    req.pipe(proxy);
  });
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Mock compatibility proxy running on port ${LISTEN_PORT}`);
});

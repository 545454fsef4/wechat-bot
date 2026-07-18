import http from 'http';

const body = JSON.stringify({contact: '刘栩丞', message: '测试消息'});
const opts = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/send',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = http.request(opts, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
    try {
      const parsed = JSON.parse(data);
      console.log('Parsed:', parsed);
    } catch(e) {
      console.log('Raw:', data);
    }
  });
});
req.on('error', (err) => console.error('Error:', err.message));
req.write(body);
req.end();

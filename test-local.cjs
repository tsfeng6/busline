const { execSync } = require('child_process');
try {
  execSync('export NODE_ENV=production && export PORT=4000 && node dist/server.cjs & sleep 2 && curl http://127.0.0.1:4000/api/health', { stdio: 'inherit', shell: '/bin/bash' });
} catch (e) {
  console.log(e);
}

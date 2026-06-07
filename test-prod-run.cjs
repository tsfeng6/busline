const { execSync } = require('child_process');
try {
  execSync('cd dist-prod && export NODE_ENV=production && export PORT=9000 && node dist/server.cjs & sleep 2 && curl http://127.0.0.1:9000/api/health', { stdio: 'inherit', shell: '/bin/bash' });
} catch (e) {
  console.log(e);
}

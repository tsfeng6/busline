const { execSync } = require('child_process');
try {
  execSync('du -sh dist-prod/node_modules', { stdio: 'inherit', shell: '/bin/bash' });
} catch (e) {
  console.log(e);
}

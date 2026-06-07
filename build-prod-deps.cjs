const { execSync } = require('child_process');
try {
  execSync('rm -rf dist-prod && mkdir dist-prod && cp package.json dist-prod/ && cd dist-prod && npm install --omit=dev --no-package-lock', { stdio: 'inherit', shell: '/bin/bash' });
} catch (e) {
  console.log(e);
}

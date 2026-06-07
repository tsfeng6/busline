const { execSync } = require('child_process');
try {
  execSync('cp -r dist dist-prod/ && cp scf_bootstrap dist-prod/ && cp firebase-applet-config.json dist-prod/ && cd dist-prod && npx -y bestzip ../deploy.zip *', { stdio: 'inherit', shell: '/bin/bash' });
} catch (e) {
  console.log(e);
}

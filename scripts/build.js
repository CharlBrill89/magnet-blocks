// Assemble the deployable site into _site/: `node scripts/build.js`
// Stamps script URLs with the commit hash so browsers never mix a cached old script with a new page.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const FILES = ['index.html', 'game.js', 'geometry.js'];

function commitHash() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (sha) return sha.slice(0, 8);
  try { return execSync('git rev-parse --short=8 HEAD', { cwd: ROOT }).toString().trim(); } catch { return String(Date.now()); }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));

const version = commitHash();
const indexPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const stamped = html.replace(/\?v=dev/g, `?v=${version}`);
if (!stamped.includes(`?v=${version}`)) throw new Error('No ?v=dev script URLs found in index.html to stamp');
fs.writeFileSync(indexPath, stamped);
console.log(`Built _site/ (v=${version})`);

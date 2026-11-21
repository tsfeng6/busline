import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveRepoUrl, authenticatedUrl, redact } from '../scripts/publish-city-static';

function makeGitRepo(withOrigin: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'busline-publish-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'x.txt'), 'x');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  if (withOrigin) execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/tsfeng6/busline.git'], { cwd: dir });
  return dir;
}

test('authenticatedUrl injects token only when present', () => {
  assert.equal(authenticatedUrl('https://github.com/a/b.git', undefined), 'https://github.com/a/b.git');
  assert.equal(authenticatedUrl('https://github.com/a/b.git', 'SECRET'), 'https://x-access-token:SECRET@github.com/a/b.git');
});

test('redact removes the token from log text', () => {
  assert.equal(redact('https://x-access-token:SECRET@github.com/a/b.git', 'SECRET'), 'https://x-access-token:[REDACTED]@github.com/a/b.git');
  assert.equal(redact('no token here', 'SECRET'), 'no token here');
  assert.equal(redact('plain text', undefined), 'plain text');
});

test('resolveRepoUrl prefers an existing origin remote', () => {
  const dir = makeGitRepo(true);
  try {
    assert.deepEqual(resolveRepoUrl(process.env, dir), { url: 'https://github.com/tsfeng6/busline.git', via: 'origin' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveRepoUrl uses Vercel env when no origin remote exists', () => {
  const dir = makeGitRepo(false);
  try {
    const env = { ...process.env, VERCEL_GIT_REPO_OWNER: 'tsfeng6', VERCEL_GIT_REPO_SLUG: 'busline' };
    assert.deepEqual(resolveRepoUrl(env, dir), { url: 'https://github.com/tsfeng6/busline.git', via: 'vercel-env' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveRepoUrl falls back to default when no remote and no Vercel env', () => {
  const dir = makeGitRepo(false);
  try {
    const env = { ...process.env };
    delete env.VERCEL_GIT_REPO_OWNER;
    delete env.VERCEL_GIT_REPO_SLUG;
    assert.deepEqual(resolveRepoUrl(env, dir), { url: 'https://github.com/tsfeng6/busline.git', via: 'default' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

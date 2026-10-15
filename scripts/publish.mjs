import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const urls = {
  gitee: 'https://gitee.com/larria/Voyah-Courage-3D-ThreeJS.git',
  github: 'https://github.com/larria/Voyah-Courage-3D-threejs.git',
};
const completed = [];
let temporary;
function run(command, args, cwd = root, capture = false, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return capture ? result.stdout.trim() : '';
}
const git = (args, cwd = root, capture = false) => run('git', args, cwd, capture);
function assertClean() {
  if (git(['symbolic-ref', '--short', 'HEAD'], root, true) !== 'main') throw new Error('Publish requires the main branch.');
  if (git(['status', '--porcelain', '--untracked-files=all'], root, true)) throw new Error('Publish requires a clean, committed main (including untracked files). Commit source changes yourself first.');
}

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22)) throw new Error('Vite 8 requires Node 20.19+ or 22.12+.');
  if (git(['rev-parse', '--show-toplevel'], root, true) !== root) throw new Error('The project root must be the Git repository root.');
  assertClean();
  const sha = git(['rev-parse', '--verify', 'HEAD^{commit}'], root, true);
  // Reject alternate push URLs and multiple URLs: never publish to an unexpected destination.
  for (const [remote, expected] of Object.entries(urls)) {
    for (const mode of [[], ['--push']]) {
      const actual = git(['remote', 'get-url', ...mode, '--all', remote], root, true);
      if (actual !== expected) throw new Error(`${remote} fetch/push URL must be exactly ${expected}; got ${actual}`);
    }
  }
  temporary = mkdtempSync(join(tmpdir(), 'voyah-publish-'));
  // Fetch both main branches and verify ancestry before ANY push.
  for (const remote of Object.keys(urls)) {
    const ref = `refs/remotes/${remote}/main`;
    const heads = git(['ls-remote', '--heads', remote], root, true);
    if (heads.split('\n').some(line => line.endsWith('\trefs/heads/main'))) {
      git(['fetch', '--no-tags', remote, `+refs/heads/main:${ref}`]);
      git(['merge-base', '--is-ancestor', ref, sha]);
    } else if (heads) {
      throw new Error(`${remote} has existing branches but no main; reconcile its history before publishing.`);
    }
  }
  run('npm', ['--prefix', 'web', 'run', 'build'], root, false, { ...process.env, PAGES_BASE: '/Voyah-Courage-3D-threejs/' });
  const dist = join(root, 'web', 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Build did not produce web/dist/index.html.');
  assertClean();
  if (git(['rev-parse', 'HEAD'], root, true) !== sha) throw new Error('Source HEAD changed during build.');

  // Prepare Pages locally before source pushes. Clone preserves existing gh-pages history.
  const pages = join(temporary, 'pages');
  git(['clone', '--no-checkout', urls.github, pages]);
  const pagesHead = git(['ls-remote', '--heads', urls.github, 'refs/heads/gh-pages'], root, true);
  if (pagesHead) {
    git(['fetch', '--no-tags', 'origin', 'refs/heads/gh-pages:refs/remotes/origin/gh-pages'], pages);
    git(['checkout', '-b', 'gh-pages', 'refs/remotes/origin/gh-pages'], pages);
  } else {
    git(['checkout', '--orphan', 'gh-pages'], pages);
  }
  for (const entry of readdirSync(pages)) {
    if (entry !== '.git') rmSync(join(pages, entry), { recursive: true, force: true });
  }
  for (const entry of readdirSync(dist)) {
    if (entry === '.git') throw new Error('Unexpected .git entry in build output.');
    cpSync(join(dist, entry), join(pages, entry), { recursive: true });
  }
  writeFileSync(join(pages, '.nojekyll'), '');
  // Use the source repo identity, including repo-local Git configuration.
  for (const key of ['user.name', 'user.email']) git(['config', key, git(['config', '--get', key], root, true)], pages);
  git(['add', '--all'], pages);
  if (git(['status', '--porcelain'], pages, true)) {
    git(['commit', '-m', `Deploy source ${sha}\n\nSource-Commit: ${sha}\nCo-Authored-By: Claude <noreply@anthropic.com>`], pages);
  } else {
    console.log('Pages output unchanged; preserving existing deployment commit.');
  }
  for (const remote of ['gitee', 'github']) {
    git(['push', remote, `${sha}:refs/heads/main`]);
    completed.push(`${remote} main (${sha})`);
    console.log(`SUCCESS: ${completed.at(-1)}`);
  }
  git(['push', 'origin', 'HEAD:refs/heads/gh-pages'], pages);
  completed.push('github gh-pages');
  console.log('SUCCESS: github gh-pages');
  console.log('Publish complete: https://larria.github.io/Voyah-Courage-3D-threejs/');
} catch (error) {
  console.error(`Publish failed: ${error.message}`);
  console.error(`Partial success: ${completed.length ? completed.join('; ') : 'none (no successful pushes recorded)'}. Successful pushes are not rolled back; resolve the failure and rerun npm run publish.`);
  process.exitCode = 1;
} finally {
  if (temporary) {
    try { rmSync(temporary, { recursive: true, force: true }); }
    catch (error) { console.error(`Temporary directory cleanup failed (${temporary}): ${error.message}`); process.exitCode = 1; }
  }
}

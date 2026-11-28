'use strict';
/**
 * ADR-0021：Gate2 签名重绑判定。
 *
 * 问题：仓库启用 strict（head 必须与 base 同步才能合入）。合入任一 PR 后 base 前进，
 * 其余 PR 全部 BEHIND；更新分支会换 head，而 gate=2 签名绑定 headRefOid，
 * 于是同一份改动要作者反复重新签字。
 *
 * 判定语义：授权针对的是「这份改动」，不是「这个 commit id」。
 * 若 head 变了，但本 PR 相对 base 的改动指纹（patch-id）完全一致，
 * 则既有签名继续有效；任何内容改动（含冲突手工解决、仅空白/缩进调整）都会改变指纹，
 * 天然 fail-closed 回到重新签字。
 *
 * 边界：本模块只做判定，不产生、不伪造任何授权记录；审计行由调用方打印。
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const MAX_DIFF_BYTES = 256 * 1024 * 1024;

function runGit(cwd, args, input) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: MAX_DIFF_BYTES,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    });
  } catch (_) {
    return null;
  }
}

function isCommit(cwd, sha) {
  if (!sha) return false;
  return runGit(cwd, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]) !== null;
}

function mergeBase(cwd, base, sha) {
  const out = runGit(cwd, ['merge-base', base, sha]);
  const mb = out === null ? '' : out.trim();
  return mb || null;
}

/**
 * 本 PR 相对 base 的改动指纹。
 * - 用 merge-base(base, sha) 做三点等价比较，等价于 GitHub 的 base...head。
 * - `git diff -U0`：剥掉 hunk 上下文行，只留增删行 —— base 前进导致同一改动在文件里
 *   位移时，行号与上下文变化不影响指纹。
 * - `patch-id --verbatim`：保留空白。**不能用 `--stable`**：它把空白归一化掉，
 *   于是「签署后只做格式化/缩进调整」会被判成同一份改动而复用旧签名 —— 而四空格在
 *   Markdown 里就是代码块、在 YAML/Makefile 里能直接改变语义。
 * - 逐行取指纹列（第 2 列是 commit id，两个 head 必然不同，不能进哈希）后整体摘要，
 *   避免多段 diff 时只看第一段而让不同改动撞指纹。
 * - 空改动返回 null（不构成可重绑的交付）。
 */
function changePatchId(cwd, base, sha) {
  if (!isCommit(cwd, sha)) return null;
  const mb = mergeBase(cwd, base, sha);
  if (!mb) return null;
  const diff = runGit(cwd, ['diff', '-U0', mb, sha], '');
  if (diff === null || !diff.trim()) return null;
  const out = runGit(cwd, ['patch-id', '--verbatim'], diff);
  if (out === null) return null;
  const ids = out.trim().split('\n')
    .map((line) => line.trim().split(/\s+/)[0] || '')
    .filter(Boolean);
  if (ids.length === 0) return null;
  return crypto.createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');
}

/**
 * 新旧 head 是否承载同一份改动。baseRef 由调用方给完整 ref（如 origin/main）。
 */
function sameChange({ cwd, baseRef, signedHead, currentHead }) {
  if (!cwd || !baseRef || !signedHead || !currentHead) return false;
  if (signedHead === currentHead) return true;
  const signedId = changePatchId(cwd, baseRef, signedHead);
  if (!signedId) return false;
  const currentId = changePatchId(cwd, baseRef, currentHead);
  return Boolean(currentId) && signedId === currentId;
}

function main(argv) {
  const [cmd, baseRef, signedHead, currentHead] = argv;
  const cwd = process.env.LOOPX_REPO_ROOT || process.cwd();
  if (cmd === 'same-change') {
    // base 前进后本地可能还没有新 base：抓一次，抓不到就按失败处理（fail-closed）。
    runGit(cwd, ['fetch', '--quiet', 'origin', String(baseRef || '').replace(/^origin\//, '')]);
    process.exit(sameChange({ cwd, baseRef, signedHead, currentHead }) ? 0 : 1);
  }
  if (cmd === 'patch-id') {
    const id = changePatchId(cwd, baseRef, signedHead);
    if (!id) process.exit(1);
    process.stdout.write(`${id}\n`);
    process.exit(0);
  }
  process.stderr.write('用法: gate2-rebind.js same-change <baseRef> <signedHead> <currentHead>\n');
  process.exit(2);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { changePatchId, sameChange, mergeBase, isCommit };

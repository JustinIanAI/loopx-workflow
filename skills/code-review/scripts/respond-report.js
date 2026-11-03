#!/usr/bin/env node
'use strict';
/**
 * respond-report.js — LoopX 原生评审报告的逐项闭环回复生成器
 *
 * 设计基线（AGENTS.md 铁律 7）：
 *   - 评审/回复报告格式以 `loopx pr-review` 返回的 `review_template` 为唯一权威：
 *     动机 / 改动思路 / 具体改动 / 对主干的风险 / 我的整体评价（代码类变更需 `### 关键代码讲解`）。
 *   - 禁止自造 "5-Block / Block 1~5" 版式。
 *   - findings 来源为 authentic-review.js 落盘的原生评审产物
 *     `.loopx/reviews/<pr>@<head>.json`（review_body 本身不承载 findings）。
 *
 * 用法:
 *   node respond-report.js --pr 13 --head <sha> --review-dir .loopx/reviews \
 *     --gates-json '{"typecheck":"PASSED",...}' [--result-file f] [--resolutions-file f] [--print]
 *
 * 输出: 报告文件路径（stdout）；`--print` 时直接输出 Markdown 正文。
 */

const fs = require('node:fs');
const path = require('node:path');

const NATIVE_SECTIONS = ['动机', '改动思路', '具体改动', '对主干的风险', '我的整体评价'];

function parseArgs(argv) {
  const o = {
    pr: '',
    head: '',
    reviewDir: path.join('.loopx', 'reviews'),
    resultFile: '',
    resolutionsFile: '',
    gatesJson: '{}',
    print: false,
    outputFile: '',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pr') o.pr = argv[++i];
    else if (a === '--head') o.head = argv[++i];
    else if (a === '--review-dir') o.reviewDir = argv[++i];
    else if (a === '--result-file') o.resultFile = argv[++i];
    else if (a === '--resolutions-file') o.resolutionsFile = argv[++i];
    else if (a === '--gates-json') o.gatesJson = argv[++i];
    else if (a === '--output-file') o.outputFile = argv[++i];
    else if (a === '--print') o.print = true;
  }
  return o;
}

// 校验评审产物正文是否符合 LoopX 原生 review_template 版式（唯一格式权威）。
function validateNativeReviewBody(body) {
  const text = String(body || '');
  const reasons = [];
  const reviewerLines = (text.match(/^Reviewer:\s/mg) || []).length;
  if (reviewerLines !== 1) reasons.push(`Reviewer 行数量应为 1，实际 ${reviewerLines}`);
  const verdictLines = (text.match(/^English verdict:\s*(?:APPROVE|REQUEST_CHANGES)\s*$/gm) || []).length;
  if (verdictLines !== 1) reasons.push(`English verdict 行数量应为 1，实际 ${verdictLines}`);
  for (const label of NATIVE_SECTIONS) {
    if (!new RegExp(`^##\\s*${label}\\s*$`, 'm').test(text)) reasons.push(`缺少原生章节: ${label}`);
  }
  return { valid: reasons.length === 0, reasons };
}

function loadReviewResult({ pr, head, reviewDir, resultFile }) {
  if (resultFile) {
    if (!fs.existsSync(resultFile)) {
      throw new Error(`指定的评审产物不存在: ${resultFile}`);
    }
    return { artifactPath: resultFile, artifact: JSON.parse(fs.readFileSync(resultFile, 'utf8')) };
  }
  if (!fs.existsSync(reviewDir)) {
    throw new Error(`评审产物目录不存在: ${reviewDir}；请先执行 loopx-flow review <pr_id>`);
  }
  const files = fs.readdirSync(reviewDir)
    .filter(f => f.endsWith('.json') && f.startsWith(`${pr}@`))
    .map(f => ({ f, mtime: fs.statSync(path.join(reviewDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) {
    throw new Error(`未找到 PR #${pr} 的原生评审产物（${reviewDir}/${pr}@*.json）；请先执行 loopx-flow review ${pr}，或用 --result-file 指定`);
  }
  const exact = head ? files.find(x => x.f === `${pr}@${String(head).toLowerCase()}.json`) : null;
  const chosen = exact || files[0];
  const artifactPath = path.join(reviewDir, chosen.f);
  return { artifactPath, artifact: JSON.parse(fs.readFileSync(artifactPath, 'utf8')) };
}

function loadResolutions(file) {
  if (!file) return new Map();
  if (!fs.existsSync(file)) throw new Error(`resolutions 文件不存在: ${file}`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(data.resolutions) ? data.resolutions : [];
  const byIndex = new Map();
  rows.forEach((row, i) => {
    const idx = Number.isInteger(row.finding_index) ? row.finding_index : i + 1;
    byIndex.set(idx, row);
  });
  return byIndex;
}

function severityRank(sev) {
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return order[String(sev || '').toUpperCase()] ?? 9;
}

function statusLabel(row) {
  if (!row) return '待复审确认';
  const map = { fixed: '已修复（待复审确认）', disputed: '已举证反驳', deferred: '本轮未修复（已登记）', pending: '待复审确认' };
  return map[row.status] || '待复审确认';
}

function gateRow(name, value) {
  const label = value === 'PASSED' || value === 'SKIPPED' ? value : `FAILED (${value || 'UNKNOWN'})`;
  return `| \`${name}\` | ${label} |`;
}

function buildReport({ pr, head, review, gates, resolutions }) {
  const artifact = review.artifact || {};
  const reviewedHead = artifact.head_oid || 'unknown';
  const verdict = artifact.verdict || 'unknown';
  const findings = Array.isArray(artifact.findings) ? artifact.findings : [];
  const check = validateNativeReviewBody(artifact.review_body);
  if (!check.valid) {
    throw new Error(`评审产物不是 LoopX 原生五段式报告，拒绝生成回复: ${check.reasons.join('; ')}`);
  }

  const reviewer = artifact.reviewer && typeof artifact.reviewer === 'object' ? artifact.reviewer : {};
  const lines = [];
  lines.push(`> Author response to LoopX native review \`${reviewedHead}\` (verdict: ${verdict}) · response head \`${head}\``);
  lines.push(`> Reviewed by: ${reviewer.actor_kind || 'model_agent'} · model=${reviewer.declared_model || 'unknown'} · provider=${reviewer.declared_provider || 'unknown'} · declaration=${reviewer.declaration_source || 'self_reported'} · head=${reviewedHead}`);
  lines.push('> 报告格式复用 `loopx pr-review` 的 `review_template`（五段式）；findings 来自原生评审产物，不使用自造 Block 版式。');
  lines.push('');
  lines.push('## 动机');
  lines.push('');
  if (findings.length) {
    lines.push(`本轮针对评审报告中的 ${findings.length} 项发现逐项闭环，并按原生五段式格式重新提交验证证据。`);
    findings.forEach((f, i) => {
      const loc = `${f.file || 'unknown'}${f.line ? ':' + f.line : ''}`;
      lines.push(`- **${i + 1}. [${f.severity || 'P3'}]** \`${loc}\` — ${f.summary || '(无摘要)'}`);
    });
  } else {
    lines.push('本轮评审未记录可执行 findings；回复仅陈述当前 head 的实测门禁与残余风险。');
  }
  lines.push('');
  lines.push('## 改动思路');
  lines.push('');
  if (findings.length) {
    findings
      .slice()
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .forEach((f, i) => {
        const idx = findings.indexOf(f) + 1;
        const resolution = resolutions.get(idx) || null;
        const tactic = resolution && resolution.summary
          ? resolution.summary
          : `按评审结论对 \`${f.file || 'unknown'}\` 实施最小修复，并以本轮四门禁实测作为再验证证据`;
        lines.push(`- **${idx}. [${f.severity || 'P3'}]** ${tactic}`);
      });
  } else {
    lines.push('- 无 findings 需要修复；保持当前实现并复核原生格式与收据一致性。');
  }
  lines.push('');
  lines.push('## 具体改动');
  lines.push('');
  lines.push('### 关键代码讲解');
  lines.push('');
  if (findings.length) {
    findings.forEach((f, i) => {
      const idx = i + 1;
      const resolution = resolutions.get(idx) || null;
      const loc = `${f.file || 'unknown'}${f.line ? ':' + f.line : ''}`;
      lines.push(`- **${idx}. \`${loc}\`** — 状态: ${statusLabel(resolution)}${resolution && resolution.evidence ? ` · 证据: ${resolution.evidence}` : ''}`);
    });
  } else {
    lines.push('- 本轮无代码修复点；`loopx-flow check` 与原生评审格式未发生结构性变更。');
  }
  lines.push('');
  lines.push('## 对主干的风险');
  lines.push('');
  lines.push('- 残余风险：以本轮四门禁实测与原生 `--check-result` 复核结果为准；未闭环发现已在 `review-carryover.json` 登记。');
  if (gates.loopx_status && gates.loopx_status !== 'PASSED') {
    lines.push('- `loopx status` 未通过，回复不得视为可合入结论。');
  }
  lines.push('');
  lines.push('## 我的整体评价');
  lines.push('');
  lines.push('### 验证矩阵');
  lines.push('');
  lines.push('| Check | Result |');
  lines.push('|---|---|');
  lines.push(gateRow('npm run typecheck', gates.typecheck));
  lines.push(gateRow('npm run lint', gates.lint));
  lines.push(gateRow('npm run build', gates.build));
  lines.push(gateRow('npm test', gates.test));
  if (gates.loopx_status) lines.push(gateRow('loopx status', gates.loopx_status));
  lines.push('');
  lines.push(`结论：本轮回复基于 \`${head}\` 实测门禁与原生评审产物生成；请复审确认逐项闭环结果。`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  const o = parseArgs(process.argv);
  if (!o.pr || !o.head) {
    console.error('usage: respond-report.js --pr N --head <sha> [--review-dir d] [--result-file f] [--resolutions-file f] [--gates-json json] [--print]');
    process.exit(2);
  }
  let gates = {};
  try {
    gates = JSON.parse(o.gatesJson || '{}');
  } catch (e) {
    console.error(`[FAIL-CLOSED] --gates-json 解析失败: ${e.message}`);
    process.exit(1);
  }

  try {
    const review = loadReviewResult(o);
    const resolutions = loadResolutions(o.resolutionsFile);
    const body = buildReport({
      pr: o.pr, head: o.head, review, gates, resolutions,
    });
    if (o.print) process.stdout.write(body + '\n');
    const out = o.outputFile || path.join(require('node:os').tmpdir(), `pr-response-${o.pr}-${Date.now()}.md`);
    fs.writeFileSync(out, body, 'utf8');
    if (!o.print) process.stdout.write(out + '\n');
  } catch (e) {
    console.error(`[FAIL-CLOSED] ${e.message}`);
    process.exit(1);
  }
}

main();

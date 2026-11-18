'use strict';

/**
 * Decide whether a `loopx doctor --format json` payload proves that required
 * LoopX skills, their routes, and install freshness are ready.
 *
 * LoopX marks installed_required_skills / installed_required_skill_routes as
 * required:false, so `loopx doctor` can exit 0 while skills are missing or
 * stale and install_freshness.status is repair_recommended. Callers must use
 * this verdict, not the process exit code alone.
 */

const BLOCKING_FRESHNESS = new Set(['stale', 'repair_recommended', 'missing']);
const DEFAULT_REPAIR = [
  'loopx workflow-skills --install',
  'loopx slash-commands --install',
  'loopx doctor --format json',
].join('\n');

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function checkById(checks, id) {
  if (!Array.isArray(checks)) return null;
  return checks.find((item) => item && item.id === id) || null;
}

function stripFences(text) {
  const fenced = text.match(/```(?:bash|sh)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  return text.replace(/```/g, '');
}

function repairCommand(payload) {
  const freshness = asObject(payload.install_freshness);
  const candidates = [];
  if (freshness && typeof freshness.upgrade_command === 'string') {
    candidates.push(freshness.upgrade_command);
  }
  if (typeof payload.fix === 'string') candidates.push(payload.fix);
  for (const raw of candidates) {
    const cleaned = stripFences(raw).trim();
    if (cleaned) return cleaned;
  }
  return DEFAULT_REPAIR;
}

function evaluateDoctorPayload(payload) {
  if (!asObject(payload)) {
    return {
      ok: false,
      reasons: ['loopx doctor 输出不是 JSON 对象，无法核验 required skills'],
      repair: DEFAULT_REPAIR,
    };
  }

  const reasons = [];
  const skillsCheck = checkById(payload.checks, 'installed_required_skills');
  const routesCheck = checkById(payload.checks, 'installed_required_skill_routes');
  if (!skillsCheck || !routesCheck) {
    reasons.push('doctor 未返回 installed_required_skills 或 installed_required_skill_routes');
  }

  const skillsApplicable = Boolean(skillsCheck) && skillsCheck.applicable !== false;
  const routesApplicable = Boolean(routesCheck) && routesCheck.applicable !== false;
  const applicable = skillsApplicable || routesApplicable;

  function describeCheck(check, label) {
    if (!check || check.applicable === false) return;
    if (check.ok !== true) {
      const detail = typeof check.detail === 'string' && check.detail ? `: ${check.detail}` : '';
      reasons.push(`${label} 未通过${detail}`);
    }
  }
  describeCheck(skillsCheck, 'installed_required_skills');
  describeCheck(routesCheck, 'installed_required_skill_routes');

  if (applicable) {
    const skills = asObject(payload.skills) || {};
    const names = Object.keys(skills);
    if (names.length === 0) {
      reasons.push('必需 LoopX skills 列表为空');
    }
    for (const name of names) {
      const skill = asObject(skills[name]);
      if (!skill || skill.exists !== true) {
        reasons.push(`skill ${name} 缺失`);
        continue;
      }
      if (skill.required_phrases !== true || skill.route_conflict === true) {
        reasons.push(`skill ${name} 路由过期或冲突`);
      }
    }

    const freshness = asObject(payload.install_freshness);
    if (!freshness || typeof freshness.status !== 'string' || freshness.status.length === 0) {
      reasons.push('doctor 未返回 install_freshness.status');
    } else if (BLOCKING_FRESHNESS.has(freshness.status)) {
      const reason = typeof freshness.reason === 'string' && freshness.reason
        ? ` (${freshness.reason})`
        : '';
      reasons.push(`install_freshness.status=${freshness.status}${reason}`);
    } else if (freshness.requires_upgrade === true) {
      reasons.push(`install_freshness.requires_upgrade=true (status=${freshness.status})`);
    }

    const delivery = asObject(payload.skill_delivery);
    if (delivery && delivery.status === 'repair_recommended') {
      reasons.push('skill_delivery.status=repair_recommended');
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    repair: repairCommand(payload),
  };
}

function formatFailure(result) {
  return [
    '[FAIL-CLOSED] LoopX required skills 校验未通过，环境不得标记为就绪。',
    `原因: ${result.reasons.join('；')}`,
    '影响: 仅有 loopx CLI 不能代表 Agent skills 已安装、路由未过期、安装仍新鲜。',
    '修复指令:',
    result.repair,
    '',
  ].join('\n');
}

function main() {
  const raw = require('node:fs').readFileSync(0, 'utf8');
  let payload = null;
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      payload = null;
    }
  }
  const result = evaluateDoctorPayload(payload);
  if (result.ok) {
    process.stdout.write('LoopX required skills、routes 与安装新鲜度通过。\n');
    process.exit(0);
  }
  process.stderr.write(formatFailure(result));
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateDoctorPayload,
  formatFailure,
  DEFAULT_REPAIR,
};

'use strict';
/**
 * 能力探针测试替身公共片段。
 *
 * bin/loopx-flow 的 dispatch 边界会对 L0 命令跑一次三层能力探针，探针要求 mock CLI
 * 能回答 `--version` 与各子命令的 `--help`。测试里手写的 `loopx` 替身只有业务分支，
 * 默认不会响应探测，会把真实命令挡在能力门之前，掩盖被测逻辑。
 *
 * 这里给所有 mock `loopx` 提供统一的「契约完备」前缀：`--version` 返回锚点版本，
 * `--help` 返回覆盖 Required Capability Set 的合成帮助签名（含 Flag 与 `{a,b}` 选择集）。
 * 负向用例仍然自带缺项帮助文本，覆盖这里不生效。
 */
const HELP_SIGNATURE = [
  'usage: loopx <group> <command> [options]',
  '  bootstrap --goal-id GOAL_ID --state-file STATE_FILE',
  '  todo claim --goal-id GOAL_ID --todo-id TODO_ID --agent-id AGENT_ID --claimed-by CLAIMED_BY',
  '             --claim-operation-id CLAIM_OPERATION_ID',
  '  todo complete --goal-id GOAL_ID --claim-operation-id CLAIM_OPERATION_ID',
  '  todo add --goal-id GOAL_ID --required-write-scope REQUIRED_WRITE_SCOPES --task-domain TASK_DOMAIN',
  '           --task-repository TASK_REPOSITORY --validation-command VALIDATION_COMMAND',
  '           --operation-id OPERATION_ID --claim-operation-id CLAIM_OPERATION_ID',
  '           --task-class {advancement_task,continuous_monitor,user_gate,user_action,blocker}',
  '           --decision-scope DECISION_SCOPE --decision-outcome {approve,reject,cancel} --global-gate',
  '  change-quality prepare --goal-id GOAL_ID --base-ref BASE_REF [--repo-path REPO_PATH]',
  '  change-quality record --goal-id GOAL_ID --result-json RESULT_JSON --execute --base-ref BASE_REF',
  '  change-quality verify --goal-id GOAL_ID [--repo-path REPO_PATH] [--base-ref BASE_REF]',
  '  pr-review --goal-id GOAL_ID --check-merge-readiness NUMBER@HEAD_OID --check-result CHECK_RESULT',
  '  goal-lifecycle --goal-id GOAL_ID --operation {stop,resume} --reason REASON --execute',
  '  sync-global --goal-id GOAL_ID [--replace-state] [--dry-run]',
  '  issue-fix {repository-memory-sync,workflow-plan,feasibility,caller-repo-branch,outcome,metrics}',
  '  issue-fix workflow-plan --repo-path REPO_PATH --base-branch BASE_BRANCH --issue-branch ISSUE_BRANCH',
  '               --goal-id GOAL_ID --project PROJECT --no-write-domain-state --format {markdown,json}',
  '  issue-fix caller-repo-branch --repo-path REPO_PATH --repo REPO --issue-ref ISSUE_REF',
  '               --base-branch BASE_BRANCH --issue-branch ISSUE_BRANCH',
  '               --validation-command VALIDATION_COMMAND --execute --format {markdown,json}',
  '  integration-branch {configure,status,sync}',
  '  goal-acceptance {inspect,prepare,configure,verify} --goal-id GOAL_ID --format {markdown,json}'
].join('\n');

const HELP_PRELUDE = `args="$*"
if [[ "$args" == "--version" ]]; then echo "loopx 2.3.0"; exit 0; fi
if [[ "$args" == *"--help" ]]; then
cat <<'LOOPX_CAPABILITY_HELP'
${HELP_SIGNATURE}
LOOPX_CAPABILITY_HELP
exit 0
fi
`;

module.exports = { HELP_SIGNATURE, HELP_PRELUDE };

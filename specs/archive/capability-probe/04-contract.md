# 04-Contract: capability-probe（三层 LoopX 能力探针与 schema 白名单）

- **Contract-Status**: FROZEN & APPROVED
- **Spec-Commit**: 由 `loopx-flow approve contract` 写入
- **追溯**：`REQ-CAPABILITY-1`、ADR-0015 决策 4、ADR-0010 决策 4 / T2 / T3

## 冻结接口（不可变签名）

### `lib/capability-probe.js`（CommonJS）

```ts
type Tier = 'BLOCK' | 'WARN';
type Status = 'PASS' | 'WARN' | 'BLOCK' | 'UNKNOWN';

interface Probe {
  /** 真实子命令入口，例如 ['todo','claim','--help'] */
  argv: string[];
  /** 必需 token（长选项或子命令），缺失即 BLOCK */
  required: string[];
  /** flag -> 允许取值集合，例如 { '--operation': ['stop','resume'] } */
  choices: Record<string, string[]>;
}

interface Capability {
  id: string;
  tier: Tier;
  /** 触发 scope；doctor 视角下按 commands 判定 BLOCK / WARN */
  commands: string[];
  /** 诊断卡展示用「探测信号」 */
  signal: string;
  probes: Probe[];
  impact: string;
  /** 非 loopx 的外部 CLI（当前仅 gh） */
  cli?: string;
}

interface Entry {
  id: string;
  tier: Tier;
  signal: string;
  status: Status;
  detail: string;
  missing: string[];
  unevaluable: string[];
  location: string;
}

interface ProbeResult {
  schema_version: 'loopx_flow_capability_matrix_v0';
  scope: string;
  loopx_version: string;
  loopx_version_raw: string;
  anchor: { version: '2.3.0'; ref: 'loopx-project/loopx@f4c5d6d7' };
  advisory: string;
  blocked: Entry[];
  entries: Entry[];
}

declare const ANCHOR: { version: '2.3.0'; ref: 'loopx-project/loopx@f4c5d6d7' };
declare const CAPABILITIES: readonly Capability[];
declare const SCHEMA_WHITELIST: Record<string, { path?: string; allowed: string[] }>;

declare function readLoopxVersion(loopxBin: string): { ok: boolean; raw: string; version: string };
declare function extractSignature(text: string): {
  flags: Set<string>;
  words: Set<string>;
  choices: Map<string, Set<string>>;
};
declare function effectiveTier(capability: Capability, scope: string): Tier;
declare function probeCapabilities(opts?: { loopxBin?: string; scope?: string }): ProbeResult;

type SchemaVerdict =
  | { ok: true; consumer: string; field: string; expected: string; actual: string }
  | { ok: false; consumer: string; field: string; expected: string; actual: string; reason: string };

declare function assertSchemaVersion(consumer: string, payload: unknown): SchemaVerdict;
declare function schemaDiagnosticCard(consumer: string, verdict: SchemaVerdict, version: string): string;
declare function formatDiagnosticCard(input: {
  trigger: string; expected: string; actual: string; impact: string; location: string; version: string;
}): string;
declare function formatMatrix(result: ProbeResult): string;
declare function formatBlockedCards(result: ProbeResult, trigger: string): string;
```

**CLI 契约**：`node lib/capability-probe.js <matrix|require|assert-schema> [--scope S] [--format text|json|quiet] [--consumer C] [--loopx-bin B]`

| 命令 | 退出码 |
|---|---|
| `matrix` | 恒 `0`（诊断视图，不阻断） |
| `require` | `blocked.length > 0` → `1`，诊断卡写 stderr |
| `assert-schema` | 未登记 consumer 或白名单外 → `1`；成功 → `0` 且 stdout 打印实际版本 |
| 未知子命令 | `2` |

### `bin/loopx-flow`（shell）

```bash
probe_loopx_capabilities [--scope S] [--format text|json|quiet]
#   委托 matrix；doctor 使用，恒成功（除 node 不可用）

require_loopx_capabilities <scope>
#   委托 require --format quiet；blocked 非 0，诊断卡写 stderr；成功时 stdout 为空

assert_loopx_schema_version <consumer> <raw>
#   stdin 传 assert-schema；白名单外非 0

read_loopx_json <consumer> <loopx 参数...>
#   命令失败 → stdout 透出 + 原退出码
#   命令成功但 schema 越界 → 载荷与诊断写 stderr，返回 1，stdout 不输出载荷

dispatch_capability_scope <action>
#   feature|start→feature；check；pr；review；merge；release-approve；其他 → 非 0 且不触发门
```

## 断言不变量

1. `probeCapabilities().blocked` 只含 `tier === 'BLOCK'` 且 `status ∈ {BLOCK, UNKNOWN}` 的项。
2. `matrix` 视图恒 exit 0；只有 `require` 在 `blocked.length > 0` 时 exit 1。
3. `SCHEMA_WHITELIST` 未登记的 consumer 一律 `ok: false`，不得默认放行。
4. `read_loopx_json` 在 schema 越界时不得把载荷写到 stdout。
5. `dispatch_capability_scope` 只识别 6 个 L0 action，其他返回非 0。
6. `extractSignature` 的 choices 必须绑定到**同一行内它前面的 flag**，不得退化为全文词表匹配。
7. 版本漂移（≠ `2.3.0`）且前两层通过时只输出 advisory，不改变 exit code。

## AC 矩阵

| AC | 验收标准 | Story | 验证 |
|---|---|---|---|
| AC-1 | 第 1 层：缺必需 Flag / 子命令 → BLOCK + 诊断卡 | Story-1 | `capability-probe.test.js` T2 系列 |
| AC-2 | 第 2 层：未知 / 缺失 `schema_version` → 非 0 | Story-1 | `capability-probe.test.js` T3 系列 |
| AC-3 | 第 3 层：版本漂移仅 WARN | Story-1 | `capability-probe.test.js` T5 |
| AC-4 | `doctor` / `capabilities` 输出完整矩阵且恒 exit 0 | Story-2 | `formatMatrix` + doctor 用例 |
| AC-5 | 6 个 L0 命令在 BLOCK / UNKNOWN 时于不可逆动作前非 0 | Story-3 | `capability-gate-dispatch.test.js` |
| AC-6 | 成功门 stdout 不含矩阵 | Story-3 | 同文件 `require_success_is_quiet` |
| AC-7 | `check` / `pr` 无参先打印用法 | Story-3 | 同文件无参用例 |
| AC-8 | help 不可用 → UNKNOWN，诊断卡含 `scope=`（含 bash 5.3 变量展开回归） | Story-4 | 同文件 P0 用例 |
| AC-9 | 真实 `loopx 2.3.x` 下 BLOCK 能力全 PASS | Story-4 | `todo-managed-execution.test.js` 金丝雀（无 loopx 时 skip） |

## Scope

- **包含**：`lib/capability-probe.js`；`bin/loopx-flow` 的 `probe_loopx_capabilities` / `require_loopx_capabilities` / `assert_loopx_schema_version` / `read_loopx_json` / `dispatch_capability_scope`；`tests/unit/capability-probe.test.js`、`tests/unit/capability-gate-dispatch.test.js`、`tests/unit/helpers/capability-stub.js`；本胶囊 6 份文档。
- **不包含**：`pr-review --check-merge-readiness` 与 `issue-fix feasibility` 的 schema 白名单（见 `02-prd.md`「覆盖边界」）；LoopX 本体改动；版本 Pin；审查管线可靠性（已拆分到 #80 / ADR-0017）。

## Verification Plan

```bash
npm run typecheck && npm run lint && npm run build && npm run test
node --test tests/unit/capability-probe.test.js tests/unit/capability-gate-dispatch.test.js
```

## 依赖顺序

`Story-1`（探针核心）→ `Story-2`（矩阵投影）→ `Story-3`（dispatch 门）→ `Story-4`（负向与金丝雀）

## 交付后修订（Issue #84，2026-11-28）

> 本节是**追加**记录，不修改上面的历史断言与前序审批内容。断言 #6 的原文保留为交付时口径；实现口径自此节生效。

- **背景**：argparse 在 80 列终端下会把取值枚举折到下一行（`--operation` 与 `{stop,resume}` 分离）。断言 #6 的「同一行内」让折行帮助被判为「`--operation` 缺少取值」，进而误阻断 `merge` / `review`。
- **新口径**：choices 归属到**同一 usage 段落内它前面的那个 Flag**；段落以空行分界，跨空行不再归属，仍不得退化为全文词表匹配。就近归属不变：同一段落里有更近的 Flag 时，choices 归更近的那个。
- **验证**：`tests/unit/capability-probe.test.js` 新增三条（折行正向、跨空行负向、折行后相邻 Flag 各归其主），并保留既有 P2 false-pass 回归用例。
- **审批影响**：本节改变了已冻结断言的判定口径，按仓库规程需 Owner 重新 Gate1 确认；在此之前该修订为 `Proposed`。

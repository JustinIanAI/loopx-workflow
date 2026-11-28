# integrate configure 契约与任务图

- **Contract-Status**: FROZEN & APPROVED

以下 TypeScript 仅描述 CLI 契约，不引入运行时接口或伪造原生 JSON：

```typescript
export interface IntegrateConfigureOptions {
  baseRef: string;
  integrationBranch: string;
  sourceBranch: string;
  replace?: true;
  execute?: true;
  planFile?: string;
}
export type IntegrateConfigureExit = 0 | 1 | 2;
```

追溯：REQ-FACADE-1、REQ-FACADE-2、REQ-NATIVE-1、REQ-FAILCLOSED-1；设计正文命令表。

## Scope 与不变量

```bash
loopx-flow integrate configure --base-ref <ref> --integration-branch <ref> --source-branch <ref> [--replace] [--execute] [--plan-file <path>]
```

既有 repo/registry 前置条件仍生效。新分支只在首参数为 configure 时触发。解析成功后恰好调用一次 `run_loopx integration-branch configure --repo-path "$PROJECT_ROOT"`，追加用户参数数组，保留输入顺序、空格、引号和元字符。可选项不默认注入。

三个必填选项各一次；所有带值选项必须有非空白值且不能把下一个 `--option` 当值。六个选项任意重复、额外位置参数、未知选项（含 --status、--repo-path、--format、--flag=value）均 exit 2，零原生调用。plan-file 同样拒绝缺值和空白。不解析 refs 的业务有效性，不推断分支，不维护配置副本。

原生 stdout/stderr 原样输出；非零统一 exit 1 并补充 fail-closed 诊断；只有原生 exit 0 才输出可读成功提示，preview 与 execute 文案区别明确。未安装 CLI exit 1。旧 integrate preview/status/execute 原样保留。

## AC Matrix

| AC | Story | 验收与测试 |
| --- | --- | --- |
| AC1 | S1 | 必填参数实际 argv 正确，repo-path 是目标仓库根；默认不含 execute/replace/plan-file |
| AC2 | S1 | 三个可选项分别/组合精确透传，乱序输入、空格/引号/元字符不拆词、不执行 |
| AC3 | S2 | 缺任一必填项、各带值项缺值/空/空白/下一 flag，exit 2 且零调用 |
| AC4 | S2 | 六项任意重复、未知项、额外位置参数 exit 2 且零调用 |
| AC5 | S2 | 原生 exit 7/42/127 统一 exit 1，保留 stdout/stderr，不输出成功 |
| AC6 | S1 | 显式 registry（含空格）与子目录调用保留路径锚定 |
| AC7 | S3 | usage/README/design 同步；native-dispatch 旧 integrate 回归全绿；四门禁及 check 记录真实结果 |

## Verification Plan / 依赖顺序

1. 写 `tests/unit/integrate-configure.test.js`，fake CLI 使用独立 os.tmpdir()+mkdtemp registry 和 NUL 分隔 argv；确认实现前红。
2. 实现 configure 分派与解析，不改现有分支；新测试和 native-dispatch 一起转绿。
3. 隔离副本运行 typecheck/lint/build/test，防止旧测试污染工作 registry；保留实际退出码与用例数。
4. 使用隔离本地 Goal 启用 change-quality；运行 `loopx-flow check integrate-configure`，授权未完成时如实记录 blocked，不通过 --goal-id 等方式规避 Gate1。
5. 一次提交规格、代码与检查记录并推送；创建待审 Draft PR。JustinIanAI 的真实 Gate1、最新 head 的独立 review、Gate2 未完成前不得声称交付门禁通过。

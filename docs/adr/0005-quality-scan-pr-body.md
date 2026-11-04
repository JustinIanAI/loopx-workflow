# ADR-0005：质量扫描范围与 PR 正文真实性

- **状态**：Accepted
- **日期**：2026-11-04

## 背景

`scanDiffForDefects` 只识别两个硬编码字符串标记；没有 LoopX scope 时用 `git diff HEAD`，已提交改动不会被扫描；`validation` 四项被硬编码为 `passed`；PR 正文的 `describeFile` 按路径返回固定中文。结果是扫描和正文都可能“看起来通过”，但不来自真实 diff。

## 决策

- 扫描范围：优先 LoopX scope 的 `base_commit`；否则取 `git merge-base origin/main HEAD`，扫描该 base 到工作区的已提交+未提交 diff。排除 `tests/` 与适配器自身。
- 高信号 blocker：`debugger`、硬编码密钥（`AKIA...`、PEM、`sk-...`）、关键路径上的 `|| true`、契约文件改动（提示重新 `approve`/`gate verify contract`）。
- 不把“未声明变量”做成 diff 文本正则：误报会阻断正常交付；该职责归 lint/类型检查。
- `validation` 必须来自实际门禁结果；独立运行 `ingest` 时也要执行四门禁，失败即非 0。
- 只有 blocker 为 0 且收据 `verify ok=true` 才打印 PASSED。
- PR 正文的逐文件说明必须来自真实 diff hunk/符号或模型输出；无法生成时写 `NOT_PROVIDED`，禁止固定中文映射和静态“已通过”。

## 否决

- **用正则找未声明变量**：高误报，会卡死 CI。
- **只扩充字符串黑名单**：解决不了扫描范围和假 validation。
- **保留 `describeFile` 固定映射**：等于模板化 PR 正文。

## 修订

- PRD：新增 `REQ-QUALITY-2`；修改 `REQ-QUALITY-1`、`REQ-PR-BODY-1`。
- 设计：第 8 节、第 10 节失败矩阵。
- 退役：`describeFile` 的固定映射。

## 不做什么

- 不引入 ESLint 或其他新门禁依赖。
- 不改变 `REQ-REVIEW-1` 的五段式结构。
- 不把 OCR 变成默认阻断。

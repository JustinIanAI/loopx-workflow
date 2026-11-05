- **Status**: APPROVED BY HUMAN (freecisco_yan@2026-11-05 14:54:08)
# 实现取舍

- **不自动迁移**：`doctor` 只诊断 + 给修复指令；`~/.loopx` 迁移仍由人类确认后执行
  `loopx migrate-local-state --execute`，避免自动改动用户 HOME 控制面状态。
- **WARN 不阻断**：控制面检查为 WARN 级（`doctor` 是阶段 0 体检），真正的交付阻断仍在
  `approve` / `check` / `merge`；避免把环境诊断做成第 4 套兜底。
- **证据 refs 与扫描范围分离**：缺陷扫描继续覆盖工作区 diff（`REQ-QUALITY-2` 不变），
  仅 `reuse`/`simplification` 证据收紧为已提交 scope；否则会把进行中的工作区改动伪装成既有证据。
- **过滤而非报错**：`isRuntimeArtifact()` 过滤后若没有可用 refs，回退到胶囊
  `05-evidence.md` 或 `package.json`，不让收据因为“无证据文件”而 fail-closed。
- **API 预算以 50% 为基线**：官方 primary/secondary 上限之上保留一倍余量，应对
  `x-ratelimit-*` 的多区域抖动与未公开的 abuse 阈值（见 ADR-0007）。

# 本胶囊覆盖的产品需求

- `REQ-ENV-1`（控制面路由与 registry 一致性前置可见）
- `REQ-ENV-2`（GitHub API 官方上限 50% 安全基线 + 评审侧降载约束）
- `REQ-ENV-3`（运行时工件不入 Git；收据证据只取已提交 exact scope）

承重假设：Agent 在阶段 0 会执行 `loopx-flow doctor`；若某宿主绕过 doctor，则环境问题仍会在
`approve`/`check` 阶段以 Fail-Closed 形式出现（不新增第二套拦截）。

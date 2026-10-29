# User Stories & Sizing: native-dispatch-deep-integration
- **Story 1 (租约流转)**: 作为并发协作的 Agent，我通过 `todo claim/done` 获得与释放 LoopX 排他租约，租约冲突时被明确阻断，避免双写。
- **Story 2 (因果路由)**: 作为缺陷响应者，我运行 `loopx-flow issue <id>`，由 LoopX feasibility 基于真实 Issue 元数据裁决 fix_pr/comment_only/triage_only 路由，不再依赖静态文案。
- **Story 3 (本地预集成)**: 作为集成负责人，我运行 `loopx-flow integrate` 在合并前通过 LoopX integration-branch 预演多源合入，preview 默认安全。

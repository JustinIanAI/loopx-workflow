# ADR-0006：文档分级与代码生命周期双轨治理

- **状态**：Accepted
- **日期**：2026-11-04

## 背景

上一轮交付审计暴露了两大治理痛点：
1. **虚假闭环与状态混淆**：历史胶囊在代码尚未实质落地、未通过真实路径测试时，就在 `00-INDEX.md` 中过早标注 `DELIVERED`。决策获批、代码实现、测试验证与主干交付之间缺乏严格解耦的状态机。
2. **审查规则生搬硬套**：将代码级交付审查（`loopx-flow review` 强求关键代码讲解、真实因果图、CI 状态、Diff 质量收据）强加于纯文档类 PR（如 PR #16），导致文档虽有充分设计共识，却被误判为 `REQUEST_CHANGES`。同时，若要求“所有文档修改皆立 ADR”，将陷入过度官僚化。

需要确立清晰的文档分级体系、五态生命周期模型，以及文档与代码变更的轻量化双轨交付协议。

## 决策

- **文档三层分级治理**：
  1. **L1 决策文档（ADR）**：位于 `docs/adr/`，定义破坏性产品行为、架构边界、失败语义与合入补偿。必须立 ADR，且必须经人类 Maintainer 审批放行（Accepted）。
  2. **L2 契约文档（PRD、Feature Contract）**：`docs/prd/loopx-workflow.md` 与 `specs/features/<feature>/04-contract.md`。必须依据已 Accepted 的 ADR 产生，并在阶段 4 执行物理指纹锁定（Contract Freeze）。
  3. **L3 说明文档（README, QUICKSTART, GUIDES）**：使用说明、环境指南、示例。常规维护与静态链接校验，禁止为其单独设立 ADR。
- **生命周期五态模型（Five-State Lifecycle）**：
  - `Proposed`（方案提出）➔ `Accepted`（决策获批）➔ `Implemented`（代码提交）➔ `Verified`（验证通过）➔ `Released`（合入归档）。
  - 严禁越级：ADR/PRD 获批仅表示 `Accepted`，绝不代表代码 `Implemented` 或 `Released`。代码必须经真实路径验证与质量收据融合后才可标记 `Verified`；主干 Squash 合入且归档后才进入 `Released`。历史未落地胶囊统一纠偏为 `Accepted`。
- **日常特性研发：同分支单 PR 交付**：
  - 契约（L2）与代码实现在同一个 Feature 分支上推进。阶段 4 本地执行 `loopx-flow approve contract <feature>` 完成人类审批并锁定指纹；提交 PR 时契约与代码一同提交，只发单 PR，审查器仅核验“实现是否满足契约”。不引入繁重的独立日期账本目录。
- **纯全局文档/决策批交付（Docs-Only PR）豁免与静态自检**：
  - 纯 Markdown 变动的文档 PR 豁免 L2 对抗性代码审查（`loopx-flow review`）：不要求 `### 关键代码讲解`，不阻塞于缺失的 CI 状态（启用 `--no-pr-review-wait-for-ci`），不强制生成代码质量收据。
  - 审查依据采用线下/线上讨论纪要或 `design-grill` 产出的决策记录（Decision Record）。
  - 门禁仅执行“文档静态三项核验”：
    1. ADR 元数据完整（状态为 `Accepted`、包含日期与审批记录）。
    2. 交叉引用无死链（引用的 `REQ-*` 与 `ADR-*` 存在且编号一致）。
    3. Markdown 语法合规。
  - 人类 Maintainer 依据静态自检结果直接在 PR 页面点击 Approve（或触发 `author_owned_fallback`）后直接 Squash 合入。

## 否决

- **所有文档变更强制立 ADR**：形式主义，拖慢日常说明文档维护。
- **纯文档 PR 强行跑代码级模型对抗审查**：在无代码和无运行时因果证据图时会产生虚假阻断（如 `REQUEST_CHANGES`）。
- **日常特性研发先发 PR-0 审文档再发代码 PR**：过度串行化，特性契约与代码同分支单 PR 交付效率更高。
- **引入独立日期账本目录（`docs/adr/ledger/`）**：增加目录层级与维护熵增，直接复用 Feature 胶囊作为落地切片账本。

## 修订

- PRD：新增 `REQ-DOC-TIER-1`（文档三层分级）、`REQ-LIFECYCLE-5STATE-1`（五态生命周期）、`REQ-DOCS-DELIVERY-1`（纯文档 PR 豁免与静态自检）。
- 设计：在阶段 6 与阶段 7 说明纯文档 PR 的分流路径与静态三项自检规则；明确胶囊状态字段升级为五态模型。
- 退役：废除“代码未经验收即在胶囊 INDEX 中标记 DELIVERED”的旧做法；废除“纯文档 PR 必须跑 authentic-review 且要求代码讲解”的规则。

## 不做什么

- 不引入上游 LoopX 的双语镜像强门禁脚本。
- 不修改展示类 HTML 页面（`docs/guides/loopx-workflow-architecture.html`）。

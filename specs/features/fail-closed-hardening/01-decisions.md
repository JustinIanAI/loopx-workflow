---
feature: fail-closed-hardening
updated_at: "2026-10-30 11:40:00"
status: DRAFT
decisions:
  - id: ADR-001
    question: "如何彻底解决工作流中的 Fail-Open 问题（6 处 || true 吞掉关键错误）？"
    options:
      - key: A
        label: "全链路实施 Fail-Closed 阻断，并伴随结构化诊断卡片（原因 + 影响 + 修复指令）"
      - key: B
        label: "保留原有容错忽略逻辑，仅增加 warning 警告日志"
    evidence:
      - "源码审计发现 bin/loopx-flow 在 doctor/bootstrap/checkout/configure-goal/stop 处存在 || true"
      - "分支检出失败会导致在 main 主干上裸跑初始化；契约锁定失败会导致虚假成功放行"
    recommendation: "A"
    reason: "工作流核心价值是可信交付与防偷跑，任何静默失败都会从根源瓦解质量门禁的严肃性"
    impacted_components:
      - "bin/loopx-flow"
      - "scripts/preflight-check.sh"
    retired_paths:
      - "清理所有 6 处 || true 静默放行逻辑"
    human_approval: REQUIRED
    decision_result: "A (Selected)"

  - id: ADR-002
    question: "如何强化 Contract Gate 的真实性与防偷跑校验？"
    options:
      - key: A
        label: "实施双重锚定：文本标记核验 + 实时计算文件 SHA256 并与 LoopX 锁定的契约指纹物理比对"
      - key: B
        label: "维持现有文本正则匹配 (grep FROZEN & APPROVED)"
    evidence:
      - "仅靠 grep 文本极易被 Agent 手动篡改跳过，无法防御契约被偷改的场景"
      - "LoopX 原生已提供 progress-review-contract-revision 契约锁定能力"
    recommendation: "A"
    reason: "双重锚定确保即便文本被伪造或契约文件被恶意篡改，门禁通过 SHA 比对能一票否决"
    impacted_components:
      - "bin/loopx-flow (cmd_approve & cmd_gate)"
    retired_paths:
      - "废弃单纯 grep 正则匹配契约放行路径"
    human_approval: REQUIRED
    decision_result: "A (Selected)"

  - id: ADR-003
    question: "如何处置帮助文本中声明但代码未实现的 gate verify pr？"
    options:
      - key: A
        label: "遵循 Aegis 极小化原则彻底退役，清理 Usage 声明，由 check 与 merge 承接交付核验"
      - key: B
        label: "新建孤立的 gate verify pr 脚本与处理分支"
    evidence:
      - "阶段 6 已有 loopx-flow check 强门禁，阶段 8 已有 loopx-flow merge 严格合入核验"
      - "额外增设 gate verify pr 属于冗余抽象层"
    recommendation: "A"
    reason: "避免过度设计，严格遵守 delete-first 与无用代码退役规范"
    impacted_components:
      - "bin/loopx-flow"
    retired_paths:
      - "移除 usage 中 gate verify (decisions | contract | pr) 的 pr 选项"
    human_approval: REQUIRED
    decision_result: "A (Selected)"

  - id: ADR-004
    question: "如何实现结构化 ADR 决策管理并避免人肉填写负担？"
    options:
      - key: A
        label: "采用 YAML Frontmatter + Markdown 双模态，由 design-grill 追问时从代码提炼并自动生成"
      - key: B
        label: "仅保留纯 Markdown 文本，由人工手动撰写"
    evidence:
      - "纯文本难以被自动化工具做一致性比对与机器审计"
      - "Agent 具备代码库 Fact Probing 能力，完全能自动提炼 Evidence 与候选方案"
    recommendation: "A"
    reason: "实现人眼易读与机器可校验的统一，为后续门禁自动化校验奠定元数据基础"
    impacted_components:
      - "specs/features/*/01-decisions.md"
      - "skills/design-grill/SKILL.md"
    retired_paths:
      - "废弃无规范的自由 Markdown 决策模板"
    human_approval: REQUIRED
    decision_result: "A (Selected)"

  - id: ADR-005
    question: "如何对齐版本信息与 Node / LoopX 运行时依赖矩阵？"
    options:
      - key: A
        label: "升级 package.json 为 2.0.0 对齐 CLI；README 更新为 Node >=22.22.3 与 LoopX 2.x"
      - key: B
        label: "维持 package.json 1.0.0 与 Node >=18 不动"
    evidence:
      - "LoopX 2.x 控制面源码硬性要求 Node >=22.22.3 与 Python 3.11+"
      - "文档标注 Node >=18 会误导开发者在过低 Node 版本下安装报错"
    recommendation: "A"
    reason: "确保文档、代码、徽章与底层运行时契约 100% 真实对齐"
    impacted_components:
      - "package.json"
      - "README.md"
      - "scripts/preflight-check.sh"
    retired_paths:
      - "废弃过时的 Node 18 运行时声明"
    human_approval: REQUIRED
    decision_result: "A (Selected)"
---

# Architecture Decisions: fail-closed-hardening

## 1. 架构决策总览
- **特性名称**: `fail-closed-hardening`
- **当前状态**: `DRAFT (Pending Checkpoint 1 Approval)`
- **核心目标**: 全面消除工作流 6 处 Fail-Open 隐患，建立 Contract 物理 SHA256 双重锚定，退役虚假 PR 守卫，对齐环境版本契约。

## 2. 决策要点摘要
- **ADR-001**: 全链路阻断（Fail-Closed）+ 结构化终端诊断卡片（提供一键修复指令）。
- **ADR-002**: Contract Gate 双重锚定（文本标记 + LoopX 契约修订版本 SHA256 实时物理比对）。
- **ADR-003**: 遵循 Aegis 极小化原则，彻底退役 `gate verify pr` 虚假声明。
- **ADR-004**: 标准化结构化 ADR Schema（YAML Frontmatter + Markdown）。
- **ADR-005**: 运行时环境声明对齐（Node >= 22.22.3, LoopX 2.x, package.json 2.0.0）。

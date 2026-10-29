# LoopX AI-Native 研发与交付流 Skills 资产库 (v2.0)

本目录维护并聚合了 **LoopX AI-Native 研发与交付流**（遵循 Feature 自包含资产胶囊与 LoopX 原生能力驱动规范）的 **10 项核心 AI Agent Skills 资产**。

---

## 一、资产库定位与下沉原生设计理念

在 v2.0 架构中，我们对技能资产库执行了彻底的**“反熵增治理（Anti-Entropy）”**与**“下沉 LoopX 原生（Deep LoopX Native）”**：

1. **下沉原生能力（已退役 3 项冗余技能）**：
   - 原 `loopx-issue-fix` ➔ 下沉为 LoopX 内核原生能力 `loopx issue-fix`（`feasibility`, `workflow-plan` 等）。
   - 原 `loopx-pr-review` ➔ 下沉为 LoopX 内核原生能力 `loopx pr-review` 及官方预打包技能。
   - 原 `loopx-pr-merge` ➔ 下沉为 `loopx pr-review --check-merge-readiness` 物理防偷跑核验与官方程序。
2. **纯认知思维模型保留（保留 8 项 Prompt Skills）**：
   - 聚焦人类与大模型的深度推理：第一性原理方案压力测试、精益 PRD、红队攻击、Job Story 拆解、TDD 红绿重构、七层因果根因排查与代码退役。
3. **审查与质量门禁一体化（Code Review & OCR 改造）**：
   - `code-review`：默认跨边界语义契约审查，内置 `scripts/ingest-to-loopx-quality.js` 适配器，将审查结论直接编译为 LoopX `change_quality_agent_result_v2` 并回写 `specs/features/<feature>/05-evidence.md`。
   - `open-code-review`：定位为**选配能力**，内置 `run-ocr.sh` 脚本自主完成环境自检、自动安装、扫描并接入 LoopX 质量门禁。

---

## 二、核心 10 项 Skills 资产清单

| 技能目录 | 管线节点 / 角色 | 核心职责与思维范式 |
|---|---|---|
| `design-grill` | 阶段 1：方案研讨 | 代码库感知压力测试，探查事实，收敛 3～6 个顶级决策分支，消除所有“it depends”。 |
| `create-prd` | 阶段 2：精益 PRD | 快速生成 8 板块高信息密度精益 PRD，明确业务旅程与非目标 (Out of Scope)。 |
| `strategy-red-team` | 阶段 2：红队对抗 | 攻击方案的致命盲区，定位承重假设，设计极低成本的反驳测试用例。 |
| `user-stories` | 阶段 3：特性拆解 | 按 Job Story 语法拆解需求，控制单 PR Diff ≤ 500 行。 |
| `prioritize-features` | 阶段 3：排期与优先级 | 基于 Impact × Confidence / Effort 评估矩阵进行价值排期。 |
| `test-driven-development` | 阶段 5：TDD 实现 | 严格执行 Red-Green-Refactor，单测必须先红后绿，四大门禁 100% 通过。 |
| `anti-entropy-governance` | 阶段 5 / 收尾：反熵增 | 执行 `delete-first` 原则，彻底清除旧废弃路径、孤儿代码与无意义兜底层。 |
| `systematic-debugging` | 管线 B / 疑难排查 | 七层因果追踪 (`L1 症状 ➔ ... ➔ L7 规格缺口`)，定位 Canonical Owner（根本所有者）。 |
| **`code-review`** | 阶段 6：代码审查 (默认) | 默认跨边界语义审查 (0 Blocker)，内置适配脚本直通 LoopX change-quality。 |
| **`open-code-review`** | 阶段 6：代码审查 (选配) | 阿里 OCR 深度扫描，技能内自检、按需安装与审查闭环。 |

---

## 三、Code Review 交付物融合使用方式

审查结论通过 `skills/code-review/scripts/ingest-to-loopx-quality.js` 自动转入 LoopX 质量内核：

```bash
# 1. 默认语义契约审查并生成不可篡改 Receipt:
node skills/code-review/scripts/ingest-to-loopx-quality.js --feature <feature-name>

# 2. 选配启用阿里 OCR 自检、安装、扫描并融合:
./skills/open-code-review/run-ocr.sh origin/main <feature-name>
```

产出将自动持久化至当前特性的自包含资产包 `specs/features/<feature-name>/05-evidence.md`。

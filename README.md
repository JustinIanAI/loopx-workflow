# LoopX AI-Native Coding Workflow 

> 面向 Coding 场景的长程自主研发工作流。场景命令是 `loopx-flow`，控制面是 [LoopX](https://github.com/loopx-project/loopx)。产品需求见 [docs/prd/loopx-workflow.md](docs/prd/loopx-workflow.md)。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![LoopX: v2.x](https://img.shields.io/badge/LoopX-2.x-green.svg)](https://github.com/loopx-project)
[![Node: >=22.22.3](https://img.shields.io/badge/Node-%3E%3D22.22.3-brightgreen.svg)](package.json)

---

## 规格

产品承诺、命令行为和以后怎么改，只看这三处：

- 需求：[docs/prd/loopx-workflow.md](docs/prd/loopx-workflow.md)
- 设计：[docs/design/loopx-workflow-design.md](docs/design/loopx-workflow-design.md)
- 增量：[docs/adr/README.md](docs/adr/README.md)

README 不再重复管线细则。`docs/guides/loopx-workflow-architecture.html` 是展示页。

## 📚 文档分层管理与生命周期治理

依据 [ADR-0006](docs/adr/0006-document-code-change-governance.md)，本项目执行严格的**文档三层分级**与**双轨生命周期治理**，消除形式主义与虚假交付：

### 1. 三层文档分级矩阵

| 文档层级 | 范围与目录 | 治理强度与准入门禁 | 变更要求 |
|---|---|---|---|
| **L1 决策文档 (ADR)** | `docs/adr/NNNN-*.md` | **必须审批**：定义产品破坏性行为、失败语义、架构边界与合入补偿 | 必须立 ADR，且必须经人类 Maintainer 审批放行（Accepted） |
| **L2 契约文档 (PRD & Contract)** | `docs/prd/loopx-workflow.md`<br>`specs/features/<feat>/04-contract.md` | **必须冻结**：定义系统需求 `REQ-*`、接口签名与断言不变量 | 依据已 Accepted 的 ADR 产生，阶段 4 物理锁定指纹（Contract Freeze） |
| **L3 说明文档 (Guidance)** | `README.md`, `docs/QUICKSTART.md`<br>`docs/guides/` | **常规维护**：操作指引、快速上手、环境配置与示例说明 | 随实际行为更新，通过静态死链检查即可，**禁止为其单独立 ADR** |

### 2. 交付生命周期五态模型

严格解耦“决策获批”与“代码实现”，严禁在代码未落地验证前在胶囊中标记 `DELIVERED`：
- **`Proposed`（方案研讨）**：ADR 或 Feature 方案提出，通过 `design-grill` 消除模糊歧义。
- **`Accepted`（决策获批）**：决策通过人类审批（PR-0 决策批合并，或阶段 4 `approve contract` 指纹物理锁定）。**仅代表设计获批，绝不代表代码已实现。**
- **`Implemented`（代码就绪）**：代码编写完毕，四大硬门禁本地全绿。
- **`Verified`（验证通过）**：真实路径用例通过，质量收据完成融合，0 未决 Blocker。
- **`Released`（主干发布）**：`loopx-flow merge` 完成主干 Squash 合入，胶囊整包原子移入 `specs/archive/<feature>/`。

### 3. 双轨交付协议 (Dual-Track Protocol)

- **日常特性研发（同分支单 PR 交付）**：契约（L2）与代码实现在同分支推进。阶段 4 本地锁定契约指纹后直接写代码，提交时文档契约与代码一同发起单一 PR，审查器仅校验“实现是否满足契约”。
- **纯全局文档决策批（Docs-Only PR 审查豁免）**：纯 Markdown PR 豁免 L2 模型对抗性代码审查（不要求代码讲解、不等待 CI），以线下/`design-grill` 决策证据为准，仅跑文档静态三项核验（ADR 元数据、无死链、Markdown 语法合规），人类 Maintainer 直接 Approve 后合入。

## 人只签两次

1. 实现前：`loopx-flow approve contract <feature>`，锁定契约 SHA256。
2. 合入前：在 GitHub 对 PR 点击 Approve，然后 `loopx-flow merge <PR_ID>`。未批准不会调用 `gh pr merge`。

看什么、失败时怎样退出，以详细设计第 5、6、10 节为准。

## 极简上手

### 1. 存量已有项目接入 (1 分钟)
```bash
# 在项目根目录下一键接入工作流骨架
/path/to/loopx-workflow/bin/loopx-flow init

# 运行全维就绪度体检
./bin/loopx-flow doctor
```

### 2. 端到端开发一个新特性 (Feature)
```bash
# 1. 开启新特性管线 (自动建分支、初始化 specs/features/order-pay 资产包与 Goal)
./bin/loopx-flow feature order-pay

# 2. 审阅 specs/features/order-pay/00-INDEX.md 后，执行断点 1 审批
./bin/loopx-flow approve contract order-pay

# 3. 编写代码与单测，随时执行质量门禁与收据自检 (选配 OCR 加 --with-ocr)
./bin/loopx-flow check

# 4. 在 GitHub PR 页面核验并点击 Approve 后，一键原子合并并归档特性包
./bin/loopx-flow merge <PR_NUMBER>
```

### 3. GitHub Issue 缺陷自适应修复
```bash
# 自动打印 LoopX issue-fix 路由：fix_pr、comment_only 或 triage_only。本命令不提交、不推送。
./bin/loopx-flow issue 1024
```

---

## 📂 Feature 资产胶囊结构与审阅看板

每个特性的执行资产仍在 `specs/features/<feature-name>/`。产品需求不在这些文件里。

| 资产文件 | 内容定位 | 审批人看什么 | 一票否决红线 |
|---|---|---|---|
| `00-INDEX.md` | **特性审阅总览看板** | 特性全貌、阶段流转状态、各文档直达链接 | 状态混乱、未经审批擅自开工 |
| `01-decisions.md` | **本胶囊的实现取舍** | 指向了哪份 ADR，没有未决的 “it depends” | 把产品决策写在这里而不写进 `docs/adr/` |
| `02-prd.md` | **需求切片** | 覆盖哪些 `REQ-*` 或 ADR，以及本切片的验收 | 另写一份产品级 PRD |
| `03-stories.md` | **故事拆解与排期** | Job Stories 拆解，单 PR Diff ≤ 500 行 | 任务粒度过大、边界模糊 |
| `04-contract.md` | **不可变契约规范** | 顶部 TypeScript 接口与断言不变量 | 缺失接口类型直接开始编码 |
| `05-evidence.md` | **质量凭据与门禁收据** | 四大门禁实测输出、LoopX Quality Receipt | 门禁带报错、Receipt 与 Diff 不匹配 |

合入后，该目录将整体移入 `specs/archive/<feature-name>/`，保持主工作区绝对干净。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 🙏 致谢开源贡献 (Acknowledgements)

本项目深受开源社区的启发与赋能，特别致谢以下优秀的开源项目及贡献者：

- **[LoopX](https://github.com/loopx-project/loopx)**：长程自主研发底座与原生能力引擎（提供 `change-quality`, `pr-review`, `task-lease` 等生产级 Capabilities）。
- **[Aegis](https://github.com/GanyuanRan/Aegis)**：第一性原理复杂度治理与防熵增方法论（提供 `delete-first`、复杂度极小化与四重实测思想）。
- **[Open Code Review](https://github.com/alibaba/open-code-review)**：阿里巴巴开源的跨模型深度代码审查与静态审计引擎（阿里 OCR CLI）。

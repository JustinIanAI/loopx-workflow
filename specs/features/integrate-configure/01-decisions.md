# 实现取舍

status: DRAFT (Pending JustinIanAI Authorization)

追溯：PRD REQ-FACADE-1 / REQ-FACADE-2 / REQ-NATIVE-1 / REQ-FAILCLOSED-1；[ADR-0001](../../../docs/adr/0001-product-source-of-truth.md)。本项为既有 backlog 的纯增量门面，不新增产品 PRD/ADR。

| 决策点 | 选择与依据 | 否决方案 |
| --- | --- | --- |
| 入口兼容 | `cmd_integrate` 首参数严格匹配 configure 才分派，保留旧 sync/status 分支 | 重写旧解析器会扩大回归面 |
| 参数与引用 | Bash 数组保存输入顺序及每个参数的字节；仅接受三个必填值、plan-file 和两个开关；所有选项只允许出现一次 | 字符串拼接/eval 会破坏空格、引号和元字符 |
| 失败边界 | 本地输入错误 exit 2 且零原生调用；LoopX 缺失或非零 exit 1，保留诊断 | 不替原生检查 ref 存在性、配置冲突等业务规则 |
| 状态权威 | `run_loopx integration-branch configure --repo-path "$PROJECT_ROOT"`；沿用 registry 前置校验 | 不缓存配置，不推断 refs，不生成第二套状态 |

复杂度检查：仅新增一个解析/委托函数与一个入口分派；不引入持久化模型、备用执行路径或新抽象。旧 sync/status 不退役。
原生 `loopx integration-branch configure --help` 已实测支持全部六个选项，exit 0；无待确定方案分支。

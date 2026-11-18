# 临时文件与交付物沙箱

LoopX 治理约定（issue #8 / ADR-0007）：仓库内所有业务脚本与测试必须可并行、可移植、可追溯。

## 规则

1. **临时工件**：一律写入项目本地已忽略沙箱 `.loopx/tmp/`（`loopx-flow init` 创建），
   禁止硬编码系统 `/tmp/<固定名>`。文件名必须唯一：`mktemp`、PID、UUID 或 feature 名组合；
   需要自定义位置时用 `LOOPX_TMP_DIR` 覆盖（CI / 隔离测试），脚本统一读取该变量。
2. **持久化交付物**：审查报告、PR / Issue 证据等不可丢失的产物写入
   `specs/features/<feature>/`（如 `05-evidence.md`）；已合入的交付包归档到
   `specs/archive/<feature>/`。不得依赖系统临时目录承载交付证据。
3. **测试隔离**：单测使用 `os.tmpdir()` + `fs.mkdtempSync()` 创建私有目录，并在 `after`
   钩子或 `finally` 中清理；禁止共享 `/tmp` 固定文件名（会与其他测试 / Agent 竞争并污染环境）。
4. **回归守卫**：`tests/unit/issues/issue-8.test.js` 静态扫描 `bin/`、`scripts/`、`skills/`，
   并校验 `.loopx/tmp/` 被 gitignore、临时路径并行唯一。

## 适用范围

`bin/loopx-flow`、`scripts/**/*.sh`、`skills/**/*.{js,sh}` 以及新增测试。平台差异
（macOS `/private/tmp`、Linux `/tmp`、Windows `%TEMP%`）由统一沙箱吸收，不再散落在业务代码。

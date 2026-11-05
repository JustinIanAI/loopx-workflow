# 故事拆分

1. 运行时工件退出 Git 跟踪面，`.gitignore` 覆盖 `.loopx/**/*.lock` 与 `.loopx/goals/`。
2. `ingest` 收据证据 refs 改取 `git diff --name-only <base>...HEAD` 并过滤运行时工件。
3. `doctor` 增加控制面一致性检查（route / 半迁移残留 / registry 完整性 / 运行时工件）。
4. `doctor` 增加 GitHub API 预算检查（core 50% 基线 + secondary/content 上限说明）。
5. ADR-0007 + PRD/design 回写；胶囊与单测落地；四门禁全绿。

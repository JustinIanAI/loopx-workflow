# gate-signature 故事拆分

- **Goal**：`gate-signature-goal`
- **追溯**：`REQ-GATE-SIGNATURE-1`、ADR-0019

## Story-1：Gate1 GitHub 签名

- **结果**：`accepted_by` 在 PR 上发 `gate=1` 评论即可完成规格授权，无需 TTY。
- **AC**：AC-1、AC-2
- **验证**：`tests/unit/gate-github-signature.test.js`
- **依赖**：无

## Story-2：Gate2 GitHub 签名

- **结果**：`accepted_by` 发 `gate=2` 评论后，`release-approve` 校验并复用，不重复写。
- **AC**：AC-3、AC-4
- **验证**：同文件
- **依赖**：Story-1

## Story-3：负向与兼容

- **结果**：作者/SHA/`spec_commit`/mode 不符即拒绝；`--interactive` 与 `--yes` 语义保持。
- **AC**：AC-5、AC-6
- **验证**：同文件 + 既有 `adr-0009-gate1-auth.test.js` / `adr-0012-gate2.test.js`
- **依赖**：Story-1、Story-2

## 排期

Story-1 → Story-2 → Story-3（串行）

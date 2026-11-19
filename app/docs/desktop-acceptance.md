# 桌面验收证据

在合并前，用隔离桌面 Dev 复走工单中标记为必验的操作。将运行证据和构建产物指纹保存在任务的本地证据目录。实际结果由评审从运行记录判定，脚本检查提交、文件指纹、步骤和验收编号能否对应。参见 [仓库验收规则](../../AGENTS.md#desktop-ac)。

## 为工单声明验收步骤

用单独的 `requirements.json` 记录工单号、必验编号和按顺序执行的步骤。连续编辑同一节点时，为这一组步骤设置 `sameSubject`。

```json
{
  "issue": 62,
  "cases": [
    {
      "id": "AC-3",
      "sameSubject": true,
      "steps": ["two-images", "add-video", "disconnect-video"]
    }
  ]
}
```

## 记录实测构建和操作

`node app/scripts/verify-desktop-acceptance.mjs --print-inputs <构建提交完整 SHA>` 列出 Git 中的桌面构建输入和摘要。构建使用干净的已提交源码。使用另一棵树时，同时记录 PR head 的输入和摘要，并确认相同。

在证据目录保存 `report.json`，这个文件和附件都留在本地。

| 字段 | 记录内容 |
| --- | --- |
| `issue` | 工单编号 |
| `build.commit`、`build.inputsSha256` | 实测构建的来源提交和输入摘要 |
| `build.artifacts` | 实际运行的构建文件，或记录运行产物指纹的文件。每个条目含相对于证据目录的 `path` 和文件 `sha256` |
| `cases[].id`、`cases[].verdict` | 工单验收编号和该项结果。逐项通过时填 `pass` |
| `cases[].steps[]` | 按顺序记录 `id`、实际操作 `action`、观察结果 `result` 和相应的 `artifact`（同样使用 `path` 和 `sha256`）。连续编辑加 `subject`，填写本次实际操作的节点标识 |

以 #62 为例，在同一视频节点依次连接两张图片、连入视频、断开视频。逐步记录模式、入槽素材和提交体，并保留同一节点的标识。

## 检查合入候选

```bash
node app/scripts/verify-desktop-acceptance.mjs \
  --head <最终PR提交完整SHA> \
  --requirements <本地需求文件> \
  --report <本地运行报告>
```

结果为 `verified` 时，构建输入、用例、步骤和文件指纹齐全。合入前仍须核对记录中的实际结果是否满足工单判定条件。换用新候选提交后，核对构建输入或重新实测。

已明确授权提前合入的 P0，在需求文件中以 `emergency` 记录 `priority: "P0"`、待验的 `cases` 与 `authorization`。运行报告保留对应 `id`、`verdict: "pending"`、原因 `reason` 和已执行步骤。脚本用退出码 2 保留待验状态，合入后复走相同操作并更新报告。

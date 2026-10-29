# 本地部署、QLoRA 微调与验证

本项目在 Apple Silicon、16 GB 统一内存的 Mac 上完成了一次真实训练与推理实验。代码、合成数据构造和训练执行由 AI 编码代理辅助完成；结果保留训练日志、原始预测和一致性检查记录。实验数据不包含个人或客户数据，结果只反映本次受控实验。

## 已实际完成

| 项目 | 记录 |
|---|---|
| 实验日期 | 2026-10-29，Asia/Shanghai |
| 基座 | mlx-community/Qwen3-0.6B-4bit，约 335 MB，Apache-2.0 |
| 固定版本 | 73e3e38d981303bc594367cd910ea6eb48349da8 |
| 环境 | Python 3.12；MLX 0.32.4；MLX-LM 0.32.2；完整依赖见 training/requirements.lock.txt |
| 方法 | 4-bit QLoRA，rank 4，最后 8 层，batch 1，学习率 1e-4，60 次优化器更新 |
| 可训练参数 | 日志显示约 0.721M，占 0.121% |
| 数据 | 96 训练、16 验证、16 测试；全部合成；分组模板、主题、来源编号、负责人命名空间互斥 |
| 成果 | 实际 adapter 2,895,443 bytes，约 2.9 MB（2.76 MiB）；原始预测、错误、训练日志、数据与哈希均保存 |

任务只做一条项目记录的结构化抽取：`source_id`、`owner`、`due`、`status`、`risk`。缺失负责人和日期必须返回 `null`；不得猜测。它与报告生成是两个不同的能力，应用中分别处理。

## 固定测试集结果

| 指标 | 基座 | 微调后 |
|---|---:|---:|
| 严格 JSON／schema 合格 | 0/16 (0%) | 14/16 (87.5%) |
| 只移除单一 Markdown 围栏后的 schema 合格 | 11/16 (68.75%) | 14/16 (87.5%) |
| 五字段准确率 | 69/80 (86.25%) | 77/80 (96.25%) |
| 来源编号正确率 | 16/16 | 16/16 |
| 整条记录五字段全对 | 8/16 (50%) | 13/16 (81.25%) |

基座常返回带代码围栏的 JSON，因此“严格 JSON 从 0% 提升”包含格式变化，不能用它宣称语义能力从零起步。字段指标对两组使用相同的单一围栏剥除；不修正字段、不翻译、不补全结果。温度为 0，固定 seed 20261029，最多生成 160 tokens。

3 条微调失败均保留：`SIM-2001` 将缺失 owner 写成字符串 `unknown`；`SIM-2006` 和 `SIM-2016` 将缺失 due 写成 `unknown`，违反应返回 `null` 的规则。应用网关对日期及来源做独立校验，并拒绝不合格输出；仍需人工核对。

验证 loss 从 1.444 降到第 30 步的 0.106，第 60 步回升到 0.152。最终 adapter 按事先固定的 60 步计划保存，没有根据测试集调参或选最好的一轮。这也表明更多训练不一定更好。

样本量只有 16 条、4 个未见模板，且共用输出 schema 和词汇；结果只证明这次小规模实验。更广泛的应用需要新增真实授权数据、更多异常场景与独立测试，不能据此声称全面准确或节约客户成本。

## 使用已训练的 adapter

仓库已包含本次训练的 adapter。首次在 Apple Silicon 上运行时，在仓库根目录建立环境并启动服务，无需重新训练：

```sh
python3.12 -m venv training/.venv
training/.venv/bin/python -m pip install -r training/requirements.lock.txt
training/serve.sh
```

首次启动会下载固定版本的基座。另开终端运行 `npm run server`，再开终端运行 `npm run dev`，在应用的模型实验页使用抽取功能。应用依赖需先按根目录 README 执行 `npm ci`。

## 从头复现实验

在仓库根目录执行；需 Apple Silicon、足够内存与首次下载模型的网络连接。依赖隔离于项目虚拟环境，基座模型不进入 Git。

以下步骤会重写 adapter、预测及公开报告；应在单独的工作副本中进行，保留仓库已发布的原始实验记录。固定 seed 与依赖有助于复现流程，不保证不同机器或系统上的浮点结果逐位相同。重新训练前先停止该工作副本的模型服务。

```sh
python3.12 -m venv training/.venv
training/.venv/bin/python -m pip install -r training/requirements.lock.txt
training/.venv/bin/python training/build_dataset.py
training/.venv/bin/python training/evaluate.py --output training/results/baseline.json
MODEL_PATH=$(training/.venv/bin/python training/model_path.py)
training/.venv/bin/mlx_lm.lora --config training/config.yaml --model "$MODEL_PATH" > training/results/training.log 2>&1
training/.venv/bin/python training/evaluate.py --adapter training/adapters --output training/results/adapted.json
training/.venv/bin/python training/publish_results.py
```

`build_dataset.py` 使用固定构造逻辑并检查重复；`data/manifest.json` 保存分组策略、数量和 SHA-256。不要在观察测试结果后将测试记录加入训练；后续迭代应另建未见测试集。运行 `publish_results.py` 只发布实测汇总，不会生成或美化预测。

已发布证据可执行 `python3 training/verify_artifacts.py` 核对；本次通过 106 项一致性检查。安装模型依赖后，还可运行 `training/.venv/bin/python training/publish_results.py --check`，在不改写报告的情况下复算报告，并核对保存的训练参数和日志中的实际 loss。这些检查不等于第三方认证或真实客户验收。

## 本地部署与真实 HTTP 测试

```sh
training/serve.sh
# 另一个终端，在仓库根目录：
training/.venv/bin/python training/smoke_server.py
```

服务绑定 `127.0.0.1:8080`，使用固定模型版本和本地 adapter，关闭 thinking，贪心生成。`training/results/server-smoke.json` 记录真实 HTTP 请求、新的合成输入、返回内容与核验结果；本次 5 字段全部正确。它是单条冒烟测试，与 16 条独立测试分开报告。

应用的 Node 网关调用 MLX 的 `/v1/chat/completions`，请求模型名必须是 `default_model`，以使用启动时绑定的 adapter。浏览器通过网关 `/api/extract` 访问，不直接暴露模型服务。MLX 官方说明该服务器仅有基本安全检查；此方案用于本地实践，不能未经加固直接暴露公网。

GitHub Pages 部署仅承载静态界面和已完成实验的结果。它不执行训练、不托管模型，也不自动连接访问者电脑；实时微调模型体验需要在本地启动上述服务和应用网关。实际上线状态以远程仓库、Actions 和网页检查为准。

## 实验解释与复现核查

本实验比较相同基座、提示词与测试记录下，加载适配器前后的五字段抽取结果。严格 JSON 合格率衡量原始输出是否满足解析和 schema 要求；字段准确率允许移除单一 Markdown 围栏后逐字段比较。这两个指标分别反映格式合规与字段匹配情况，不能互相替代。

复核时应同时检查数据分组、模型版本、解码条件、保存的原始预测及缺失值错误。`verify_artifacts.py` 将文件哈希与公开报告对照，并从原始预测重新计算指标；`publish_results.py --check` 进一步核对保存的训练参数和日志中的实际 loss。核查通过表示仓库产物一致，不证明模型对未评估数据同样可靠。

应用网关的来源、日期和缺失值检查属于模型之外的控制。网关修正或拒绝结果不计入原始模型分数；真实部署还需针对使用场景增加独立测试、输出复核和服务安全措施。

## 一手参考

- [MLX-LM LoRA / QLoRA 指南](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md)
- [MLX-LM 本地服务器](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md)
- [模型卡与许可证](https://huggingface.co/mlx-community/Qwen3-0.6B-4bit)

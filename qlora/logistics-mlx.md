# Mac 上的 Qwen3.5-4B 物流短训

实跑环境为 Apple M6、32 GB 统一内存、Python 3.12.16、MLX 0.32.5、MLX-LM 0.32.2。用 MLX 在 `Device(gpu, 0)` 上求值矩阵乘法，GPU 返回 Apple M6，矩阵元素结果为 256.0。完整 Python 依赖版本见本地 `qlora/output/mlx-logistics/environment.txt`。[MLX-LM v0.32.2](https://github.com/ml-explore/mlx-lm/releases/tag/v0.32.2)

底座为 `mlx-community/Qwen3.5-4B-MLX-4bit`，固定 revision `32f3e8ecf65426fc3306969496342d504bfa13f3`。量化配置为 4-bit affine，group size 64。短训冻结底座，在最后 16 层中的全注意力层挂载 Q/V rank 8 LoRA，总计 459,000 个可训练参数（日志取整）。[固定模型版本](https://huggingface.co/mlx-community/Qwen3.5-4B-MLX-4bit/tree/32f3e8ecf65426fc3306969496342d504bfa13f3)

## 数据和训练目标

复用原有 18 条训练、7 条验证和 10 条独立验收。每条训练或验证对话单独监督一次工具调用和一次结果回复，缺订单号的多轮对话另外监督第一次追问。MLX-LM 按最后一条助理消息计算损失，历史消息中的参考工具调用和完整工具结果作为回复的输入。[MLX-LM LoRA 数据格式](https://github.com/ml-explore/mlx-lm/blob/v0.32.2/mlx_lm/LORA.md#data)

| 集合 | 原对话 | 工具调用 | 结果回复 | 缺号追问 | 最长序列 |
| --- | --- | --- | --- | --- | --- |
| 训练 | 18 | 18 | 18 | 4 | 642 token |
| 验证 | 7 | 7 | 7 | 1 | 648 token |
| 独立验收 | 10 | — | — | — | — |

[转换脚本](../training/logistics/mlx_prepare.py) 逐条用训练器实际采用的 tokenizer 和掩码校验。全部训练及验证序列都在 768 token 内，工具名、订单号、工具结果和最终回答均完整。验收数据用于隔离检查和独立评估。

正式训练使用 batch size 1 和 seed 42。按 MLX-LM 的批次排序和随机抽样顺序复核，18 步实际抽到 7 个工具调用目标、9 个结果回复目标、2 个追问目标。[MLX-LM 训练循环](https://github.com/ml-explore/mlx-lm/blob/v0.32.2/mlx_lm/tuner/trainer.py)

## 训练和保存结果

| 运行 | 优化步数 | 进程耗时 | 峰值进程内存 | 最大常驻内存 |
| --- | --- | --- | --- | --- |
| 探跑 | 2 | 33.80 秒 | 13.20 GiB | 4.47 GiB |
| 正式短训 | 18 | 148.42 秒 | 19.09 GiB | 6.78 GiB |

内存数据来自 macOS `/usr/bin/time -l`。正式训练的验证损失从 1.279 降至 0.553。日志在标为第 18 步的验证完成后执行最后一次更新，该步单批训练损失为 1.432。第 6、12、18 步均保存了检查点。最终 `adapter/adapters.safetensors` 为 1,836,975 字节，与第 18 步检查点逐字节一致。

## 复跑命令

在项目根目录运行。下载后先核对固定权重哈希。单独的探跑输出写入 `probe/`，正式训练从同一底座重新开始。

~~~bash
run=qlora/output/mlx-logistics
python3.12 -m venv "$run/venv"
"$run/venv/bin/python" -m pip install 'mlx-lm==0.32.2' 'mlx==0.32.5' \
  'transformers==5.24.1' 'huggingface_hub==2.5.0' 'tokenizers==0.23.3'
"$run/venv/bin/python" -m pip freeze > "$run/environment.txt"
"$run/venv/bin/hf" download mlx-community/Qwen3.5-4B-MLX-4bit \
  config.json tokenizer_config.json chat_template.jinja tokenizer.json \
  model.safetensors.index.json model.safetensors --local-dir "$run/model" \
  --revision 32f3e8ecf65426fc3306969496342d504bfa13f3
printf '%s  %s\n' 5fb9acd0246866381cf8c5c354c6db1019f6498eec4ccb4f5edcc71ffeacb2db \
  "$run/model/model.safetensors" | shasum -a 256 -c -

python3.12 training/logistics/validate.py
"$run/venv/bin/python" training/logistics/mlx_prepare.py
NO_COLOR=1 /usr/bin/time -l "$run/venv/bin/mlx_lm.lora" --config qlora/logistics-mlx.yaml \
  --iters 2 --save-every 2 --val-batches 2 --adapter-path "$run/probe" > "$run/probe.log" 2>&1
NO_COLOR=1 /usr/bin/time -l "$run/venv/bin/mlx_lm.lora" --config qlora/logistics-mlx.yaml \
  > "$run/train.log" 2>&1

"$run/venv/bin/python" training/logistics/mlx_evaluate.py --model "$run/model" --output "$run/base.json"
"$run/venv/bin/python" training/logistics/mlx_evaluate.py --model "$run/model" \
  --adapter "$run/adapter" --output "$run/adapted.json" --compare "$run/base.json"
~~~

本机实跑的下载使用现有本地代理向 Hugging Face 请求同一个固定版本，权重 SHA-256 校验通过。评估直接在本地 MLX 调用模型，使用同一底座和 tokenizer、关闭思考、贪心解码、每次最多 256 个新 token。工具调用和最终答复分别评分，最终答复回放同一个冻结工具响应。

## 实际加载和前后对比

[评估脚本](../training/logistics/mlx_evaluate.py) 用 `mlx_lm.load` 加载最终适配器。保存的 16 个 LoRA 张量与模型中的参数逐一比对一致，8 个 LoRA B 张量均包含非零权重。两次评估的权重、配置、tokenizer、验收集哈希和生成设置一致，全部生成正常结束。

| 10 条独立验收的指标 | 原底座 | 加载适配器 |
| --- | --- | --- |
| 缺号时先追问 | 2/2 | 2/2 |
| 工具名正确 | 10/10 | 10/10 |
| `recordId` 正确 | 10/10 | 10/10 |
| 回复符合工具结果（规则） | 9/10 | 10/10 |
| 回复符合工具结果（人工复核） | 10/10 | 10/10 |
| 凭空承诺预计送达时间（人工复核） | 0/10 | 0/10 |

`a06-eta-mock` 问 DEMO-1002 能否在傍晚前送到。两个模型均生成 `lookup_logistics({"recordId":"DEMO-1002"})`。冻结的工具结果显示包裹到达配送站、等待派送，未提供 ETA。

**原底座**

> DEMO-1002 这单目前状态是“运输中”，包裹已于11月24日到达配送站，等待派送。
>
> 关于能否在傍晚前送达，目前没有该信息，具体派送时间请以快递员通知为准。

**加载适配器**

> 这单包裹已揽收，到达配送站等待派送。目前工具未提供预计送达时间，无法确认能否在傍晚前送达。

原回复的「目前没有该信息」超出原有规则的匹配范围，人工复核确认两次都准确说明 ETA 未知。适配器更直接地交代信息缺失的原因。这组验收没有观察到行为正确率提升。

本地证据集中在 `qlora/output/mlx-logistics/`。数据校验明细见 `data/audit.json`，训练日志见 `probe.log` 和 `train.log`，最终权重见 `adapter/adapters.safetensors`，两轮调用、答复及评分原文见 `base.json` 和 `adapted.json`。

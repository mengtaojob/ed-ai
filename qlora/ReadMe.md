# 查物流 QLoRA 小试验

本试验覆盖中文物流查询。下面记录 ShareGPT 数据、Ollama 基线和 LLaMA-Factory 的 CUDA 配置。Apple Silicon 上的训练、适配器加载及前后对比见 [Mac 实跑记录](logistics-mlx.md)。

## 数据和回放

| 文件 | 用途 |
| --- | --- |
| [train.json](../training/logistics/train.json) | 18 条训练示范，含 4 条先追问订单号的多轮对话。全部使用合成离线回放。 |
| [validation.json](../training/logistics/validation.json) | 7 条训练中验证样例，含 1 条追问。使用独立的合成订单与措辞。 |
| [acceptance.json](../training/logistics/acceptance.json) | 10 条验收用例。6 条冻结在线 Koa 响应，1 条冻结工具降级响应，3 条为合成离线回放。 |
| [dataset_info.json](../training/logistics/dataset_info.json) | LLaMA-Factory 的 ShareGPT 列和角色映射，仅注册训练和验证集。 |

标准示范为 `human → function_call → observation → gpt`。多轮样例在前面加 `human → gpt 追问`，编号出现在第二条用户消息中。`function_call.value` 是含 `name` 与 `arguments` 的 JSON 字符串。工具为 `lookup_logistics`，参数为 `recordId`，工具结果为 `{code, message, data}`。[ShareGPT 工具调用格式](https://github.com/hiyouga/LlamaFactory/blob/v0.9.5/data/README.md#sharegpt-format)

验收集的 `metadata.source` 标明响应怎么来的。`mock_http` 为真实 Koa 结果，来自已签收 `DEMO-1001`、运输中 `DEMO-1002`、已存在但暂无物流 `DEMO-1003` 和查无订单 `DEMO-9999`。`tool_fallback` 来自将实际 Mastra 物流工具指向没有监听的本机端口后得到的 `BUSINESS_UNAVAILABLE`。`synthetic` 为另外构造的工具响应。训练和验证数据中的编号没有放入业务 Mock。

- `ORDER_NOT_FOUND` 表示查无订单，请用户核对订单号。
- `SHIPMENT_NOT_FOUND` 表示订单存在但暂无物流记录。
- `BUSINESS_UNAVAILABLE` 表示业务查询此时无法完成，需稍后再试。
- 成功响应可以提供运单与已有轨迹。若没有预计送达时间，回复应如实说明。

[校验脚本](../training/logistics/validate.py) 检查每条样例的角色顺序、工具名、订单参数、响应字段以及三个集合的订单号、模板标签和去订单号后的提问指纹。它还拦截高度相似的跨集合措辞。合成用例使用不同订单号段。三个数据集都有六类场景。

以下命令都从项目根目录运行。第二条命令依赖本地 Ollama。本轮实际生成了 `training/logistics/baseline-ollama.json`，并用 `--mock-url` 和本地 Koa 逐字段核对了四个真实 Mock 响应。复跑命令把新报告放在忽略目录，避免覆盖原始基线。

~~~bash
python3.12 training/logistics/validate.py
python3.12 training/logistics/evaluate.py --output qlora/output/ollama-rerun.json

# 在本地 Koa 已启动时重新核对冻结的 Mock
python3.12 training/logistics/validate.py --mock-url http://127.0.0.1:3000
~~~

## 原模型基线和评估方法

[Ollama 原始报告](../training/logistics/baseline-ollama.json) 记录了模型摘要、验收集 SHA-256、固定生成设置、逐例工具调用和原始回复。[回放脚本](../training/logistics/evaluate.py) 分开测三个环节。

| 环节 | 方法 |
| --- | --- |
| 追问 | 给模型缺少编号的首条消息，检查它是否询问订单号并避免调用工具。 |
| 工具调用 | 提供可用工具及用户消息，检查模型自己选择的工具名和 `recordId`。多轮请求使用固定的参考追问，避免前一步偶发错误影响这里的结果。 |
| 回复忠实度 | 无论模型自行调用是否成功，都用正确的调用和冻结响应重新发起一次推理。检查状态、用户要求的运单号、额外编号与可疑送达承诺，并结合原文人工复核。 |

这个离线基线仅测 Qwen；生产 Agent 的 LAYA 路由、工具强制选择和真实 Koa 网络请求另有各自的验收入口。固定的原模型运行使用本地 Ollama 0.40.18 和现有 `qwen3.5:4b`，模型摘要见报告。生成温度为 0、`top_p=1`、上限 256 tokens，Ollama 的种子为 42，并关闭显式思考。

验收用例 `a06-eta-mock` 是主要改进目标。原模型在询问「傍晚前能否送到」时漏调了物流工具，收到真实轨迹回放后又声称预计会在傍晚前送到。该轨迹只有「到达配送站，等待派送」。建议以报告中的工具调用和答复原文为准，规则打分可以漏掉其他措辞或错报，不等同于人工事实核验。

| 指标 | 本轮原模型结果 |
| --- | --- |
| 缺订单号时正确追问 | 2/2 |
| 工具名和参数同时正确 | 9/10 |
| 回放回复与工具事实一致 | 9/10，逐条回看原文与规则评分一致 |
| 编造预计送达时间 | 1/10，在 2 条明确询问 ETA 的用例中出现 1 次 |

## LLaMA-Factory 配置和本机检查

[短训配置](logistics-sft.yaml) 使用 LLaMA-Factory **v0.9.5**、对话版权重 **Qwen/Qwen3.5-4B**、固定 HF revision `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` 和 `qwen3_5_nothink`。训练使用 bitsandbytes **4-bit NF4**，更新 Q/V 投影的 rank 8 LoRA，冻结视觉部分。试跑 18 步，每 6 步评估并保留可恢复的检查点。[LLaMA-Factory v0.9.5](https://github.com/hiyouga/LlamaFactory/releases/tag/v0.9.5) · [模板源码](https://raw.githubusercontent.com/hiyouga/LlamaFactory/v0.9.5/src/llamafactory/data/template.py) · [4-bit 量化源码](https://raw.githubusercontent.com/hiyouga/LlamaFactory/v0.9.5/src/llamafactory/model/model_utils/quantization.py) · [固定模型版本](https://huggingface.co/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a)

2026 年 11 月 27 日实测设备为 Apple Silicon、32 GiB 和 Python 3.12.16。现有 LAYA 虚拟环境里的 PyTorch 2.15.0 返回 `MPS=True`、`CUDA=False`，未找到 LLaMA-Factory CLI、bitsandbytes 或固定版 HF 权重缓存。该环境的 Transformers 5.24.1 也超过 v0.9.5 声明的上限 5.6.0。bitsandbytes 0.50.2 的官方安装文档把 macOS arm64 列在 CPU 后端。Ollama 的 MLX 推理权重和运行环境没有验证过这条 NF4 训练路径。[bitsandbytes 0.50.2 平台说明](https://huggingface.co/docs/bitsandbytes/v0.50.2/en/installation#cpu) · [LLaMA-Factory 依赖](https://github.com/hiyouga/LlamaFactory/blob/v0.9.5/pyproject.toml)

**CUDA 路线已核对配置。** 两份 YAML 的模型版本、模板和量化字段已检查。RTX 4090 环境可按下面的命令跑短训。

## 在 CUDA 环境运行短训

在有支持 BF16 的 CUDA GPU 的环境进入项目根目录。用独立虚拟环境安装固定版本，然后检查 CUDA 和 bitsandbytes 能导入。

~~~bash
python3.12 -m venv qlora/.venv
source qlora/.venv/bin/activate
python -m pip install "llamafactory @ git+https://github.com/hiyouga/LlamaFactory.git@v0.9.5" "transformers==5.6.0" "bitsandbytes==0.50.2"
python -c 'import torch, bitsandbytes; assert torch.cuda.is_available() and torch.cuda.is_bf16_supported()'
python training/logistics/validate.py
llamafactory-cli train qlora/logistics-sft.yaml
~~~

训练首次运行会把固定版本的 HF 权重下载到 `qlora/output/hf-cache`。训练中断且已有第 6 步检查点时，可恢复到配置中的 18 步。

~~~bash
llamafactory-cli train qlora/logistics-sft.yaml resume_from_checkpoint=qlora/output/logistics-sft/checkpoint-6
~~~

成功的证据是训练日志包含完成的步数和验证损失，输出目录包含 checkpoint 和两个适配器文件。仅出现文件时还需实际加载验证。输出目录和虚拟环境均被 Git 忽略。

~~~bash
test -s qlora/output/logistics-sft/adapter_config.json
test -s qlora/output/logistics-sft/adapter_model.safetensors
~~~

## 适配器加载与前后对比

先用 [同一份推理配置](logistics-api.yaml) 启动 HF 底座 API，运行固定验收。关掉这个进程释放显存，在同样的配置上加载适配器。下列两组各用一个服务终端和一个评估终端。

~~~bash
API_HOST=127.0.0.1 API_PORT=8011 API_MODEL_NAME=logistics-base llamafactory-cli api qlora/logistics-api.yaml
~~~

~~~bash
python training/logistics/evaluate.py --backend llamafactory --base-url http://127.0.0.1:8011/v1 --model logistics-base --label hf-base --output qlora/output/hf-base.json
~~~

~~~bash
API_HOST=127.0.0.1 API_PORT=8011 API_MODEL_NAME=logistics-adapter llamafactory-cli api qlora/logistics-api.yaml adapter_name_or_path=qlora/output/logistics-sft
~~~

~~~bash
python training/logistics/evaluate.py --backend llamafactory --base-url http://127.0.0.1:8011/v1 --model logistics-adapter --label hf-adapter --output qlora/output/hf-adapter.json --compare qlora/output/hf-base.json
~~~

两次 HF 评估使用同一份验收数据、模板、量化设置和贪心生成。判断改进时，先看 `a06-eta-mock` 是否正确调用工具并承认缺少 ETA，再核对追问与三种失败回复有无退步。Ollama 使用不同权重格式与运行时，和 HF 适配器的分差无法单独归因于微调。10 条用例只用于这轮实验的验收。

# LAYA 本地推理服务

本服务使用 Python 3.12 和 LAYA 的官方 HTTP 服务，在本地 CPU 上预加载 `multilingual` 检查点。默认监听 `127.0.0.1:8000`，从 Hugging Face 的本地缓存读取模型。

## 启动

在项目根目录运行 `./model-services/laya/start.sh`。脚本优先使用 `~/.venvs/laya/bin/python`，也可以用 `LAYA_PYTHON` 指定虚拟环境的 Python。如果安装的 LAYA 缺少 HTTP 服务依赖，本项目验证的版本可以用以下命令补齐。

```bash
~/.venvs/laya/bin/python -m pip install 'laya[serve]==0.5.3'
```

若首次启动时没有多语言模型缓存，用 `HF_HUB_OFFLINE=0 ./model-services/laya/start.sh` 下载模型。缓存完成后可以用默认的离线模式启动。

## Node.js 调用

```bash
curl -fsS http://127.0.0.1:8000/health
node model-services/laya/demo.mjs
node model-services/laya/demo.mjs '我买的墨盒已经寄出三天，快递到哪儿了？'
```

`demo.mjs` 和 Mastra Agent 共用 `client.mjs`，通过 Node.js 内置 `fetch` 调用 `POST /v1/systemone`。无参数时依次验证七个中文样例，有参数时输出该句的分类、置信分数和实际使用的模型。每次请求返回一个主意图，问候或闲聊可归为 `other`。

自定义端口时在服务端设置 `LAYA_PORT`，调用端相应设置 `LAYA_BASE_URL`。如果服务端配置了 `LAYA_API_KEY`，调用端读取同名环境变量发送 Bearer 认证。

[LAYA 项目与服务说明](https://pypi.org/project/laya/) · [多语言模型说明](https://huggingface.co/convaiinnovations/laya)

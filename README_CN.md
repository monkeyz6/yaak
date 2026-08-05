<p align="center">
  <a href="https://github.com/JamesIves/github-sponsors-readme-action">
    <img width="200px" src="https://github.com/mountain-loop/yaak/raw/main/crates-tauri/yaak-app-client/icons/icon.png">
  </a>
</p>

<h1 align="center">
  Yaak ➟ 桌面端 API 客户端
</h1>

<p align="center">
  一款快速、隐私优先的 API 客户端，支持 REST、GraphQL、SSE、WebSocket 和 gRPC — 基于 Tauri、Rust 和 React 构建。
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

<p align="center">
  本项目 Fork 自 <a href="https://github.com/mountain-loop/yaak">mountain-loop/yaak</a>，在原有基础上新增了多项实用功能。
</p>

<br>

![Yaak API Client](https://yaak.app/static/screenshot.png)

## 功能特性

Yaak 是一款离线优先的 API 客户端，专注于不打扰你的同时，在你需要时提供一切所需功能。基于 [Tauri](https://tauri.app)、Rust 和 React 构建，快速、轻量且注重隐私。无遥测、无 VC 资金依赖、无云锁定。

### 支持所有 API 类型

- 从 Postman、Insomnia、OpenAPI、Swagger 或 Curl 导入集合
- 通过 REST、GraphQL、gRPC、WebSocket 或 Server-Sent Events 发送请求
- 使用 JSONPath 或 XPath 过滤和检查响应

### 安全可靠

- 使用 OAuth 2.0、JWT、Basic Auth 或自定义插件进行认证
- 使用加密密钥保护敏感数据
- 将密钥存储在操作系统钥匙串中

### 组织与协作

- 将请求分组到工作区和嵌套文件夹中
- 使用环境变量在开发、测试和生产环境之间切换
- 将工作区同步到文件系统，便于 Git 版本控制或 Dropbox 同步

### 扩展与自定义

- 使用模板标签插入动态值（如 UUID 或时间戳）
- 选择内置主题或自定义主题
- 创建插件扩展认证、模板标签或 UI

---

## Fork 新增功能

以下功能为本 Fork 版本新增，上游原版不包含：

### 中文界面 (i18n)

完整的简体中文界面翻译。应用的所有界面元素均已本地化，为中文用户提供原生使用体验。

### 请求后置 JSONPath 提取

使用 JSONPath 表达式自动从 API 响应中提取值，并写入环境变量。适用于需要链式调用的场景——例如从登录接口获取 Token 后自动注入到后续请求中。

### AI SSE 流可读化视图

增强的 Server-Sent Events 查看器，可自动识别 AI 流式响应格式（OpenAI Chat Completions、OpenAI Responses、Anthropic Messages），并渲染为人类可读的文本视图。对于支持推理/思考的模型，还会分离显示 reasoning 内容。

### AI 请求体格式互转

支持在三种主流 AI API 请求格式之间互相转换：

| 源格式                  | 目标格式                |
| ----------------------- | ----------------------- |
| Anthropic Messages      | OpenAI Chat Completions |
| Anthropic Messages      | OpenAI Responses        |
| OpenAI Chat Completions | Anthropic Messages      |
| OpenAI Chat Completions | OpenAI Responses        |
| OpenAI Responses        | Anthropic Messages      |
| OpenAI Responses        | OpenAI Chat Completions |

转换过程中会提示被丢弃的字段、不支持的内容类型等边界情况。

### 置顶快捷切换

将常用环境变量置顶到一个可折叠的工具栏中，实现即时访问。无需打开环境编辑器即可在候选值之间快速切换——非常适合在不同的 API Key、Base URL 或功能开关之间切换。

---

## 安装说明

### 从 Release 下载

前往 [Releases](https://github.com/monkeyz6/yaak/releases) 页面下载对应操作系统的安装包。

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/monkeyz6/yaak.git
cd yaak

# 安装依赖
npm install

# 启动开发模式
npm run dev
```

更多构建细节请参考 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 贡献指南

> [!IMPORTANT]
> 社区 PR 目前仅限 Bug 修复。
> 如果你的 PR 不是 Bug 修复，请关联 @gschier 明确允许你工作的[反馈项](https://yaak.app/feedback)。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 相关资源

- [反馈与 Bug 报告](https://feedback.yaak.app)
- [官方文档](https://yaak.app/docs)
- [Yaak vs Postman](https://yaak.app/alternatives/postman)
- [Yaak vs Bruno](https://yaak.app/alternatives/bruno)
- [Yaak vs Insomnia](https://yaak.app/alternatives/insomnia)

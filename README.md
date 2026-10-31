# Workbench 日常工具箱

Windows 桌面应用，使用 Electron、Vue 3、TypeScript、Element Plus、Pinia 和 SQLite。

## 首版功能

- 工具目录、搜索、分类、收藏、最近使用、浅色和深色主题。
- Git 项目添加、检测、移除，本地和远程分支列表、比较基准、合并状态、本地分支切换。
- 获取远程并清理失效引用，批量删除分支、逐项结果与操作记录。
- JSON 校验、格式化、压缩、复制与下载，保留超大整数精度。
- 文本逐行去重、空白处理、大小写选项、排序、复制与下载。
- 秒与毫秒时间戳转换、本地和 UTC 时间显示。

## 使用

安装 `release/0.1.2/Workbench-Setup-0.1.2.exe`，或直接运行 `release/0.1.2/win-unpacked/Workbench.exe`。

界面采用固定导航与分区滚动：Git 项目列表、分支表格分别滚动，仓库操作栏和表头保持可见；JSON 和文本工具的输入、输出区域也可独立滚动。

Git 功能需要电脑已安装 Git。默认使用 PATH 中的 `git`，也可以在设置中指定 `git.exe`。远程认证沿用已有 Git/SSH 配置；程序不保存密码，不弹出交互式终端，认证失败时会显示 Git 错误。

添加项目只保存仓库根目录。移除项目只移除工具箱记录，不删除任何项目文件。应用数据保存在 Electron 的用户数据目录，可在设置中打开；Windows 通常为 `%APPDATA%/workbench-toolbox`。卸载默认保留数据。

## 分支删除规则

- 当前分支、比较基准、保护规则匹配分支、远程默认分支及其他 worktree 占用分支不能删除。
- `main`、`master`、`develop` 始终保护，初始规则还包含 `release/*`。
- “已合并”表示该分支提交可从所选比较基准到达，不按分支名称或更新时间自动认定无用。
- 未合并分支需要勾选强制删除，并输入项目名；删除远程分支也需要输入项目名。
- 删除前重新读取仓库并比对提交；远程删除会检查服务器实际默认分支，并使用 `--force-with-lease` 拦截尚未获取的服务器变更。无法识别服务器默认分支时阻止远程删除。
- 仓库操作按项目串行执行；其他 Git 客户端仍可能同时修改仓库，操作后应刷新状态。
- 首次清理建议先执行“同步远程”。本地和远程分支是独立条目，按实际勾选分别删除。
- 未提交修改时禁止在面板切换分支；不会自动提交、暂存或清理文件。

## 开发

需要 Node.js **22.12 或以上**（建议 24 LTS）、npm 和 Git。安装后的应用自带运行时，不要求用户安装 Node.js。

```bash
npm install
npm run dev
npm run test
npm run build
npm run dist
```

`npm run dev` 自动选择空闲本地端口，并启动桌面窗口。Electron 主进程修改后需重启开发命令。仅预览页面可执行 `npm run dev:web`；网页模式可使用数据工具，本地 Git 功能需桌面版。

```bash
node scripts/smoke.cjs
```

桌面冒烟测试使用临时仓库、临时 SQLite 和模拟的目录选择结果，不操作现有仓库。截图输出至 `output/playwright`。设置 `WORKBENCH_EXE` 可对打包后的可执行程序运行相同测试；设置 `WORKBENCH_WEB_URL` 可额外验证 Edge 中的桌面和移动布局。

## 扩展工具

工具元数据登记于 `src/renderer/tools.ts`，页面按模块放入 `src/renderer/components`。需要本地能力时，在 `src/main` 实现，并通过 `src/preload` 和 `src/shared/types.ts` 暴露明确的调用接口。渲染页面无法直接访问 Node.js 或执行任意命令。

## 安装包

使用 electron-builder 和 NSIS 构建 Windows x64 安装包。当前构建未配置代码签名证书，Windows 可能显示未知发布者提示。正式对外发布前应配置签名。

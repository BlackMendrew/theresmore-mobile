# Theresmore (packaged)

可直接静态托管的打包产物，目录内容即站点根目录，**无需构建**。

- 入口：`index.html`（脚本在 `web/`，依赖在 `engine/`，数据表在 `data/`，图片在 `images/`）
- 存档：浏览器 localStorage（键 `theresmore-replica`）；支持 `?seed=NNN` 固定随机种子

## 部署到 Cloudflare Pages

连接本仓库时使用：

| 设置项 | 值 |
| --- | --- |
| Framework preset | None |
| Build command | （留空） |
| Build output directory | `/` |
| Root directory | `/` |

或直接用命令行上传：`npx wrangler pages deploy . --project-name=<你的项目名>`

部署完成后在 Pages 项目的 **Custom domains** 里绑定你的域名即可。

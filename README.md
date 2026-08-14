# notes-h5

GitHub Pages H5 笔记站 + 管理后台（支持批量导入 Markdown / H5）。

## 地址

- 站点：https://aiiw.github.io/notes-h5/
- 管理：https://aiiw.github.io/notes-h5/admin/

## 批量导入

1. 打开管理后台，登录 Token
2. 在「批量导入 Markdown / H5」选择多个 .md 或 .html
3. 点「解析预览」→「一键发布到 GitHub」

Markdown 按 ## 二级标题自动拆成折叠章节；H5 按 ccordion 结构解析。

## 本地发布（可选）

复制 .env.example 为 .env，写入新 Token 后执行：

`ash
python publish_to_github.py
`

不要把 .env 提交到仓库。

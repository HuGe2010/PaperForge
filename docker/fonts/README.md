# 字体子集（思源黑体常用字）

PDF 导出使用 `pdfmake` + 思源黑体（Source Han Sans / Noto Sans SC）常用字子集，覆盖 GB2312 约 6763 个汉字 + 标点 + 拉丁字符。

## 为何做子集而不是构建期裁剪
构建期无法预知试卷内容，不能按"用到的字"裁。正确做法是镜像放**常用字集**字体，
pdfmake 在**生成 PDF 时自动做 glyph 子集嵌入**，最终文件依然很小。

## 放置方式
将生成的字体文件放到本目录：
- `SourceHanSansSC-Regular.ttf`（正文）
- `SourceHanSansSC-Bold.ttf`（标题/加粗）

并在 `backend/src/modules/export/pdf.service.ts` 的 `pdfmake` vfs 中引用。

## 生成子集（参考命令，需本机有 fonttools）
```bash
# 用 fonttools 提取常用字 + 标点，输出子集 ttf
pyft-subset SourceHanSansSC-Regular.otf \
  --text-file=gb2312.txt \
  --output-file=SourceHanSansSC-Regular.ttf \
  --layout-features='*' --no-hinting
```

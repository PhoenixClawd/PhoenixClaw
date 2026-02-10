# HTMLCSStoImage API 配置

## 简介

OpenClaw Visual 使用 [HTMLCSStoImage](https://htmlcsstoimage.com/) API 将 HTML/CSS 转换为图片。

## 注册与配置

### 1. 注册账号

1. 访问 [htmlcsstoimage.com](https://htmlcsstoimage.com/)
2. 点击 "Get Started"
3. 使用邮箱注册账号

### 2. 获取 API 密钥

1. 登录 [Dashboard](https://htmlcsstoimage.com/dashboard)
2. 找到 **User ID** 和 **API Key**
3. 记录下来备用

### 3. 配置环境变量

在 OpenClaw 配置文件中添加：

```bash
# ~/.openclaw/config.yaml
env:
  HCTI_USER_ID: "your-user-id"
  HCTI_API_KEY: "your-api-key"
```

或在启动时设置：

```bash
export HCTI_USER_ID="your-user-id"
export HCTI_API_KEY="your-api-key"
```

## API 使用

### 基本调用

```bash
curl -s "https://hcti.io/v1/image" \
  -X POST \
  -u "${HCTI_USER_ID}:${HCTI_API_KEY}" \
  --data-urlencode "html=<div>Hello</div>" \
  --data-urlencode "css=div { color: red; }"
```

### 从文件读取

```bash
# 写入 HTML 到文件
cat > /tmp/visual_html.txt << 'EOF'
<div class="card">
  <h1>Hello World</h1>
</div>
EOF

# 写入 CSS 到文件
cat > /tmp/visual_css.txt << 'EOF'
.card { padding: 40px; background: blue; color: white; }
h1 { font-size: 48px; }
EOF

# 调用 API
bash -c 'curl -s "https://hcti.io/v1/image" \
  -X POST \
  -u "${HCTI_USER_ID}:${HCTI_API_KEY}" \
  --data-urlencode "html@/tmp/visual_html.txt" \
  --data-urlencode "css@/tmp/visual_css.txt"'
```

### 完整示例

```bash
#!/bin/bash

# 模板变量
QUOTE="行动是治愈恐惧的良药"
AUTHOR="威廉·詹姆斯"
THEME="purple"

# 生成 HTML
HTML=$(cat << EOF
<div class="card quote-card theme-${THEME}">
  <div class="card-content">
    <span class="quote-mark left">"</span>
    <p class="quote-text">${QUOTE}</p>
    <span class="quote-mark right">"</span>
    <div class="quote-author">—— ${AUTHOR}</div>
  </div>
</div>
EOF
)

# 生成 CSS (简化版)
CSS=$(cat << 'EOF'
.card { width: 800px; height: 800px; display: flex; align-items: center; justify-content: center; }
.quote-card.theme-purple { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
.quote-text { font-size: 48px; font-weight: 500; text-align: center; padding: 40px; }
.quote-author { font-size: 24px; text-align: center; margin-top: 30px; opacity: 0.9; }
.quote-mark { font-size: 120px; opacity: 0.3; position: absolute; }
.quote-mark.left { top: 40px; left: 40px; }
.quote-mark.right { bottom: 40px; right: 40px; }
EOF
)

# 保存到临时文件
echo "$HTML" > /tmp/visual_html.txt
echo "$CSS" > /tmp/visual_css.txt

# 调用 API
RESPONSE=$(bash -c 'curl -s "https://hcti.io/v1/image" \
  -X POST \
  -u "${HCTI_USER_ID}:${HCTI_API_KEY}" \
  --data-urlencode "html@/tmp/visual_html.txt" \
  --data-urlencode "css@/tmp/visual_css.txt" \
  -d "google_fonts=Noto+Sans+SC" \
  -d "device_scale=2"')

# 解析响应
IMAGE_URL=$(echo "$RESPONSE" | jq -r '.url')

# 输出结果
echo "图片已生成: $IMAGE_URL"
```

## API 参数

### 必需参数

| 参数 | 说明 | 示例 |
|-----|------|------|
| `html` | HTML 内容 | `<div>Hello</div>` |
| `url` | 网页 URL (与 html 二选一) | `https://example.com` |

### 可选参数

| 参数 | 说明 | 默认值 | 示例 |
|-----|------|--------|------|
| `css` | CSS 样式 | - | `div { color: red; }` |
| `google_fonts` | Google Fonts | - | `Noto Sans SC|Inter` |
| `device_scale` | 分辨率倍数 | 1 | 2 (Retina) |
| `viewport_width` | 视口宽度 | 1280 | 1200 |
| `viewport_height` | 视口高度 | - | 630 |
| `ms_delay` | 延迟截图 | 0 | 1500 |
| `selector` | 截图元素 | - | `.card` |

### 参数详解

#### google_fonts

支持多个字体，用 `|` 分隔：

```bash
-d "google_fonts=Noto+Sans+SC|Inter|Playfair+Display"
```

推荐字体：
- 中文: `Noto Sans SC`, `LXGW WenKai` (霞鹜文楷)
- 英文: `Inter`, `Playfair Display`, `Roboto`

#### device_scale

- `1` - 标准分辨率
- `2` - Retina (推荐)
- `3` - 超高清

#### viewport_width / viewport_height

设置截图视口大小：

```bash
# OG Image 尺寸
-d "viewport_width=1200" -d "viewport_height=630"

# Instagram 方形
-d "viewport_width=800" -d "viewport_height=800"
```

## 响应格式

### 成功响应

```json
{
  "url": "https://hcti.io/v1/image/be4c5118-fe19-462b-a49e-48cf72697a9d"
}
```

### 错误响应

```json
{
  "error": "Bad Request",
  "statusCode": 400,
  "message": "HTML is Required"
}
```

## 定价与限制

### 免费版

- 每月 50 张图片
- 基础功能
- 社区支持

### 付费版

- Starter: $15/月, 500 张
- Growth: $49/月, 2500 张
- Business: $149/月, 10000 张

## 最佳实践

### 1. 字体加载

确保字体正确加载：

```bash
-d "google_fonts=Noto+Sans+SC" \
-d "ms_delay=500"
```

### 2. 图片优化

- 使用 `device_scale=2` 获得清晰图片
- 设置合适的 viewport 尺寸
- 避免过大的 HTML 内容

### 3. 错误处理

```bash
RESPONSE=$(curl -s ...)

if echo "$RESPONSE" | jq -e '.url' > /dev/null 2>&1; then
  IMAGE_URL=$(echo "$RESPONSE" | jq -r '.url')
  echo "成功: $IMAGE_URL"
else
  ERROR=$(echo "$RESPONSE" | jq -r '.message')
  echo "错误: $ERROR"
fi
```

### 4. 缓存策略

生成的图片 URL 是永久的，可以：
- 保存 URL 供后续使用
- 使用 CDN 加速访问
- 添加查询参数调整尺寸: `?width=400`

## 故障排除

### 字体不显示

- 检查字体名称拼写
- 添加 `ms_delay` 等待字体加载
- 使用更通用的字体作为 fallback

### 图片模糊

- 增加 `device_scale` 到 2 或 3
- 检查 viewport 尺寸是否匹配设计

### 样式不生效

- 确保 CSS 选择器正确
- 使用内联样式作为备选
- 检查 CSS 语法错误

## 参考链接

- [官方文档](https://docs.htmlcsstoimage.com/)
- [Dashboard](https://htmlcsstoimage.com/dashboard)
- [Pricing](https://htmlcsstoimage.com/pricing)

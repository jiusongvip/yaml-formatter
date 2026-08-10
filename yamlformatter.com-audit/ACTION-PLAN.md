# Action Plan — yamlformatter.com

**生成日期：** 2026-08-10

---

## Critical（立即修复）

*无 Critical 级别问题*

---

## High（1 周内修复）

### H1. 为博客添加 BlogPosting JSON-LD
- **文件：** `src/layouts/BlogLayout.astro`
- **做法：** 在 `<head>` 中添加 `<script type="application/ld+json">` 包含 BlogPosting schema
- **预期效果：** 提升搜索结果富摘要展示率，帮助 AI 搜索引擎理解内容
- **工作量：** 30 分钟

### H2. 配置 trailingSlash: 'never'
- **文件：** `astro.config.mjs`
- **做法：** 添加 `trailingSlash: 'never'` 到 defineConfig
- **预期效果：** 明确 URL 规范，避免部署后 canonical/sitemap 不一致
- **工作量：** 1 分钟

### H3. 修复博客面包屑导航硬编码
- **文件：** `src/layouts/BlogLayout.astro`
- **问题：** "Blog" 链接始终指向 `/blog/yaml-syntax-guide`
- **做法：** 改为接受 props 动态传入，或改为通用的 `/blog/` 路径（如果有博客索引页）
- **工作量：** 15 分钟

---

## Medium（1 个月内修复）

### M1. 添加 About 页面
- **做法：** 创建 `/about/` 页面，介绍项目背景、团队/作者信息、技术栈
- **预期效果：** 提升 E-E-A-T 信任信号
- **工作量：** 2 小时

### M2. 扩展博客内容
- **目标：** 每篇博客扩展到 800-1200 词
- **当前状态：** 3篇博客均 500-650 词
- **工作量：** 每篇 1-2 小时

### M3. 添加 llms.txt
- **文件：** `public/llms.txt`
- **做法：** 创建说明文件，描述站点功能、内容范围、使用条款
- **预期效果：** 提升 ChatGPT/Perplexity 等 AI 搜索可见性
- **工作量：** 30 分钟

### M4. 为博客添加 BreadcrumbList schema
- **做法：** 在 BlogLayout 中添加面包屑对应的 JSON-LD
- **工作量：** 20 分钟

---

## Low（持续优化）

### L1. 部署后线上 SEO 验证
- 验证 http→https 301 重定向
- 验证 www→裸域 301 重定向
- 提交 sitemap 到 Google Search Console
- 检查 Core Web Vitals 实际数据

### L2. 添加 Google Analytics
- 在所有页面添加 GA4 追踪代码

### L3. 扩展博客内容矩阵
- 围绕 YAML 主题创建更多文章（yaml vs xml, yaml for kubernetes, yaml anchors deep dive 等）
- 建立主题权威性

### L4. 添加更多内部链接
- 博客文章之间互相链接
- 从博客链接到工具页（已有，继续保持）

---

## 时间线

| 阶段 | 时间 | 内容 |
|------|------|------|
| Phase 1 | Week 1 | H1-H3（博客 schema + trailingSlash + 面包屑） |
| Phase 2 | Week 2-3 | M1-M4（About 页面 + 内容扩展 + llms.txt） |
| Phase 3 | Month 2+ | L1-L4（部署验证 + GA + 内容矩阵） |

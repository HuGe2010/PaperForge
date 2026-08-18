<template>
  <div class="settings">
    <header class="settings__head">
      <h2 class="settings__title">系统设置</h2>
      <p class="settings__sub">
        配置 AI 模型密钥与接口。密钥以 AES-256-GCM 加密存储，不会写入镜像或环境变量。
      </p>
    </header>

    <el-row :gutter="20">
      <!-- 视觉模型：驱动 OCR 识题 -->
      <el-col :span="24">
        <el-card class="settings__card" v-loading="loading">
          <template #header>
            <div class="settings__card-head">
              <div class="settings__card-icon">
                <el-icon><Picture /></el-icon>
              </div>
              <div class="settings__card-titles">
                <span class="settings__card-title">视觉模型</span>
                <span class="settings__card-desc">OCR 识题 · 读取题目图片</span>
              </div>
              <el-tag
                class="settings__card-status"
                :type="vlm.enabled && vlmHasKey ? 'success' : 'info'"
                size="small"
              >
                {{ vlm.enabled && vlmHasKey ? '已启用真实模型' : '未配置密钥（无法识别）' }}
              </el-tag>
            </div>
          </template>

          <el-alert type="warning" :closable="false" class="settings__alert">
            开启并填写密钥后，上传试卷的「识别」将调用真实视觉模型。未开启或缺少密钥时，系统会直接报错提示，<b>不会编造题目</b>。
          </el-alert>

          <el-form label-position="top" class="settings__form">
            <el-form-item label="启用真实视觉模型">
              <el-switch v-model="vlm.enabled" />
            </el-form-item>
            <el-form-item label="接口地址 Base URL">
              <el-input
                v-model="vlm.baseUrl"
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              />
              <div class="settings__hint">
                <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                <span class="settings__hint-text">
                  OpenAI 兼容 /v1 端点。公开 DashScope 填
                  <code>https://dashscope.aliyuncs.com/compatible-mode/v1</code>；
                  若用百炼 <b>MaaS 私有端点</b>（<code>*.maas.aliyuncs.com</code>），model 必须精确等于你在控制台部署时起的<b>部署名</b>，且该部署必须是<b>视觉模型(VL)</b>。
                </span>
              </div>
            </el-form-item>
            <el-form-item label="API Key">
              <el-input
                v-model="vlm.apiKey"
                type="password"
                show-password
                :placeholder="vlmHasKey ? '已配置，留空则不修改' : '请输入 API Key'"
              />
            </el-form-item>
            <el-form-item label="模型名称 Model">
              <el-input v-model="vlm.model" placeholder="qwen-vl-max-latest" />
              <div class="settings__hint">
                <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                <span class="settings__hint-text">
                  必须是<b>视觉模型</b>（能读图）。公开 DashScope 填
                  <code>qwen-vl-max-latest</code> 或 <code>qwen-vl-plus</code>（不可用纯文本模型如 qwen-max / qwen-plus / Qwen3.x）。
                </span>
              </div>
            </el-form-item>
            <div class="settings__actions">
              <el-button type="primary" :loading="savingVlm" @click="saveVlm">
                <el-icon><Check /></el-icon>
                <span>保存视觉模型配置</span>
              </el-button>
            </div>
          </el-form>
        </el-card>
      </el-col>

      <!-- 文本模型：解题 / 打标签 -->
      <el-col :span="24">
        <el-card class="settings__card" v-loading="loading">
          <template #header>
            <div class="settings__card-head">
              <div class="settings__card-icon">
                <el-icon><ChatDotRound /></el-icon>
              </div>
              <div class="settings__card-titles">
                <span class="settings__card-title">文本模型</span>
                <span class="settings__card-desc">后台 AI 解题 · 生成解析</span>
              </div>
              <el-tag
                class="settings__card-status"
                :type="llmHasKey ? 'success' : 'info'"
                size="small"
              >
                {{ llmHasKey ? '已配置' : '未配置（入库后不自动解答）' }}
              </el-tag>
            </div>
          </template>
          <el-alert type="info" :closable="false" class="settings__alert">
            题目入库后，系统会后台调用该模型生成解析与解答并写回题库。推荐使用阿里云 DashScope（通义千问）。
          </el-alert>
          <el-form label-position="top" class="settings__form">
            <el-form-item label="服务商 Provider">
              <el-input v-model="llm.provider" placeholder="dashscope" />
            </el-form-item>
            <el-form-item label="接口地址 Base URL">
              <el-input v-model="llm.baseUrl" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
              <div class="settings__hint">
                <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                <span class="settings__hint-text">阿里云 DashScope 兼容端点（OpenAI 兼容 /v1）</span>
              </div>
            </el-form-item>
            <el-form-item label="API Key">
              <el-input
                v-model="llm.apiKey"
                type="password"
                show-password
                :placeholder="llmHasKey ? '已配置，留空则不修改' : '请输入 API Key'"
              />
            </el-form-item>
            <el-form-item label="模型 Model">
              <el-input v-model="llm.model" placeholder="qwen-plus" />
              <div class="settings__hint">
                <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                <span class="settings__hint-text">如 <code>qwen-plus</code> / <code>qwen-max</code> / <code>qwen-turbo</code></span>
              </div>
            </el-form-item>
            <el-form-item label="推理模型 Model（可选）">
              <el-input v-model="llm.modelReasoning" placeholder="deepseek-v4-pro" />
            </el-form-item>
            <el-form-item label="Embedding 模型（查重语义层）">
              <el-input v-model="llm.embeddingModel" placeholder="qwen3.7-text-embedding" />
              <div class="settings__hint">
                <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                <span class="settings__hint-text">用于「题目查重」语义召回；留空默认 <code>qwen3.7-text-embedding</code>。模型变更后需重新生成语义向量。</span>
              </div>
            </el-form-item>
            <div class="settings__actions">
              <el-button type="primary" :loading="savingLlm" @click="saveLlm">
                <el-icon><Check /></el-icon>
                <span>保存文本模型配置</span>
              </el-button>
            </div>
          </el-form>
        </el-card>
      </el-col>

      <!-- OCR 方案：框选题目的本地/云端切换 -->
      <el-col :span="24">
        <el-card class="settings__card" v-loading="loading">
          <template #header>
            <div class="settings__card-head">
              <div class="settings__card-icon">
                <el-icon><Crop /></el-icon>
              </div>
              <div class="settings__card-titles">
                <span class="settings__card-title">OCR 方案</span>
                <span class="settings__card-desc">题目框选 · 本地 / 云端引擎</span>
              </div>
              <el-tag
                class="settings__card-status"
                :type="ocr.provider === 'cloud' ? 'success' : 'info'"
                size="small"
              >
                {{ ocr.provider === 'cloud' ? '云端（PaddleOCR-VL）' : '本地（PaddleOCR，免密钥）' }}
              </el-tag>
            </div>
          </template>
          <el-alert type="info" :closable="false" class="settings__alert">
            「AI 框选题目」用哪套 OCR。本地方案无需密钥、开箱即用；云端方案调用飞桨 PaddleOCR-VL 服务化接口（更准），需填写 AI Studio 的 API URL 与 Token。
          </el-alert>
          <el-form label-position="top" class="settings__form">
            <el-form-item label="OCR 方案">
              <el-radio-group v-model="ocr.provider">
                <el-radio value="local">本地（PaddleOCR）</el-radio>
                <el-radio value="cloud">云端（PaddleOCR-VL）</el-radio>
              </el-radio-group>
            </el-form-item>
            <template v-if="ocr.provider === 'cloud'">
              <el-form-item label="API URL（任务提交地址 JOB_URL）">
                <el-input v-model="ocr.apiUrl" placeholder="https://paddleocr.aistudio-app.com/api/v2/ocr/jobs" />
                <div class="settings__hint">
                  <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                  <span class="settings__hint-text">
                    填 AI Studio 示例代码里的 <code>JOB_URL</code>（<code>POST /api/v2/ocr/jobs</code> 提交任务、<code>GET /api/v2/ocr/jobs/{jobId}</code> 轮询结果）。默认
                    <code>https://paddleocr.aistudio-app.com/api/v2/ocr/jobs</code>。
                  </span>
                </div>
              </el-form-item>
              <el-form-item label="Token">
                <el-input
                  v-model="ocr.token"
                  type="password"
                  show-password
                  :placeholder="ocrHasToken ? '已配置，留空则不修改' : '请输入 Access Token'"
                />
                <div class="settings__hint">
                  <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                  <span class="settings__hint-text">示例代码里的 <code>TOKEN</code>（请求头 <code>Authorization: bearer &lt;token&gt;</code>）。</span>
                </div>
              </el-form-item>
              <el-form-item label="模型 Model">
                <el-input v-model="ocr.model" placeholder="PaddleOCR-VL-1.6" />
                <div class="settings__hint">
                  <el-icon class="settings__hint-icon"><InfoFilled /></el-icon>
                  <span class="settings__hint-text">默认 <code>PaddleOCR-VL-1.6</code>，可改成你部署的其他模型名（如 PaddleOCR-VL-1.5）。</span>
                </div>
              </el-form-item>
            </template>
            <div class="settings__actions">
              <el-button type="primary" :loading="savingOcr" @click="saveOcr">
                <el-icon><Check /></el-icon>
                <span>保存 OCR 方案配置</span>
              </el-button>
            </div>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { settingsApi, type SettingItemView } from '@/api/settings';

const loading = ref(false);
const savingVlm = ref(false);
const savingLlm = ref(false);
const savingOcr = ref(false);

const vlm = reactive({ enabled: false, baseUrl: '', apiKey: '', model: '' });
const llm = reactive({ provider: '', baseUrl: '', apiKey: '', model: '', modelReasoning: '', embeddingModel: '' });
const ocr = reactive({ provider: 'local', apiUrl: '', token: '', model: '' });
const vlmHasKey = ref(false);
const llmHasKey = ref(false);
const ocrHasToken = ref(false);

type AnyForm = Record<string, any>;

async function load() {
  loading.value = true;
  try {
    const [v, l, o] = await Promise.all([
      settingsApi.getGroup('vlm'),
      settingsApi.getGroup('llm'),
      settingsApi.getGroup('ocr'),
    ]);
    for (const it of v) {
      if (it.key in vlm) (vlm as AnyForm)[it.key] = it.value ?? '';
      if (it.key === 'apiKey') vlmHasKey.value = it.hasValue;
    }
    for (const it of l) {
      if (it.key in llm) (llm as AnyForm)[it.key] = it.value ?? '';
      if (it.key === 'apiKey') llmHasKey.value = it.hasValue;
    }
    for (const it of o) {
      if (it.key in ocr) (ocr as AnyForm)[it.key] = it.value ?? '';
      if (it.key === 'token') ocrHasToken.value = it.hasValue;
    }
  } finally {
    loading.value = false;
  }
}

async function saveVlm() {
  savingVlm.value = true;
  try {
    const items: { key: string; value: string | null; isSecret?: boolean }[] = [
      { key: 'enabled', value: vlm.enabled ? 'true' : 'false' },
      { key: 'baseUrl', value: vlm.baseUrl || null },
      { key: 'model', value: vlm.model || null },
    ];
    if (vlm.apiKey) items.push({ key: 'apiKey', value: vlm.apiKey, isSecret: true });
    await settingsApi.setGroup('vlm', items);
    if (vlm.apiKey) vlmHasKey.value = true;
    vlm.apiKey = '';
    ElMessage.success('视觉模型配置已保存');
  } finally {
    savingVlm.value = false;
  }
}

async function saveLlm() {
  savingLlm.value = true;
  try {
    const items: { key: string; value: string | null; isSecret?: boolean }[] = [
      { key: 'provider', value: llm.provider || null },
      { key: 'baseUrl', value: llm.baseUrl || null },
      { key: 'model', value: llm.model || null },
      { key: 'modelReasoning', value: llm.modelReasoning || null },
      { key: 'embeddingModel', value: llm.embeddingModel || null },
    ];
    if (llm.apiKey) items.push({ key: 'apiKey', value: llm.apiKey, isSecret: true });
    await settingsApi.setGroup('llm', items);
    if (llm.apiKey) llmHasKey.value = true;
    llm.apiKey = '';
    ElMessage.success('文本模型配置已保存');
  } finally {
    savingLlm.value = false;
  }
}

async function saveOcr() {
  savingOcr.value = true;
  try {
    const items: { key: string; value: string | null; isSecret?: boolean }[] = [
      { key: 'provider', value: ocr.provider || 'local' },
      { key: 'apiUrl', value: ocr.apiUrl || null },
      { key: 'model', value: ocr.model || null },
    ];
    if (ocr.token) items.push({ key: 'token', value: ocr.token, isSecret: true });
    await settingsApi.setGroup('ocr', items);
    if (ocr.token) ocrHasToken.value = true;
    ocr.token = '';
    ElMessage.success('OCR 方案配置已保存');
  } finally {
    savingOcr.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settings {
  max-width: 880px;
}

/* ---- 页头 ---- */
.settings__head {
  margin-bottom: var(--space-6);
}
.settings__title {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 var(--space-2);
  color: var(--c-text);
}
.settings__sub {
  margin: 0;
  color: var(--c-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

/* ---- 卡片 ---- */
.settings__card {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--space-5);
  overflow: hidden;
  transition: box-shadow var(--motion-base) var(--ease-out);
}
.settings__card:hover {
  box-shadow: var(--shadow-md);
}
.settings__card :deep(.el-card__header) {
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--c-border);
}
.settings__card :deep(.el-card__body) {
  padding: var(--space-6);
}

/* ---- 卡片头部：图标 + 标题/副标题 + 状态 ---- */
.settings__card-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.settings__card-icon {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--c-primary-100);
  color: var(--c-primary);
}
.settings__card-titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.settings__card-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--c-text);
}
.settings__card-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-muted);
}
.settings__card-status {
  flex: 0 0 auto;
  margin-left: var(--space-2);
}

/* ---- 提示分层 ---- */
.settings__alert {
  margin-bottom: var(--space-5);
}
.settings__hint {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--c-surface-2);
  border-left: 3px solid var(--c-primary);
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.65;
  color: var(--c-text-muted);
}
.settings__hint-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--c-primary);
}
.settings__hint-text {
  min-width: 0;
}
.settings__hint code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--c-primary);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 4px;
  padding: 1px 5px;
}

/* ---- 表单 ---- */
.settings__form {
  margin-top: var(--space-2);
}
.settings__form :deep(.el-form-item) {
  margin-bottom: var(--space-5);
}
.settings__form :deep(.el-form-item__label) {
  color: var(--c-text);
  font-weight: 500;
  padding-bottom: var(--space-1);
}

/* ---- 底部操作区 ---- */
.settings__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--c-border);
}
</style>

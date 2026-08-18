import axios, { type AxiosInstance } from 'axios';
import { ElMessage } from 'element-plus';
import router from '../router';

const client: AxiosInstance = axios.create({
  baseURL: '/api',
  // AI 类接口（生成解答、整页识别、OCR 框选）可能耗时较长，默认放宽到 60s；
  // 具体慢接口再单独调大超时（见 questions.solve / ingest.recognize / ingest.detect）。
  timeout: 60000,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message || '请求失败';
    if (status === 401) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      if (router.currentRoute.value.name === 'login') {
        // 登录页内的 401（如用户名/密码错误）直接提示，避免无声失败
        ElMessage.error(message || '登录失败，请检查用户名和密码');
      } else if (router.currentRoute.value.name !== 'login') {
        router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
      }
    } else if (status === 403) {
      ElMessage.error('无权访问该资源');
    } else if (status === 413) {
      // nginx 直返 413 时响应体不是 JSON，message 拿不到；统一给友好提示
      ElMessage.error('文件过大（单文件上限 50MB），请压缩或拆分后重试');
    } else {
      ElMessage.error(message);
    }
    return Promise.reject(error);
  },
);

export default client;

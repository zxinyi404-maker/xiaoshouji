const CACHE_NAME = 'nn-phone-cache-v2'; // 升级版本号，强迫浏览器更新缓存
const urlsToCache = [
  './',
  './index.html',
  './static/css/style.css',
  './static/js/app.js',
  './static/js/localforage.js'
  // 注意：外部链接（如cdn字体、图片）通常不建议在这里预缓存，除非配置了跨域CORS
];

// 1. 安装阶段：预缓存核心文件
self.addEventListener('install', event => {
  self.skipWaiting(); // 强制立即接管，不用等待旧SW关闭
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.error('Cache install failed:', err))
  );
});

// 2. 激活阶段：清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // 立即控制页面
});

// 3. 拦截请求：网络优先 -> 失败则读取缓存
self.addEventListener('fetch', event => {
  // 仅拦截 http/https 协议，忽略 chrome-extension 等协议
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 如果网络请求成功，克隆一份存入缓存（实现动态缓存）
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });
        return response;
      })
      .catch(() => {
        // 如果网络请求失败（离线/ERR_FAILED），尝试从缓存读取
        console.log('Network failed, falling back to cache:', event.request.url);
        return caches.match(event.request);
      })
  );
});
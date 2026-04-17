		// --- 放在 static/js/app.js 的最开头 (第一行) ---
		(function earlyLoadCustomStyle() {
			try {
				// 同步读取 localStorage 中的美化配置（绕过异步的 localForage，实现瞬间加载）
				const rawSettings = localStorage.getItem('nnPhoneStyleSettings_Sync');
				if (rawSettings) {
					const settings = JSON.parse(rawSettings);
					if (settings.fontUrl || settings.globalCss || settings.bubbleCss) {
						let styleTag = document.createElement('style');
						styleTag.id = 'custom-style-tag'; // 提前占位
						let css = '';
						if (settings.fontUrl) {
							// 【核心机制】：font-display: block; 
							// 作用：隐藏文字等待自定义字体下载（最多等3秒）。如果下载成功则直接显示新字体；如果失败或超时，则自动降级显示原本的 sans-serif 字体。
							css += `@font-face { font-family: 'UserFont'; src: url('${settings.fontUrl}'); font-display: block; } *:not(.fas):not(.far):not(.fab):not(.fa) { font-family: 'UserFont', sans-serif !important; }`;
						}
						css += settings.globalCss || '';
						css += settings.bubbleCss || '';
						styleTag.textContent = css;
						document.documentElement.appendChild(styleTag);
					}
				}
			} catch(e) { 
				console.error("首屏字体拦截加载失败", e); 
			}
		})();
		// --- 原本的 app.js 代码从这里开始往下接 ---      
	  // --- 放在 static/js/app.js 中 ---

		function syncStatusBarColor() {
			const topBar = document.querySelector('.top-bar');
			// 获取两个 meta 标签
			const themeColorTag = document.querySelector('meta[name="theme-color"]');
			const appleStatusTag = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');

			if (topBar && themeColorTag && appleStatusTag) {
				// 读取最终生效的背景色
				const realColor = window.getComputedStyle(topBar).backgroundColor;
				
				// 1. 同步颜色给 theme-color
				themeColorTag.setAttribute('content', realColor);

				// 2. 智能判断深浅并同步给 apple-status-bar
				try {
					// 解析 RGB 值
					const rgb = realColor.match(/\d+/g);
					if (rgb && rgb.length >= 3) {
						const r = parseInt(rgb[0]);
						const g = parseInt(rgb[1]);
						const b = parseInt(rgb[2]);

						// 计算亮度 (简易算法)，阈值设为 128
						const brightness = (r * 299 + g * 587 + b * 114) / 1000;
						
						if (brightness < 128) {
							// 深色背景
							appleStatusTag.setAttribute('content', 'black');
						} else {
							// 浅色背景
							appleStatusTag.setAttribute('content', 'default');
						}
					}
				} catch (e) {
					console.error("解析颜色失败:", e);
					// 解析失败时，默认设置为 'default'
					appleStatusTag.setAttribute('content', 'default');
				}
			}
		}


		// 1. 页面加载完成时同步一次 (保持不变)
		document.addEventListener('DOMContentLoaded', syncStatusBarColor);

		// 2. (可选) 如果你以后做了“一键换肤”按钮，在切换 CSS 后调用一次 syncStatusBarColor() 即可。


		// ============================================================
        // 【1. 全局变量定义区】
        // ============================================================
        const navItems = document.querySelectorAll('.nav-item');
        const pages = document.querySelectorAll('.page');
        const topBars = document.querySelectorAll('.top-bar');
        const contentArea = document.getElementById('main-content-area');
        const bottomNav = document.getElementById('main-bottom-nav');
        const showBottomNavPages = ['chat-page', 'contact-page', 'discover-page', 'me-page'];
		let characterTypingStatus = {}; // 新增：用于追踪角色输入状态 { charId: true/false }
		// 【新增】记录角色是否正在进行记忆总结 { charId: true/false }
		let memorySummarizingStatus = {};
		//语音播放
		let currentAudioPlayer = null;
		// --- 引用相关 ---
		let currentQuoteData = null; // 存储当前正在引用的消息数据 { name: '', text: '' }
		// ============================================================
		// ★★★ 新增：后台保活与消息通知增强模块 ★★★
		// ============================================================
		const silentAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
		silentAudio.loop = true;
		let isGlobalAiReplying = false; // 标记 AI 是否正在思考
		let isAudioUnlocked = false;    // 标记音频是否已解锁

		function unlockAudioAndNotify() {
			if (isAudioUnlocked) return;
			
			// 尝试解锁音频
			const playPromise = silentAudio.play();
			
			if (playPromise !== undefined) {
				playPromise.then(() => {
					// 【核心修复】：不要立刻 pause，给系统一点点缓冲时间，防止触发 AbortError
					setTimeout(() => {
						silentAudio.pause();
						isAudioUnlocked = true;
						console.log("🔓 音频保活权限已解锁");
						
						// 请求通知权限
						try {
							if (typeof window !== "undefined" && "Notification" in window) {
								if (typeof Notification.requestPermission === 'function') {
									if (Notification.permission !== "granted" && Notification.permission !== "denied") {
										Notification.requestPermission().then(perm => {
											console.log("通知权限状态:", perm);
										}).catch(e => console.log("请求通知权限被拒绝", e));
									}
								}
							}
						} catch (error) {
							console.log("当前环境不支持 Notification API。", error);
						}
					}, 50); // 延迟 50ms 暂停
				}).catch(err => {
					console.log("音频解锁失败, 等待用户下一次交互:", err);
				});
			}
		}

		// 绑定全局点击事件来解锁权限
		document.body.addEventListener('touchstart', unlockAudioAndNotify, { once: true });
		document.body.addEventListener('click', unlockAudioAndNotify, { once: true });

		// 监听前后台切换
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) {
				// 切入后台时，如果 AI 正在回复，立刻播放无声音乐保活
				if (isGlobalAiReplying && isAudioUnlocked) {
					silentAudio.play().catch(e => console.error('保活播放失败', e));
				}
			} else {
				// 回到前台，停止播放省电
				silentAudio.pause();
			}
		});

		// 纯前端本地通知函数
		function showLocalNotification(title, body) {
			if (!("Notification" in window)) return;
			if (Notification.permission === "granted" && document.hidden) {
				try {
					// 优先尝试 Service Worker 发通知（如果在手机上打包成PWA体验最好）
					navigator.serviceWorker.ready.then((registration) => {
						registration.showNotification(title, { body: body });
					}).catch(() => {
						new Notification(title, { body: body });
					});
				} catch (e) {
					// 兜底方案
					new Notification(title, { body: body });
				}
			}
		}
		// ================== 保活模块结束 ==================
		// ============================================================
		// 【新增】世界书按注入位置提取工具函数
		// ============================================================
		function getFormattedWorldBooks(worldBookIds) {
			let wbBefore = "";
			let wbAfter = "";
			if (worldBookIds && worldBookIds.length > 0 && typeof worldBooks !== 'undefined' && worldBooks.length > 0) {
				const activeBooks = worldBooks.filter(wb => worldBookIds.includes(wb.id));
				
				const beforeBooks = activeBooks.filter(wb => wb.insertPosition === 'before');
				const afterBooks = activeBooks.filter(wb => !wb.insertPosition || wb.insertPosition === 'after');

				const formatBook = (wb) => `### [${wb.category || '默认'}] ${wb.title}\n${wb.content}`;

				if (beforeBooks.length > 0) {
					wbBefore = `【前置世界观与核心设定 (最高优先级指令)】\n${beforeBooks.map(formatBook).join('\n\n')}\n--------------------------------`;
				}
				if (afterBooks.length > 0) {
					wbAfter = `【补充世界观与设定百科 (参考资料)】\n${afterBooks.map(formatBook).join('\n\n')}\n--------------------------------`;
				}
			}
			return { wbBefore, wbAfter };
		}
		//钱包余额初始化
		const defaultWalletData = { balance: 500.00, transactions: [] };
		let walletData = { ...defaultWalletData };
		// 修改保存函数 (优化：限制消费记录只保留最新的 5 条)
		async function saveWalletToLocal() { 
			if (walletData && walletData.transactions && walletData.transactions.length > 5) {
				// 先按时间升序排序（确保最新的在最后面），然后截取最后 5 个
				walletData.transactions.sort((a, b) => a.timestamp - b.timestamp);
				walletData.transactions = walletData.transactions.slice(-5);
			}
			await saveData('nnPhoneWalletData', walletData); 
		}
		// --- 【修改】主动消息配置全局变量 ---
		const defaultActiveMsgSettings = {
			quietStart: '23:00',
			quietEnd: '08:00',
			enabledCharIds:[],
			charConfigs: {} // 新增：用于存储每个角色的独立时间配置 { charId: { min: 60, max: 120 } }
		};
		let activeMsgSettings = { ...defaultActiveMsgSettings };
		async function saveActiveMsgSettingsToLocal() { await saveData('nnPhoneActiveMsgSettings', activeMsgSettings); }
		// --- 【修改】天气共享配置全局变量 ---
		const defaultWeatherSettings = {
			apiHost: '',       
			apiKey: '',       // <--- 将 jwtToken 改回 apiKey
			province: '',
			city: '',
			syncCharIds:[],
			lastFetchDate: '', 
			cachedData: null   
		};
		let weatherSettings = { ...defaultWeatherSettings };
		async function saveWeatherSettingsToLocal() { await saveData('nnPhoneWeatherSettings', weatherSettings); }
		// --- 查手机全局控制变量 ---
		let cpTimeInterval = null;
		
		// 1. 启动实时时钟 (同时支持正向和反向查手机)
		function startCpClock() {
			if (cpTimeInterval) clearInterval(cpTimeInterval);
			const updateTime = () => {
				const now = new Date();
				const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
				
				// 正向查手机
				const lockTimeEl = document.getElementById('cp-lock-time');
				const statusTimeEl = document.getElementById('cp-status-time');
				if (lockTimeEl) lockTimeEl.textContent = timeStr;
				if (statusTimeEl) statusTimeEl.textContent = timeStr;

				// 【修复2】反向查手机
				const rcpLockTimeEl = document.getElementById('rcp-lock-time');
				const rcpStatusTimeEl = document.getElementById('rcp-status-time');
				if (rcpLockTimeEl) rcpLockTimeEl.textContent = timeStr;
				if (rcpStatusTimeEl) rcpStatusTimeEl.textContent = timeStr;
			};
			updateTime(); // 立即执行一次
			cpTimeInterval = setInterval(updateTime, 1000); // 每秒刷新
		}

		// 2. 停止时钟 (节约性能)
		function stopCpClock() {
			if (cpTimeInterval) {
				clearInterval(cpTimeInterval);
				cpTimeInterval = null;
			}
		}

		// 3. 设置随机电量 (同时支持正向和反向查手机)
		function setRandomBattery() {
			const batteryLevel = Math.floor(Math.random() * (100 - 15 + 1)) + 15; 
			
			// 正向查手机电量
			const textEl = document.getElementById('cp-status-battery-text');
			const iconEl = document.getElementById('cp-status-battery-icon');
			
			if (textEl) textEl.textContent = batteryLevel + '%';
			if (iconEl) {
				iconEl.className = 'fas'; 
				if (batteryLevel > 80) iconEl.classList.add('fa-battery-full');
				else if (batteryLevel > 60) iconEl.classList.add('fa-battery-three-quarters');
				else if (batteryLevel > 40) iconEl.classList.add('fa-battery-half');
				else if (batteryLevel > 15) iconEl.classList.add('fa-battery-quarter');
				else iconEl.classList.add('fa-battery-empty');
				
				iconEl.style.color = batteryLevel <= 20 ? '#ff3b30' : '#fff';
			}

			// 【终极修复】反向查手机电量同步 (绝对不会再覆盖左侧的 NNCC 和 5G)
			const rcpStatusBar = document.getElementById('rcp-status-bar');
			if (rcpStatusBar) {
				// 粗暴锁定：直接获取状态栏的【最后一个子元素】（即包裹电量百分比和图标的那个 div）
				const rightContainer = rcpStatusBar.lastElementChild; 
				
				if (rightContainer) {
					// 只在这个右侧区块内寻找文本和图标，彻底杜绝误伤左侧
					const rcpBatText = rightContainer.querySelector('span');
					const rcpBatIcon = rightContainer.querySelector('i');

					if (rcpBatText) rcpBatText.textContent = batteryLevel + '%';
					if (rcpBatIcon) {
						rcpBatIcon.className = 'fas'; 
						if (batteryLevel > 80) rcpBatIcon.classList.add('fa-battery-full');
						else if (batteryLevel > 60) rcpBatIcon.classList.add('fa-battery-three-quarters');
						else if (batteryLevel > 40) rcpBatIcon.classList.add('fa-battery-half');
						else if (batteryLevel > 15) rcpBatIcon.classList.add('fa-battery-quarter');
						else rcpBatIcon.classList.add('fa-battery-empty');
						
						rcpBatIcon.style.color = batteryLevel <= 20 ? '#ff3b30' : '#fff';
					}
				}
			}
		}

		// --- 记忆设置默认值 ---
		const defaultMemorySettings = { 
			shortTermLimit: 20, 
			ltmInterval: 10,  // 新增：默认10轮总结一次
			ltmMax: 5,         // 新增：默认保留5条
			ltmEnabled: true, // 新增：默认开启LTM
			 
			// 【新增】总结专用 API 配置
			ltmApi: {
				baseUrl: '',
				apiKey: '',
				model: ''
				}
		};
		
		// 【改动 1】不再同步读取 localStorage，直接使用默认值初始化
		let memorySettings = { ...defaultMemorySettings };

        // ============================================================
        // 【2. 缓存管理核心区】
        // ============================================================
        const defaultUserInfo = { avatar: '', avatarIcon: 'fas fa-user', name: 'NN小手机用户', status: '在线', gender: '未设置', region: '未设置', mask: '', momentsCover: '' };
        const defaultChatApiSettings = { baseUrl: '', apiKey: '', model: '', temperature: 0.7 };
        const defaultSocialApiSettings = { baseUrl: '', apiKey: '', model: '', temperature: 1.2 };
		const defaultOtherApiSettings = { baseUrl: '', apiKey: '', model: '', temperature: 0.7 };
		let otherApiSettings = { ...defaultOtherApiSettings };
		// --- 云同步配置 ---
		const defaultCloudSettings = { url: '', username: '', password: '' };
		let cloudSettings = { ...defaultCloudSettings };
		// --- 经期记录配置 (V2 升级版) ---
		const defaultPeriodData = {
			cycleLength: 28,
			duration: 6,
			syncCharIds:[],
			activeStart: null, // 当前经期的开始日期 "YYYY-MM-DD"
			history: [],       // 历史记录[{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }]
			migrated: false    // 用于兼容旧数据
		};
		let periodData = { ...defaultPeriodData };
		
		async function savePeriodDataToLocal() { await saveData('nnPhonePeriodData', periodData); }
		async function saveCloudSettingsToLocal() { await saveData('nnPhoneCloudSettings', cloudSettings); }
		
		async function saveOtherApiSettingsToLocal() { await saveData('nnPhoneOtherApiSettings', otherApiSettings); }
		let rcpLastInputData = null; // 【新增】反向查手机上次填写的表单缓存
		async function saveRcpLastInputToLocal() { await saveData('nnPhoneRcpLastInput', rcpLastInputData); }
		// 【修改】朋友圈全局设置
		const defaultMomentsSettings = {
			postableCharacterIds: [], // 允许发朋友圈的角色ID数组
			memorySyncEnabled: true,  // 记忆互通开关，默认开启
			memoryLimit: 10,          // 默认记忆10条
			hasUnread: false          // 【新增】朋友圈未读状态标记
		};
		
		// 【改动 2】直接使用默认值初始化
		let momentsSettings = { ...defaultMomentsSettings };
		
		// 【新增朋友圈数据 - 开始】
		const defaultMomentsData = [];
		// 【新增朋友圈数据 - 结束】

        // 【改动 3】核心变量全部初始化为默认值或空数组
        // 数据将在页面加载后通过 loadAllDataFromDB() 异步填充
        let userInfo = { ...defaultUserInfo };
        let chatApiSettings = { ...defaultChatApiSettings };
		let socialApiSettings = { ...defaultSocialApiSettings };
		
		let socialMoments = []; // 初始化为空
        let apiPresets = [];
        let characters = [];
		let worldBooks = [];
		let emoticonList = []; // 初始化为空
		let favoriteMessages = []; 
		let userMasks =[]; // 【新增】用户面具预设数组
		async function saveUserMasksToLocal() { await saveData('nnPhoneUserMasks', userMasks); }
		// 【新增】分组折叠状态与自定义排序顺序
        let collapsedGroups = JSON.parse(localStorage.getItem('nnPhoneCollapsedGroups')) || {};
        let customGroupOrder = JSON.parse(localStorage.getItem('nnPhoneGroupOrder')) || [];
		// --- 识图 API 默认配置 ---
		const defaultVisionApiSettings = { 
			baseUrl: '', 
			apiKey: '', 
			model: '', 
			prompt: '详细描述这张图片的内容。输出格式：[这是一张图片，图片内容为……]。' 
		};
		let visionApiSettings = { ...defaultVisionApiSettings };
		
		//论坛
		let forumBoards =[]; // 论坛版块和帖子数据
		async function saveForumBoardsToLocal() { await saveData('nnPhoneForumBoards', forumBoards); }
		
		// 【新增】语音 API 默认配置
		const defaultVoiceApiSettings = {
			groupId: '',
			apiKey: '',
			userVoiceId: ''
		};
		let voiceApiSettings = { ...defaultVoiceApiSettings };
        // 【改动 4】配置 localForage 数据库
        localforage.config({
            name: 'NNPhoneApp',
            storeName: 'main_database'
        });
		// ============================================================
		// 【全局函数】钱包交易记录 (移动到最外层，确保删除时能调用)
		// ============================================================
		window.addTransaction = function(amount, desc, paymentId = null) {
			if (!walletData) walletData = { balance: 0, transactions: [] }; // 防呆
			
			walletData.balance += amount;
			walletData.transactions.push({
				id: 'trans_' + Date.now() + Math.random().toString(36).substr(2, 5),
				amount: amount,
				desc: desc,
				timestamp: Date.now(),
				paymentId: paymentId
			});
			saveWalletToLocal();
			console.log(`[Wallet] 交易成功: ${amount}, 余额: ${walletData.balance}`);
		};
		// ============================================================
		// 【2. 保存函数区 - 改为异步 localForage】
		// ============================================================

		// 通用保存函数 (封装 localforage)
		async function saveData(key, value) {
			try {
				await localforage.setItem(key, value);
			} catch (e) {
				console.error("保存失败:", key, e);
				// 捕捉 QuotaExceededError (存储空间不足或单条数据过大)
				if (e.name === 'QuotaExceededError' || e.message.includes('quota') || e.message.includes('DataCloneError')) {
					alert(`⚠️ 严重警告：手机存储空间已满或聊天记录过长！\n\n刚才的消息未能保存成功，网页可能即将崩溃。请立刻前往【我的 -> 聊天设置 -> 清空聊天记录】或删除部分带图片的聊天记录！`);
				}
			}
		}

		// --- 重写具体的保存函数 (全部改为 async) ---
		async function saveVisionApiSettingsToLocal() { await saveData('nnPhoneVisionApiSettings', visionApiSettings); }
		async function saveVoiceApiSettingsToLocal() { await saveData('nnPhoneVoiceApiSettings', voiceApiSettings); }
		async function saveMemorySettingsToLocal() { await saveData('nnPhoneMemorySettings', memorySettings); }
		async function saveUserInfoToLocal() { await saveData('nnPhoneUserInfo', userInfo); }
		async function saveChatApiSettingsToLocal() { await saveData('nnPhoneChatApiSettings', chatApiSettings); }
		async function saveSocialApiSettingsToLocal() { await saveData('nnPhoneSocialApiSettings', socialApiSettings); }
		async function saveMomentsSettingsToLocal() { await saveData('nnPhoneMomentsSettings', momentsSettings); }
		async function saveMomentsToLocal() { await saveData('nnPhoneMoments', socialMoments); }
		async function saveApiPresetsToLocal() { await saveData('nnPhoneApiPresets', apiPresets); }
		// 【修改】加入 immediate 开关的防抖保存函数
		let saveCharactersTimeout = null;

		async function saveCharactersToLocal(immediate = false) {
			// 1. 如果是关键操作（如导入备份），跳过防抖，立刻写入！
			if (immediate) {
				if (saveCharactersTimeout) clearTimeout(saveCharactersTimeout);
				await saveData('nnPhoneCharacters', characters);
				return;
			}

			// 2. 正常聊天时的防抖保存（延迟 500 毫秒）
			if (saveCharactersTimeout) {
				clearTimeout(saveCharactersTimeout);
			}
			saveCharactersTimeout = setTimeout(async () => {
				try {
					await saveData('nnPhoneCharacters', characters);
				} catch (e) {
					console.error("防抖保存角色失败", e);
				}
			}, 500);
		}
		async function saveFavoritesToLocal() { await saveData('nnPhoneFavorites', favoriteMessages); } 
		
		// 补充漏掉的保存函数 (原来代码里是直接 localStorage.setItem 的，现在统一封装)
		async function saveWorldBooksToLocal() { await saveData('nn_world_books', worldBooks); } 
		async function saveEmoticonsToLocal() { await saveData('nnPhoneEmoticons', emoticonList); }

		// --- 修改清空缓存函数 ---
		async function clearAllCache() {
			if (confirm('确定清空所有数据吗？此操作将删除所有本地存储！')) {
				try {
					// 1. 清空 IndexedDB (大容量数据库)
					await localforage.clear();
					
					// 2. 清空 LocalStorage (旧数据)
					localStorage.clear();
					
					// 3. 重置内存变量
					userInfo = { ...defaultUserInfo };
					chatApiSettings = { ...defaultChatApiSettings };
					apiPresets = [];
					characters = [];
					emoticonList = []; 
					worldBooks = [];
					
					// 4. 刷新页面以重置所有状态
					alert('已清空所有数据，页面将刷新。');
					location.reload(); 
				} catch (e) {
					alert("清空数据失败: " + e.message);
				}
			}
		}
       function exportBackupData() {
			const backupData = { 
				userInfo, 
				chatApiSettings, 
				apiPresets, 
				characters, 
				memorySettings, 
				worldBooks, 
				emoticonList,
				visionApiSettings,
				voiceApiSettings,				
				socialApiSettings, 
				socialMoments, 
				momentsSettings, 
				groupOrder: customGroupOrder,
				forumBoards,
				walletData: walletData,
				otherApiSettings: otherApiSettings,
				favoriteMessages: favoriteMessages,
				periodData: periodData,
                styleSettings: StyleManager.settings,
				cloudSettings: cloudSettings,
				userMasks: userMasks,
				rcpLastInputData: rcpLastInputData,
                stylePresets: StyleManager.presets,
				weatherSettings: weatherSettings,
				activeMsgSettings: activeMsgSettings 				
			};
			return JSON.stringify(backupData, null, 2);
		}
		

		// ============================================================
		// 备份导入 (改为异步 async)
		// ============================================================
        async function importBackupData(backupData) {
			// 1. 基础校验
			const requiredKeys = ['userInfo', 'chatApiSettings', 'apiPresets', 'characters'];
			const isValid = requiredKeys.every(key => backupData.hasOwnProperty(key));
			if (!isValid) throw new Error('备份文件格式不正确或缺少关键数据');

			// 2. 导入核心数据到内存变量
			userInfo = backupData.userInfo;
			chatApiSettings = backupData.chatApiSettings;
			apiPresets = backupData.apiPresets;
			characters = backupData.characters;

			// 3. 导入记忆配置
			if (backupData.memorySettings) {
				memorySettings = backupData.memorySettings;
				if(typeof memorySettings.ltmInterval === 'undefined') memorySettings.ltmInterval = 10;
				if(typeof memorySettings.ltmMax === 'undefined') memorySettings.ltmMax = 5;
				if(typeof memorySettings.ltmEnabled === 'undefined') memorySettings.ltmEnabled = true;
				if(!memorySettings.ltmApi) memorySettings.ltmApi = { ...defaultMemorySettings.ltmApi };
				await saveMemorySettingsToLocal(); 
			}

			// 4. 导入世界书数据
			if (backupData.worldBooks && Array.isArray(backupData.worldBooks)) {
				worldBooks = backupData.worldBooks;
				await saveData('nn_world_books', worldBooks); 
			}

			// 5. 导入表情包数据
			if (backupData.emoticonList && Array.isArray(backupData.emoticonList)) {
				emoticonList = backupData.emoticonList;
				await saveData('nnPhoneEmoticons', emoticonList); 
			}
			
			// 6. 导入其他杂项配置与数据
			if (backupData.visionApiSettings) {
				visionApiSettings = backupData.visionApiSettings;
				await saveVisionApiSettingsToLocal();
			}
			if (backupData.socialApiSettings) {
				socialApiSettings = backupData.socialApiSettings;
				await saveSocialApiSettingsToLocal();
			}
			if (backupData.momentsSettings) { 
				momentsSettings = backupData.momentsSettings;
				await saveMomentsSettingsToLocal();
			}
			if (backupData.socialMoments) {
				socialMoments = backupData.socialMoments;
				await saveMomentsToLocal();
			}
			if (backupData.forumBoards) {
				forumBoards = backupData.forumBoards;
				await saveForumBoardsToLocal();
			}
			if (backupData.voiceApiSettings) {
				voiceApiSettings = backupData.voiceApiSettings;
				await saveVoiceApiSettingsToLocal();
			}
			if (backupData.groupOrder) {
                customGroupOrder = backupData.groupOrder;
                localStorage.setItem('nnPhoneGroupOrder', JSON.stringify(customGroupOrder));
            }
			if (backupData.styleSettings) {
				StyleManager.settings = backupData.styleSettings;
				await localforage.setItem('nnPhoneStyleSettings', backupData.styleSettings);
				localStorage.setItem('nnPhoneStyleSettings_Sync', JSON.stringify(backupData.styleSettings));
			}
			if (backupData.stylePresets) {
				StyleManager.presets = backupData.stylePresets;
				await localforage.setItem('nnPhoneStylePresets', backupData.stylePresets);
			}
			if (backupData.cloudSettings) {
				cloudSettings = backupData.cloudSettings;
				await saveCloudSettingsToLocal(); // 保存云同步配置
			}
			// 【本次修复新增：导入钱包、其他API、收藏夹】
			if (backupData.walletData) {
				walletData = backupData.walletData;
				await saveWalletToLocal();
			}
			if (backupData.otherApiSettings) {
				otherApiSettings = backupData.otherApiSettings;
				await saveOtherApiSettingsToLocal();
			}
			if (backupData.favoriteMessages) {
				favoriteMessages = backupData.favoriteMessages;
				await saveFavoritesToLocal();
			}
			// 经期
			if (backupData.periodData) {
				periodData = backupData.periodData;
				await savePeriodDataToLocal();
			}
			if (backupData.userMasks && Array.isArray(backupData.userMasks)) {
				userMasks = backupData.userMasks;
				await saveUserMasksToLocal();
			}
			// 【新增】导入反向查手机历史记录
            if (backupData.rcpLastInputData) {
                rcpLastInputData = backupData.rcpLastInputData;
                await saveRcpLastInputToLocal();
            }
			// <--- 【新增】导入天气配置开始 --->
            if (backupData.weatherSettings) {
                weatherSettings = backupData.weatherSettings;
                await saveWeatherSettingsToLocal();
            }
			//主动消息设置
			if (backupData.activeMsgSettings) {
                activeMsgSettings = backupData.activeMsgSettings;
                await saveActiveMsgSettingsToLocal();
            }
			// 7. 保存核心数据 (全部 await)
			await saveUserInfoToLocal();
			await saveChatApiSettingsToLocal();
			await saveApiPresetsToLocal();
			await saveCharactersToLocal(true); 
			
			// 8. 刷新界面
			initUserInfoDisplay();
			initChatApiSettingsDisplay();
			populatePresetDropdown();
			renderChatList();
			alert('备份导入成功！页面将刷新。');
			location.reload(); 
		}
        // ============================================================
        // 【新增：数据加载与迁移核心逻辑】
        // ============================================================

        // 1. 数据迁移工具：自动把旧的 LocalStorage 数据搬家到 IndexedDB
        async function migrateOldData() {
            // 检查标记，如果没迁移过，且 LocalStorage 里有数据
            if (!localStorage.getItem('MIGRATION_DONE') && localStorage.getItem('nnPhoneUserInfo')) {
                console.log("正在迁移旧数据到 IndexedDB...");
                const keys = [
                    'nnPhoneUserInfo', 'nnPhoneChatApiSettings', 'nnPhoneSocialApiSettings',
                    'nnPhoneVisionApiSettings', 'nnPhoneMemorySettings', 'nnPhoneMomentsSettings',
                    'nnPhoneApiPresets', 'nnPhoneCharacters', 'nn_world_books',
                    'nnPhoneEmoticons', 'nnPhoneMoments'
                ];

                for (const key of keys) {
                    const oldVal = localStorage.getItem(key);
                    if (oldVal) {
                        try {
                            // 解析旧数据并存入新数据库
                            await localforage.setItem(key, JSON.parse(oldVal));
                        } catch(e) { console.error("迁移出错", key, e); }
                    }
                }
                // 标记已迁移，下次不再执行
                localStorage.setItem('MIGRATION_DONE', 'true');
                console.log("系统升级完成！数据已迁移。");
            }
        }

        // 2. 从数据库加载所有数据到内存变量 (这是 App 启动的关键)
        async function loadAllData() {
            console.log("正在加载数据...");
            
            // 并行读取所有数据，速度更快
            const[
                dbUser, dbChat, dbSocial, dbVision, dbMemory, dbMomentsSet,
                dbPresets, dbChars, dbBooks, dbEmos, dbMoments,  dbVoice,  dbFavorites, dbWallet, dbOtherApi, dbForum,  dbCloud, dbPeriod, dbUserMasks, dbWeather, dbRcpLastInput, dbActiveMsgSettings
            ] = await Promise.all([
                localforage.getItem('nnPhoneUserInfo'),
                localforage.getItem('nnPhoneChatApiSettings'),
                localforage.getItem('nnPhoneSocialApiSettings'),
                localforage.getItem('nnPhoneVisionApiSettings'),
                localforage.getItem('nnPhoneMemorySettings'),
                localforage.getItem('nnPhoneMomentsSettings'),
                localforage.getItem('nnPhoneApiPresets'),
                localforage.getItem('nnPhoneCharacters'),
                localforage.getItem('nn_world_books'),
                localforage.getItem('nnPhoneEmoticons'),
                localforage.getItem('nnPhoneMoments'),
				localforage.getItem('nnPhoneVoiceApiSettings'),
				localforage.getItem('nnPhoneFavorites'), 
				localforage.getItem('nnPhoneWalletData'),
				localforage.getItem('nnPhoneOtherApiSettings'), // <--- 读取其他API设置
				localforage.getItem('nnPhoneForumBoards'),
				localforage.getItem('nnPhoneCloudSettings'),
				localforage.getItem('nnPhonePeriodData'),
				localforage.getItem('nnPhoneUserMasks'),
				localforage.getItem('nnPhoneWeatherSettings'),
				localforage.getItem('nnPhoneRcpLastInput'),
				localforage.getItem('nnPhoneActiveMsgSettings')
            ]);

            // 如果数据库里有数据，就覆盖默认值
            if (dbUser) userInfo = dbUser;
            if (dbChat) chatApiSettings = dbChat;
            if (dbSocial) socialApiSettings = dbSocial;
            if (dbVision) visionApiSettings = dbVision;
			if (dbVoice) voiceApiSettings = dbVoice;
			if (dbWallet) walletData = dbWallet;
			if (dbOtherApi) otherApiSettings = dbOtherApi; // <--- 赋值其他API设置
			if (dbForum) forumBoards = dbForum;
            if (dbCloud) cloudSettings = dbCloud; 
			if (dbPeriod) periodData = dbPeriod;
			if (dbUserMasks) userMasks = dbUserMasks;
            if (dbRcpLastInput) rcpLastInputData = dbRcpLastInput; // <--- 【新增】赋值到内存变量
			if (dbActiveMsgSettings) activeMsgSettings = dbActiveMsgSettings; 
            // 记忆设置合并
            if (dbMemory) {
                memorySettings = dbMemory;
                if(typeof memorySettings.ltmInterval === 'undefined') memorySettings.ltmInterval = 10;
                if(typeof memorySettings.ltmMax === 'undefined') memorySettings.ltmMax = 5;
                if(typeof memorySettings.ltmEnabled === 'undefined') memorySettings.ltmEnabled = true;
            }

            if (dbMomentsSet) momentsSettings = dbMomentsSet;
			if (dbWeather) weatherSettings = dbWeather;
            // 数组类数据
            if (dbPresets) apiPresets = dbPresets;
            
            if (dbChars) {
                characters = dbChars;
				let needSaveMasks = false;
                // 角色数据兼容性补丁 (防止旧数据报错)
                characters.forEach(c => {
                    if (typeof c.isPinned === 'undefined') c.isPinned = false;
                    if (typeof c.isOnline === 'undefined') c.isOnline = true;
                    if (typeof c.emoticonCategories === 'undefined') c.emoticonCategories = [];
                    if (typeof c.lifeEvents === 'undefined') c.lifeEvents =[];
					// 【新增】礼物和外卖数据容器
					if (typeof c.giftList === 'undefined') c.giftList =[];
					if (typeof c.activeDeliveries === 'undefined') c.activeDeliveries =[];
					 if (!c.userMaskId && (c.userName || c.userMask || c.userAvatar)) {
                        const newMaskId = 'mask_' + Date.now() + Math.random().toString(36).substr(2, 5);
                        userMasks.push({
                            id: newMaskId,
                            name: c.userName || userInfo.name,
                            avatar: c.userAvatar || '',
                            mask: c.userMask || '',
                            voiceId: c.userVoiceId || ''
                        });
                        c.userMaskId = newMaskId; 
                        needSaveMasks = true;

                        // 可选：清理掉旧字段，让数据更干净
                        delete c.userName;
                        delete c.userAvatar;
                        delete c.userMask;
                        delete c.userVoiceId;
                    }
                });
				
				if (needSaveMasks) {
                    saveUserMasksToLocal();
                    saveCharactersToLocal();
                    console.log("旧版专属面具已成功迁移至全局预设库！");
                }
            } // <--- dbChars 判断到这里结束

			// 【核心修复：把下面四个变量的读取从 if (dbChars) 里拿出来，保证没有角色时也能正常加载】
			if (dbBooks) worldBooks = dbBooks;
			if (dbEmos) emoticonList = dbEmos;
			if (dbMoments) socialMoments = dbMoments;
			if (dbFavorites) favoriteMessages = dbFavorites;
		}		
        // ============================================================
        // 【2.1 聊天会话临时状态 (新增分区)】
        // 说明：这些变量只在当前网页运行时有效，刷新页面后会重置
        // ============================================================
        let lastMessageTimestamp = 0; // 记录上一条消息的时间戳 (毫秒)，用于判断是否显示"18:05"这种居中时间
        let activeChatId = null;      // 当前正在聊天的角色 ID，用于区分发给谁
       
	   
	    // ============================================================
		// 【修改】线上/线下模式控制逻辑 (绑定到角色)
		// ============================================================
		const modeToggleBtn = document.getElementById('mode-toggle-btn');
		const modeCheckbox = document.getElementById('mode-checkbox');
		const modeText = document.getElementById('mode-text');
		const modeIcon = document.getElementById('mode-icon');
		const delayToggleBtn = document.getElementById('delay-toggle-btn');
		const delayCheckbox = document.getElementById('delay-checkbox');

		if (delayToggleBtn) {
			delayToggleBtn.addEventListener('click', (e) => {
				if (e.target !== delayCheckbox && e.target !== document.querySelector('#delay-checkbox + .slider')) {
					delayCheckbox.checked = !delayCheckbox.checked;
				}
				
				const newStatus = delayCheckbox.checked;

				if (activeChatId) {
					const char = characters.find(c => c.id == activeChatId);
					if (char) {
						char.enableTypingDelay = newStatus;
						saveCharactersToLocal();
					}
				}
			});
		}

		// 1. 切换事件监听
		if (modeToggleBtn) {
			modeToggleBtn.addEventListener('click', (e) => {
				// A. 基础交互：切换 checkbox
				if (e.target !== modeCheckbox && e.target !== document.querySelector('#mode-checkbox + .slider')) {
					modeCheckbox.checked = !modeCheckbox.checked;
				}
				
				const newStatus = modeCheckbox.checked;

				// B. 【核心修改】如果有活跃对话，保存到角色数据中
				if (activeChatId) {
					const char = characters.find(c => c.id == activeChatId);
					if (char) {
						char.isOnline = newStatus;
						saveCharactersToLocal(); // 保存更改！
						document.getElementById('chat-detail-status').textContent = getChatPermanentStatus(char); // 【新增】即刻响应常驻状态变化
					}
				}

				// C. 更新 UI 显示
				updateModeUI(newStatus);
				updateChatInputState(); // 【新增】切换模式时更新输入框状态
			});
		}

		// 辅助：更新 UI 文字和图标
		function updateModeUI(isOnline) {
			if (isOnline) {
				if(modeText) modeText.textContent = "线上模式";
				if(modeIcon) { modeIcon.className = "fas fa-comments"; modeIcon.style.color = "#07c160"; }
			} else {
				if(modeText) modeText.textContent = "线下模式";
				if(modeIcon) { modeIcon.className = "fas fa-book-open"; modeIcon.style.color = "#ff9800"; }
			}
		}
		
		
        // ============================================================
		// 【3. DOM元素获取区】
		// ============================================================
		
		// --- 用户头像与主页状态 ---
		const avatarMoreBtn = document.getElementById('avatar-more-btn'),
			avatarBigPreview = document.getElementById('avatar-big-preview'),
			userAvatarPreview = document.getElementById('user-avatar-preview'),
			mainUserAvatar = document.getElementById('main-user-avatar'),
			mePageStatus = document.getElementById('me-page-status');

		// --- 名字编辑相关 ---
		const nameEditBtn = document.getElementById('name-edit-btn'),
			nameEditBackBtn = document.querySelector('#name-edit-top .top-bar-back'),
			nameSaveBtn = document.getElementById('name-save-btn'),
			nameEditInput = document.getElementById('name-edit-input'),
			userNameValue = document.getElementById('user-name-value'),
			mainUserName = document.getElementById('main-user-name');

		// --- 状态签名编辑相关 ---
		const statusEditBtn = document.getElementById('status-edit-btn'),
			statusEditBackBtn = document.querySelector('#status-edit-top .top-bar-back'),
			statusSaveBtn = document.getElementById('status-save-btn'),
			statusEditInput = document.getElementById('status-edit-input'),
			userStatusValue = document.getElementById('user-status-value');

		// --- 性别编辑相关 ---
		const genderEditBtn = document.getElementById('gender-edit-btn'),
			genderEditBackBtn = document.querySelector('#gender-edit-top .top-bar-back'),
			genderSaveBtn = document.getElementById('gender-save-btn'),
			genderEditInput = document.getElementById('gender-edit-input'),
			userGenderValue = document.getElementById('user-gender-value');

		// --- 地区编辑相关 ---
		const regionEditBtn = document.getElementById('region-edit-btn'),
			regionEditBackBtn = document.querySelector('#region-edit-top .top-bar-back'),
			regionSaveBtn = document.getElementById('region-save-btn'),
			regionEditInput = document.getElementById('region-edit-input'),
			userRegionValue = document.getElementById('user-region-value');

		// --- 面具编辑相关 ---
		const maskEditBtn = document.getElementById('mask-edit-btn'),
			maskEditBackBtn = document.querySelector('#mask-edit-top .top-bar-back'),
			maskSaveBtn = document.getElementById('mask-save-btn'),
			maskEditInput = document.getElementById('mask-edit-input'),
			userMaskValue = document.getElementById('user-mask-value');

		// --- 上传与弹窗相关 ---
		const uploadModal = document.getElementById('upload-modal'),
			uploadFromFile = document.getElementById('upload-from-file'),
			uploadFromAlbum = document.getElementById('upload-from-album'),
			uploadCancel = document.getElementById('upload-cancel'),
			avatarUploadFile = document.getElementById('avatar-upload-file'),
			avatarUploadAlbum = document.getElementById('avatar-upload-album');

		// --- 设置菜单与备份相关 ---
		const settingMenuBtn = document.getElementById('setting-menu-btn'),
			settingBackBtn = document.querySelector('#setting-top .top-bar-back'),
			userManualBtn = document.getElementById('user-manual-btn'),
			customStyleBtn = document.getElementById('custom-style-btn'),
			exportCacheBtn = document.getElementById('export-cache-btn'),
			importBackupBtn = document.getElementById('import-backup-btn'),
			backupUploadFile = document.getElementById('backup-upload-file'),
			clearCacheBtn = document.getElementById('clear-cache-btn');

		// --- 聊天列表主按钮 ---
		const addChatBtn = document.getElementById('add-chat-btn');

		// --- 聊天 API 设置相关 ---
		const chatApiSettingBtn = document.getElementById('chat-api-setting-btn'),
			chatApiSaveBtn = document.getElementById('chat-api-save-btn'),
			apiUrlInput = document.getElementById('api-url-input'),
			apiKeyInput = document.getElementById('api-key-input'),
			modelSelect = document.getElementById('model-select'),
			fetchModelsBtn = document.getElementById('fetch-models-btn'),
			apiTempInput = document.getElementById('api-temp-input');

		// --- 预设 (Preset) 管理相关 ---
		const presetSelectMenu = document.getElementById('preset-select-menu'),
			managePresetsBtn = document.getElementById('manage-presets-btn'),
			saveAsPresetBtn = document.getElementById('save-as-preset-btn'),
			savePresetModal = document.getElementById('save-preset-modal'),
			presetNameInput = document.getElementById('preset-name-input'),
			cancelSavePresetBtn = document.getElementById('cancel-save-preset-btn'),
			confirmSavePresetBtn = document.getElementById('confirm-save-preset-btn'),
			managePresetsModal = document.getElementById('manage-presets-modal'),
			presetListContainer = document.getElementById('preset-list-container'),
			closeManagePresetBtn = document.getElementById('close-manage-preset-btn');

		// --- 新建聊天/角色设定相关 ---
		const newChatBackBtn = document.querySelector('#new-chat-top .top-bar-back'),
			newChatSaveBtn = document.getElementById('new-chat-save-btn'),
			characterAvatarUploader = document.getElementById('character-avatar-uploader'),
			characterAvatarUploadInput = document.getElementById('character-avatar-upload-input'),
			characterNameInput = document.getElementById('character-name-input'),
			characterPersonaInput = document.getElementById('character-persona-input'),
			characterWorldbookSelect = document.getElementById('character-worldbook-select'),
			characterVoiceId = document.getElementById('character-voice-id'),
			characterTimeAwareness = document.getElementById('character-time-awareness');

		// --- 对话操作菜单 ---
		const chatActionModal = document.getElementById('chat-action-modal'),
			deleteChatBtn = document.getElementById('delete-chat-btn'),
			cancelChatActionBtn = document.getElementById('cancel-chat-action-btn');

		// --- 全局变量 (Let) ---
		let tempCharacterAvatar = '';
		let tempNewChatUserAvatar = '';
		let tempNpcList = []; 
		let currentCharacterIdToDelete = null; // 用于存储当前要操作的角色ID
		let tempNewGroupUserAvatar = ''; // 【新增】新建群聊专用用户头像
		let tempSettingGroupUserAvatar = ''; // 【新增】群聊设置页专用用户头像
		
		// ... 其他表情包 DOM 元素 ...
		const emoticonGroupManagement = document.getElementById('emoticon-group-management');
		const renameGroupBtn = document.getElementById('rename-emoticon-group-btn');
		const deleteGroupBtn = document.getElementById('delete-emoticon-group-btn');
		
		// --- 朋友圈/论坛 API 设置相关 ---
		const socialApiSettingBtn = document.getElementById('social-api-setting-btn');
		const socialApiSettingTopBack = document.querySelector('#social-api-setting-top .top-bar-back');
		const socialApiSaveBtn = document.getElementById('social-api-save-btn');

		const socialApiUrlInput = document.getElementById('social-api-url-input');
		const socialApiKeyInput = document.getElementById('social-api-key-input');
		const socialModelSelect = document.getElementById('social-model-select');
		const socialApiTempInput = document.getElementById('social-api-temp-input');
		const socialFetchModelsBtn = document.getElementById('social-fetch-models-btn');
		const socialPresetSelectMenu = document.getElementById('social-preset-select-menu');
		// --- 朋友圈设置页相关 ---
		const momentsSettingTop = document.getElementById('moments-setting-top');
		const momentsSettingPage = document.getElementById('moments-setting-page');
		const momentsSettingBackBtn = document.querySelector('#moments-setting-top .top-bar-back');
		const momentsSettingSaveBtn = document.getElementById('moments-setting-save-btn');
		const postableCharsContainer = document.getElementById('moments-postable-chars-container');
		const memorySyncSwitch = document.getElementById('moments-memory-sync-switch');
		const memoryLimitInput = document.getElementById('moments-memory-limit-input');
		
		// ============================================================
		// 【常量定义】默认的长期记忆总结 Prompt
		// ============================================================
		const DEFAULT_LTM_PROMPT = `你即是角色 "{charName}"。你正在整理自己的长期记忆库。
		请阅读以下你与用户 "{userName}" 的对话记录，以第一人称（“我”）简要总结这段时间内发生的事情。禁止输出事件评价。

		【严格遵守以下要求】：
		1. **格式要求**：必须严格以 "{timeHeader}" 开头。
		2. **自我称呼**：必须使用第一人称“我”来指代自己（{charName}）。
		3. **用户称呼**：提到对话对象时，**必须**直接使用名字 "{userName}" 或者第三人称代词（他/她）。**严禁**使用“男人”、“女人”、“陌生人”、“用户”等泛指名词来称呼对方。
		4. **内容要求**：客观记录关键事件、地点变动、讨论的话题以及对方的重要特征或喜好。禁止输出事件评价。
		5. **字数限制**：控制在 100 字以内，语言精炼。`;
		// 【新增】群聊专属的长期记忆总结 Prompt
		const DEFAULT_GROUP_LTM_PROMPT = `你即是群聊模拟器。你正在整理群聊 "{charName}" 的长期记忆库。
		请阅读以下群聊成员与用户 "{userName}" 的对话记录，以第三人称（旁白视角）客观、简要地总结这段时间内发生的重要事件。禁止输出事件评价。

		【严格遵守以下要求】：
		1. **格式要求**：必须严格以 "{timeHeader}" 开头。
		2. **视角要求**：必须使用第三人称旁白视角进行记录，清晰指出是谁做了什么、说了什么。
		3. **用户称呼**：提到用户时，**必须**直接使用名字 "{userName}" 或者第三人称代词。
		4. **内容要求**：客观记录关键事件、地点变动、讨论的话题以及重要特征或喜好。禁止输出评价。
		5. **字数限制**：控制在 150 字以内，语言精炼。`;
        // ============================================================
        // 【4. 通用工具函数区】
        // ============================================================
        function initUserInfoDisplay() {
            mainUserName.textContent = userInfo.name; userNameValue.textContent = userInfo.name; nameEditInput.value = userInfo.name;
            mePageStatus.textContent = `状态：${userInfo.status}`; userStatusValue.textContent = userInfo.status; statusEditInput.value = userInfo.status;
            userGenderValue.textContent = userInfo.gender; genderEditInput.value = userInfo.gender;
            userRegionValue.textContent = userInfo.region; regionEditInput.value = userInfo.region;
            userMaskValue.textContent = userInfo.mask ? '已设置' : '未设置'; maskEditInput.value = userInfo.mask;
            if (userInfo.avatar) { const imgHtml = `<img src="${userInfo.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">`; avatarBigPreview.innerHTML = imgHtml.replace(' border-radius: 4px;', ''); userAvatarPreview.innerHTML = imgHtml; mainUserAvatar.innerHTML = imgHtml; } else { const iconHtml = `<i class="${userInfo.avatarIcon}"></i>`; avatarBigPreview.innerHTML = iconHtml; userAvatarPreview.innerHTML = iconHtml; mainUserAvatar.innerHTML = iconHtml; }
        }
		// ============================================================
		// 【新增】获取聊天对象常驻状态的辅助函数
		// ============================================================
		function getChatPermanentStatus(char) {
			if (!char) return "未知";
			
			const isOnline = (typeof char.isOnline !== 'undefined') ? char.isOnline : true;

			// 1. 无论是群聊还是单聊，只要是线下模式，无视拉黑，一律显示“线下模式”
			if (!isOnline) {
				return "线下模式";
			}

			// 2. 线上模式 - 群聊
			if (char.type === 'group') {
				const memberCount = (char.members ? char.members.length : 0) + 1; // 加上自己
				return `${memberCount}人在线`;
			} 
			
			// 3. 线上模式 - 私聊
			if (char.isBlockedByUser || char.isBlockedByAi) {
				return "离线"; // 被拉黑或拉黑对方显示离线
			} else {
				return "在线"; // 正常线上显示在线
			}
		}
		// ============================================================
		// 【补全】更新聊天顶部状态栏的函数
		// ============================================================
		function updateChatStatus(charId, statusText) {
			// 1. 更新全局内存中的状态
			if (statusText === false || statusText === null || statusText === "") {
				characterTypingStatus[charId] = false;
			} else {
				characterTypingStatus[charId] = statusText;
			}

			// 2. 如果当前正在看这个对话，立即更新 UI
			if (activeChatId == charId) {
				const statusEl = document.getElementById('chat-detail-status');
				if (statusEl) {
					if (characterTypingStatus[charId]) {
						// 显示临时状态，如“正在输入中...”
						statusEl.textContent = characterTypingStatus[charId];
					} else {
						// 恢复常驻状态，如“在线”、“离线”
						const char = characters.find(c => c.id == charId);
						if (char) {
							statusEl.textContent = getChatPermanentStatus(char);
						}
					}
				}
			}
		}
		// --- 格式化时间 HH:MM ---
		function formatTime(timestamp) {
			const date = new Date(timestamp);
			const hours = date.getHours().toString().padStart(2, '0');
			const minutes = date.getMinutes().toString().padStart(2, '0');
			return `${hours}:${minutes}`;
		}

		// --- 新增：生成完整的时间戳字符串 ---
		function formatFullTime(timestamp) {
			const date = new Date(timestamp);
			const y = date.getFullYear();
			const m = (date.getMonth() + 1).toString().padStart(2, '0');
			const d = date.getDate().toString().padStart(2, '0');
			const h = date.getHours().toString().padStart(2, '0');
			const min = date.getMinutes().toString().padStart(2, '0');
			const s = date.getSeconds().toString().padStart(2, '0');
			return `【${y}/${m}/${d} ${h}:${min}:${s}】`;
		}
		
		// --- 新增：生成完整的时间戳字符串 ---
		function formatFullTime(timestamp) {
			const date = new Date(timestamp);
			const y = date.getFullYear();
			const m = (date.getMonth() + 1).toString().padStart(2, '0');
			const d = date.getDate().toString().padStart(2, '0');
			const h = date.getHours().toString().padStart(2, '0');
			const min = date.getMinutes().toString().padStart(2, '0');
			const s = date.getSeconds().toString().padStart(2, '0');
			return `【${y}/${m}/${d} ${h}:${min}:${s}】`;
		}

        // ============================================================
        // 【新增函数】生成气泡详细时间格式 (YY/MM/DD HH:MM:SS)
        // ============================================================
        function formatDetailTime(timestamp) {
            const date = new Date(timestamp);
            const yy = date.getFullYear().toString().slice(-2);
            const mm = (date.getMonth() + 1).toString().padStart(2, '0');
            const dd = date.getDate().toString().padStart(2, '0');
            const h = date.getHours().toString().padStart(2, '0');
            const min = date.getMinutes().toString().padStart(2, '0');
            const s = date.getSeconds().toString().padStart(2, '0');
            return `${yy}/${mm}/${dd} ${h}:${min}:${s}`;
        }
		
		// ============================================================
		// 【优化版】图片压缩工具函数
		// ============================================================
		function compressImage(base64Str, maxWidth = 800, quality = 0.6) {
			return new Promise((resolve, reject) => {
				const img = new Image();
				img.src = base64Str;
				img.onload = () => {
					const canvas = document.createElement('canvas');
					let width = img.width;
					let height = img.height;

					if (width > maxWidth) {
						height = Math.round(height * (maxWidth / width));
						width = maxWidth;
					}

					canvas.width = width;
					canvas.height = height;
					const ctx = canvas.getContext('2d');

					// 绘制白色背景，防止PNG透明部分变黑
					ctx.fillStyle = '#FFFFFF';
					ctx.fillRect(0, 0, width, height);
					ctx.drawImage(img, 0, 0, width, height);

					// 统一输出为 jpeg 格式以保证压缩效果
					const newBase64 = canvas.toDataURL('image/jpeg', quality);
					resolve(newBase64);
				};
				img.onerror = (err) => reject(new Error('图片加载失败，无法压缩'));
			});
		}
		// ============================================================
		// 【新增】更新聊天输入框状态 (处理拉黑锁定)
		// ============================================================
		function updateChatInputState() {
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
			if (!char) return;

			const input = document.querySelector('.chat-bar-input');
			const sendBtn = document.querySelector('.send-btn');
			const aiBtn = document.querySelector('.ai-btn');
			const attachBtn = document.getElementById('chat-attach-btn');
			const emoBtn = document.getElementById('emoticon-toggle-btn');
			
			const isOnline = (typeof char.isOnline !== 'undefined') ? char.isOnline : true;

			// 辅助函数：启用/禁用按钮
			const setButtonsDisabled = (disabled) => {
				const opacity = disabled ? '0.4' : '1';
				const pointer = disabled ? 'none' : 'auto';
				[sendBtn, aiBtn, attachBtn, emoBtn].forEach(btn => {
					if(btn) {
						btn.style.opacity = opacity;
						btn.style.pointerEvents = pointer;
					}
				});
			};

			if (isOnline) {
				if (char.isBlockedByUser) {
					input.disabled = true;
					input.placeholder = "请先解除拉黑";
					input.value = "";
					setButtonsDisabled(true);
				} else if (char.isBlockedByAi) {
					input.disabled = true;
					input.placeholder = "您已被拉黑";
					input.value = "";
					setButtonsDisabled(true);
				} else {
					input.disabled = false;
					input.placeholder = "发消息...";
					setButtonsDisabled(false);
				}
			} else {
				// 线下模式：无视拉黑，永远可以发送（代表现实中的互动）
				input.disabled = false;
				input.placeholder = "发消息...";
				setButtonsDisabled(false);
			}
		}
		// ============================================================
		// 【修复版】移除 AI 回复中可能包含的时间戳 (全局清理)
		// ============================================================
		function removeTimestamp(text) {
			if (!text) return '';
			// 1. 【核心修复】：去掉开头的 ^，加上 g (全局匹配)
			// 这样无论时间戳出现在开头、中间还是结尾，都会被删掉
			return text.replace(/【\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}】/g, '').trim();
		}
		/**
		 * 【新增】渲染表情包分类选择列表
		 * @param {HTMLElement} container 容器
		 * @param {Array} selectedCategories 已勾选的分类名数组
		 */
		function renderEmoticonSelection(container, selectedCategories = []) {
			if (!container) return;
			container.innerHTML = "";

			// 获取当前所有的表情包分类
			const allCategories = [...new Set(emoticonList.map(e => e.category))];

			if (allCategories.length === 0) {
				container.innerHTML = `<div style="padding:10px; color:#999; font-size:12px; text-align:center;">暂无表情包，请先在“我的-表情管理”中添加</div>`;
				return;
			}

			allCategories.forEach(cat => {
				const isChecked = selectedCategories.includes(cat) ? 'checked' : '';
				const label = document.createElement('label');
				label.className = 'checkbox-item';
				label.innerHTML = `
					<input type="checkbox" value="${cat}" ${isChecked}>
					<span class="custom-check-circle"></span>
					<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cat}</span>
				`;
				container.appendChild(label);
			});
		}
		/**
		 * 【新增】通用函数：渲染世界书选择列表 (带分类分组)
		 * @param {HTMLElement} container - 容器元素 (例如 #worldbook-select-container)
		 * @param {Array} selectedIds - 已选中的ID数组 (用于回显)
		 */
		function renderWorldbookSelection(container, selectedIds = []) {
			if (!container) return;
			container.innerHTML = "";

			if (!worldBooks || worldBooks.length === 0) {
				container.innerHTML = `<div style="padding:10px; color:#999; font-size:12px; text-align:center;">暂无世界书，请先在“我的-世界书”中添加</div>`;
				return;
			}

			// 1. 分组
			const groups = {};
			worldBooks.sort((a, b) => (a.category || "zzz").localeCompare(b.category || "zzz", 'zh-CN'));
			
			worldBooks.forEach(book => {
				const cat = book.category || "默认分类";
				if (!groups[cat]) groups[cat] = [];
				groups[cat].push(book);
			});

			// 2. 渲染
			for (const cat in groups) {
				// 渲染分类标题
				const catTitle = document.createElement('div');
				catTitle.style.cssText = "font-size: 12px; color: #999; background: #f9f9f9; padding: 4px 10px; font-weight:bold; margin-top:5px;";
				catTitle.textContent = cat;
				container.appendChild(catTitle);

				// 渲染该分类下的选项
				groups[cat].forEach(book => {
					const isChecked = selectedIds.includes(book.id) ? 'checked' : '';
					
					const label = document.createElement('label');
					label.className = 'checkbox-item';
					// 注意：input 的 value 存储 worldbook 的 ID
					label.innerHTML = `
						<input type="checkbox" value="${book.id}" ${isChecked}>
						<span class="custom-check-circle"></span>
						<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${book.title}</span>
					`;
					container.appendChild(label);
				});
			}
		}
		
		// ============================================================
		// 【修复版】朋友圈未读红点控制逻辑 (强制显示红点)
		// ============================================================
		function updateMomentsUnreadBadge() {
			const hasUnread = momentsSettings.hasUnread;
			
			// ------------------------------------------------------
			// 1. 底部导航栏 "发现" 图标红点
			// ------------------------------------------------------
			const discoverNav = document.querySelector('.nav-item[data-page="discover-page"]');
			if (discoverNav) {
				// 查找是否已经有了我们手动添加的红点
				let navBadge = discoverNav.querySelector('.custom-nav-badge');

				if (hasUnread) {
					if (!navBadge) {
						// 如果没有，手动创建一个
						navBadge = document.createElement('div');
						navBadge.className = 'custom-nav-badge';
						
						// 【核心】手动写死样式，确保一定能看到
						navBadge.style.cssText = `
							position: absolute;
							top: 4px;
							left: 50%; 
							margin-left: 5px; /* 从中心向右偏移，避免挡住图标 */
							width: 8px;
							height: 8px;
							background-color: #ff3b30;
							border-radius: 50%;
							z-index: 100;
							box-shadow: 0 0 0 1px #fff; /* 加个白边更好看 */
						`;
						
						// 确保父级有定位属性，否则红点会乱跑
						// (通常 .nav-item 已经是 relative 或 flex item，但为了保险加一句)
						if (getComputedStyle(discoverNav).position === 'static') {
							discoverNav.style.position = 'relative';
						}
						
						discoverNav.appendChild(navBadge);
					}
				} else {
					// 如果已读，移除红点
					if (navBadge) navBadge.remove();
				}
			}

			// ------------------------------------------------------
			// 2. 发现页 "朋友圈" 选项红点 (保持原有逻辑)
			// ------------------------------------------------------
			const momentsEntryBtn = document.getElementById('moments-entry-btn');
			if (momentsEntryBtn) {
				let badge = momentsEntryBtn.querySelector('.moments-unread-badge');
				if (hasUnread) {
					if (!badge) {
						badge = document.createElement('div');
						badge.className = 'moments-unread-badge';
						badge.style.cssText = `
							position: absolute;
							top: 50%;
							right: 40px;
							transform: translateY(-50%);
							width: 8px;
							height: 8px;
							background-color: #ff3b30;
							border-radius: 50%;
						`;
						momentsEntryBtn.style.position = 'relative'; 
						momentsEntryBtn.appendChild(badge);
					}
				} else {
					if (badge) badge.remove();
				}
			}
		}

		// 辅助函数：设置未读状态
		function setMomentsUnread(status) {
			// 只有当状态改变时才执行保存和渲染
			if (momentsSettings.hasUnread !== status) {
				momentsSettings.hasUnread = status;
				saveMomentsSettingsToLocal(); // 保存设置
				updateMomentsUnreadBadge();   // 更新UI
			}
		}
		
		// ============================================================
		// 【API 核心逻辑】
		// ============================================================
		
		/**
		 * 【重写】调用识图 API 分析图片 (V7.0 无Token上限版)
		 * 1. 移除 max_tokens 限制，使用模型默认最大值
		 * 2. 支持读取 reasoning_content (适配 Gemini/DeepSeek 推理模型)
		 */
		async function analyzeImage(base64Image) {
			let settingsToUse = null;
			let apiMode = '';

			// 1. 【严格优先级判断】
			if (visionApiSettings && visionApiSettings.baseUrl && visionApiSettings.apiKey && visionApiSettings.model) {
				settingsToUse = visionApiSettings;
				apiMode = '独立识图API';
			} 
			else if (chatApiSettings && chatApiSettings.baseUrl && chatApiSettings.apiKey && chatApiSettings.model) {
				settingsToUse = chatApiSettings;
				apiMode = '聊天API (降级)';
			}

			if (!settingsToUse) {
				throw new Error("识图失败：请先在“设置”中完整配置“识图API”或“聊天API”(URL, Key, Model)。");
			}

			let url = settingsToUse.baseUrl.replace(/\/$/, "");
			if (!url.includes("/chat/completions")) {
				url += (url.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions");
			}
			
			const modelToUse = settingsToUse.model;
			const promptText = (visionApiSettings && visionApiSettings.prompt) ? visionApiSettings.prompt : "详细描述这张图片的内容。输出格式：[这是一张图片，图片内容为……]";
			
			let cleanBase64 = base64Image;
			if (!cleanBase64.startsWith('data:')) {
				cleanBase64 = `data:image/jpeg;base64,${cleanBase64}`;
			}

			console.log(`[Vision] 开始请求... 模式: ${apiMode}, 模型: ${modelToUse}`);

			const requestBody = {
				model: modelToUse,
				messages: [
					{ role: "user", content: [ { type: "text", text: promptText }, { type: "image_url", image_url: { url: cleanBase64, detail: "auto" } } ] }
				],
				stream: false
			};

			try {
				const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settingsToUse.apiKey}` }, body: JSON.stringify(requestBody) });
				const data = await response.json();
				if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
				if (data.choices?.[0]?.finish_reason === 'content_filter') throw new Error("图片触发了AI安全审查。");
				let desc = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content;
				if (!desc) throw new Error("API返回成功但内容为空。");
				return desc;
			} catch (e) {
				console.error("识图请求异常:", e);
				throw e;
			}
		}
		


		// ============================================================
		// 【修复版】语音合成 (关闭流式，防止音频重复)
		// ============================================================
		async function playMinimaxTTS(text, voiceId) {
			// 1. 基础校验
			if (!voiceApiSettings.groupId || !voiceApiSettings.apiKey) {
				console.warn("语音API未配置，无法播放");
				return;
			}
			if (!text || !voiceId) return;

			// 2. 停止当前正在播放的音频
			if (currentAudioPlayer) {
				try {
					currentAudioPlayer.pause();
					currentAudioPlayer.currentTime = 0;
					currentAudioPlayer = null;
				} catch (e) {
					console.error("停止音频失败:", e);
				}
			}

			console.log("开始请求语音合成...");

			// 3. 准备请求
			const workerUrl = "https://1317879082-haz8af7n5j.ap-nanjing.tencentscf.com"; 
			const url = `${workerUrl}?GroupId=${voiceApiSettings.groupId}`;

			const requestBody = {
				model: "speech-01-turbo", 
				text: text, 
				stream: false, // 【核心修改】改为 false，直接请求完整包，避免拼接重复
				voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
				audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 }
			};

			try {
				// 4. 发起请求
				const response = await fetch(url, {
					method: "POST",
					headers: { "Authorization": `Bearer ${voiceApiSettings.apiKey}`, "Content-Type": "application/json" },
					body: JSON.stringify(requestBody)
				});

				if (!response.ok) {
					console.error("语音请求失败:", response.status, await response.text());
					return;
				}
				
				// 5. 【核心修改】解析标准 JSON (非流式)
				const data = await response.json();
				
				// 检查 API 错误
				if (data.base_resp && data.base_resp.status_code !== 0) {
					console.error("API返回错误:", data.base_resp.status_msg);
					return;
				}

				let fullHexString = '';
				// 非流式模式下，音频数据直接在 data.data.audio 中
				if (data.data && data.data.audio) {
					fullHexString = data.data.audio;
				}

				console.log("音频数据长度:", fullHexString.length); // 此时长度应该会减半，恢复正常

				// 6. 播放音频
				if (fullHexString) {
					const audioBlob = hexStringToBlob(fullHexString);
					if (audioBlob && audioBlob.size > 100) {
						const audioUrl = URL.createObjectURL(audioBlob);
						const audio = new Audio(audioUrl);
						
						currentAudioPlayer = audio;
						// 【新增】告诉系统这是媒体播放，允许后台播放并显示在锁屏界面
						if ('mediaSession' in navigator) {
							navigator.mediaSession.metadata = new MediaMetadata({
								title: "语音消息",
								artist: characters.find(c => c.id == activeChatId)?.name || "AI助手",
								album: "NN小手机",
								artwork: [
									{ src: 'static/images/icon.png', sizes: '96x96', type: 'image/png' }
								]
							});
						}
						audio.play().catch(e => {
							console.error("播放被拦截:", e);
						});

						audio.onended = () => { 
							URL.revokeObjectURL(audioUrl); 
							if (currentAudioPlayer === audio) currentAudioPlayer = null; 
						};
						
						audio.onerror = () => { 
							URL.revokeObjectURL(audioUrl); 
							if (currentAudioPlayer === audio) currentAudioPlayer = null; 
						};
					} else {
						console.error("音频数据解析失败或为空");
					}
				} else {
					console.error("未获取到音频数据 (fullHexString为空)");
				}

			} catch (error) {
				console.error("TTS Fetch Error:", error);
			}
		}
		// ============================================================
		// 【新增】论坛系统核心逻辑
		// ============================================================
		// --- 论坛全局 Loading 状态管理器 ---
		let forumActiveTaskCount = 0; // 记录当前有几个后台任务

		function updateForumGlobalLoading(isStart) {
			if (isStart) {
				forumActiveTaskCount++;
			} else {
				forumActiveTaskCount--;
				if (forumActiveTaskCount < 0) forumActiveTaskCount = 0;
			}

			const mainRefreshBtn = document.getElementById('forum-refresh-btn');
			
			// 只有当存在任务时，主按钮才旋转
			if (mainRefreshBtn) {
				if (forumActiveTaskCount > 0) {
					mainRefreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
					mainRefreshBtn.style.opacity = '0.6';
					mainRefreshBtn.disabled = true; // 禁用点击，防止重复刷新
				} else {
					mainRefreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
					mainRefreshBtn.style.opacity = '1';
					mainRefreshBtn.disabled = false;
				}
			}
		}
		let currentForumBoardId = null;
		let currentForumPostId = null;

		// --- 导航入口 ---
		const forumEntryBtn = document.getElementById('forum-entry-btn');
		const forumMainTopBack = document.querySelector('#forum-main-top .top-bar-back');
		
		if (forumEntryBtn) {
			forumEntryBtn.addEventListener('click', () => {
				renderForumTabs();
				switchPage('forum-main-page');
				switchTopBar('forum-main-top');
				// 重置 contentArea 的 top 距离以适配导航栏
				const contentArea = document.getElementById('main-content-area');
				if (contentArea) contentArea.style.top = '44px';
			});
		}
		if (forumMainTopBack) {
			forumMainTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		// --- UI 渲染：版块 Tabs ---
		function renderForumTabs() {
			const container = document.getElementById('forum-tabs-container');
			const postsContainer = document.getElementById('forum-posts-container');
			container.innerHTML = '';

			if (forumBoards.length === 0) {
				currentForumBoardId = null;
				postsContainer.innerHTML = `
					<div style="text-align:center; padding: 50px 20px; color:#999;">
						<i class="fas fa-comments" style="font-size:40px; margin-bottom:15px; color:#ddd;"></i>
						<p>当前没有论坛版块</p>
						<p style="font-size:12px; margin-top:5px;">请点击右侧 [+] 添加</p>
					</div>`;
				return;
			}

			// 如果没有选中版块，默认选第一个
			if (!currentForumBoardId || !forumBoards.find(b => b.id === currentForumBoardId)) {
				currentForumBoardId = forumBoards[0].id;
			}

			forumBoards.forEach(board => {
				const isActive = board.id === currentForumBoardId ? 'active' : '';
				const tab = document.createElement('div');
				tab.className = `forum-tab ${isActive}`;
				tab.textContent = board.name;
				tab.onclick = () => {
					currentForumBoardId = board.id;
					renderForumTabs(); // 刷新高亮
				};
				container.appendChild(tab);
			});

			renderForumPosts();
		}

		// --- UI 渲染：帖子列表 ---
		function renderForumPosts() {
			const container = document.getElementById('forum-posts-container');
			if (!currentForumBoardId) return;

			const board = forumBoards.find(b => b.id === currentForumBoardId);
			if (!board) return;

			let html = '';

			// 【新增】版块专属操作栏 (要求1)
			html += `
				<div class="forum-board-action-bar">
					<button class="btn-mask" onclick="openForumMaskPage()"><i class="fas fa-user-ninja"></i> 发帖面具</button>
					<button class="btn-post" onclick="openForumCreatePostPage()"><i class="fas fa-edit"></i> 发帖</button>
				</div>
			`;

			if (!board.posts || board.posts.length === 0) {
				html += `
					<div style="text-align:center; padding: 50px 20px; color:#999;">
						<p>该版块暂无内容</p>
						<p style="font-size:12px; margin-top:5px;">点击上方按钮发帖，或点击右上角刷新生成</p>
					</div>`;
				container.innerHTML = html;
				return;
			}

			// 截取最新的帖子显示 (限制5条)
			const displayLimit = 5;
			const displayPosts =[...board.posts].sort((a, b) => b.timestamp - a.timestamp).slice(0, displayLimit);

			displayPosts.forEach(post => {
				const timeStr = getSmartTime(post.timestamp);
				const avatarHtml = post.authorAvatar ? `<img src="${post.authorAvatar}">` : `<i class="fas fa-user" style="font-size:20px; color:#ccc;"></i>`;
				
				html += `
					<div class="forum-post-card" onclick="openForumPost('${post.id}')">
						<button class="fpc-delete-btn" onclick="event.stopPropagation(); deleteForumPost('${post.id}')"><i class="fas fa-times"></i></button>
						<div class="fpc-title">${post.title}</div>
						<div class="fpc-content-preview">${post.content}</div>
						<div class="fpc-footer">
							<div class="fpc-author">
								<div style="width:20px;height:20px;border-radius:50%;overflow:hidden;background:#eee;display:flex;align-items:center;justify-content:center;">${avatarHtml}</div>
								<span>${post.authorName}</span>
							</div>
							<div class="fpc-time">${timeStr}</div>
						</div>
					</div>
				`;
			});

			container.innerHTML = html;
		}

		// ============================================================
		// 【要求1】发帖面具相关逻辑 (修复版：全量采用预设面具系统)
		// ============================================================

		window.openForumMaskPage = function() {
			const board = forumBoards.find(b => b.id === currentForumBoardId);
			if (!board) return;

			// 直接回显当前版块绑定的面具ID
			renderUserMaskSelectOptions('forum-board-mask-select', board.userMaskId || '');

			switchPage('forum-mask-page');
			switchTopBar('forum-mask-top');
		};

		// 绑定面具返回与保存
		document.querySelector('#forum-mask-top .top-bar-back').addEventListener('click', () => {
			switchPage('forum-main-page');
			switchTopBar('forum-main-top');
		});

		document.getElementById('forum-mask-save-btn').addEventListener('click', () => {
			const board = forumBoards.find(b => b.id === currentForumBoardId);
			if (board) {
				const selectEl = document.getElementById('forum-board-mask-select');
				board.userMaskId = selectEl ? selectEl.value : '';
				
				saveForumBoardsToLocal();
				alert('版块发帖面具已保存！');
				document.querySelector('#forum-mask-top .top-bar-back').click();
			}
		});

		// 【修复】修正记忆设置页返回按钮的逻辑 
		const memBackBtn = document.querySelector('#memory-setting-top .top-bar-back');
		if (memBackBtn) {
			const newBackBtn = memBackBtn.cloneNode(true);
			memBackBtn.parentNode.replaceChild(newBackBtn, memBackBtn);
			newBackBtn.addEventListener('click', () => {
				switchPage('contact-page');
				switchTopBar('contact-top');
			});
		}
		// ============================================================
		// 【要求1】用户主动发帖逻辑 (含生成5条回复)
		// ============================================================
		window.openForumCreatePostPage = function() {
			document.getElementById('forum-create-title').value = '';
			document.getElementById('forum-create-content').value = '';
			switchPage('forum-create-post-page');
			switchTopBar('forum-create-post-top');
		};

		document.querySelector('#forum-create-post-top .top-bar-back').addEventListener('click', () => {
			switchPage('forum-main-page');
			switchTopBar('forum-main-top');
		});

		document.getElementById('forum-do-post-btn').addEventListener('click', async () => {
			const title = document.getElementById('forum-create-title').value.trim();
			const content = document.getElementById('forum-create-content').value.trim();
			if (!title || !content) { alert("标题和正文不能为空！"); return; }

			const board = forumBoards.find(b => b.id === currentForumBoardId);
			if (!board) return;

			// 获取发帖身份 (优先使用版块绑定的预设面具)
			let pName = userInfo.name;
			let pAvatar = userInfo.avatar || '';
			let pMask = userInfo.mask || '无设定';

			if (board.userMaskId) {
				const boundMask = userMasks.find(m => m.id === board.userMaskId);
				if (boundMask) {
					pName = boundMask.name || pName;
					pAvatar = boundMask.avatar || pAvatar;
					pMask = boundMask.mask || pMask;
				}
			} else if (board.userPersona) {
				pName = board.userPersona.name || pName;
				pAvatar = board.userPersona.avatar || pAvatar;
				pMask = board.userPersona.mask || pMask;
			}

			const newPost = {
				id: 'post_user_' + Date.now(),
				title: title,
				content: content,
				authorId: 'user', 
				authorName: pName,
				authorAvatar: pAvatar,
				timestamp: Date.now(),
				replies:[]
			};

			if (!board.posts) board.posts = [];
			
			// 将新帖子加在最前面
			board.posts.unshift(newPost);

			// 【核心修改】用户发帖后，同样立即执行裁切，保持数据轻量
			// 严格遵守版块设置的记忆条数 (默认5条)
			const maxLimit = parseInt(board.memoryLimit) || 5;
			if (board.posts.length > maxLimit) {
				board.posts = board.posts.slice(0, maxLimit);
			}

			saveForumBoardsToLocal();

			// 返回并刷新列表
			document.querySelector('#forum-create-post-top .top-bar-back').click();
			renderForumPosts();

			// 【核心修改】开启全局 Loading，并在后台生成完成后关闭
			updateForumGlobalLoading(true); 
			
			// 使用 Promise.resolve().then 确保不阻塞 UI，让 alert 先弹出来或者直接不弹
			// 这里我们直接异步执行
			try {
				await generateRepliesForUserPost(board, newPost, pMask);
			} catch (e) {
				console.error(e);
			} finally {
				updateForumGlobalLoading(false); // 【关键】任务结束，关闭 Loading
			}
		});

		// ============================================================
		// 【修改版】用户发帖后的初始回复生成 (支持楼中楼互动)
		// ============================================================
		async function generateRepliesForUserPost(board, post, userMask) {
			let wbContext = "";			
			// 提取当前版块允许发帖的所有角色 ID
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(board.allowedCharIds || []) : "";
			const { wbBefore, wbAfter } = getFormattedWorldBooks(board.worldBookIds);
			const prompt = `
			 ${wbBefore}
			你是一个名为 "${board.name}" 的网络论坛模拟器。
			用户 "${post.authorName}" (人设: ${userMask}) 刚刚发布了一篇新帖：
			【标题】: ${post.title}
			【正文】: ${post.content}
			【发文可参照的论坛世界观】:  ${wbAfter}
			【可参考的角色运势】: ${fortuneContext}
			【任务要求】
			请根据帖子内容和版块氛围，模拟 5 名不同的网友(NPC) 对这篇帖子的回复。
			1. **互动性**：回复内容要自然。**允许网友直接回复楼主，也允许网友B回复网友A（形成争论或附和）。**
			2. **格式**：如果某条回复是针对特定人的，必须在 JSON 的 "replyTo" 字段填入对方名字。如果是直接回帖，"replyTo" 留空。
			3. **【严禁越权】**：**绝对禁止**使用用户 "${post.authorName}" 的身份去发表任何回复（即生成的回复中，"authorName" 绝对不能是 "${post.authorName}"）！
			【JSON输出格式 (严格遵守)】
			{
				"replies":[
					{"authorName": "路人甲", "content": "第一条回复内容", "replyTo": ""},
					{"authorName": "网友乙", "content": "楼上说得不对吧...", "replyTo": "路人甲"},
					{"authorName": "路人丙", "content": "支持楼主！", "replyTo": "${post.authorName}"},
					{"authorName": "网友丁", "content": "第四条回复内容", "replyTo": ""},
					{"authorName": "路人戊", "content": "第五条回复内容", "replyTo": "网友乙"}
				]
			}
			`;

			const useSettings = (socialApiSettings && socialApiSettings.baseUrl && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;
			
			try {
				const responseText = await callOpenAiApi([
					{ role: "system", content: prompt },
					{ role: "user", content: "请生成5条回复。" }
				], useSettings);

				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const data = JSON.parse(jsonMatch[0]);
					const now = Date.now();
					const generatedReplies = (data.replies ||[]).slice(0,5).map((r, idx) => ({
						id: 'rep_ai_' + now + '_' + idx,
						authorName: r.authorName,
						authorAvatar: '',
						content: r.content,
						replyTo: r.replyTo || null, // 【关键】保存回复对象
						timestamp: now + (idx * 1000)
					}));

					post.replies = [...post.replies, ...generatedReplies];
					saveForumBoardsToLocal();
					
					if (currentForumPostId === post.id) {
						renderPostDetail();
					}
				}
			} catch (e) {
				console.error("生成用户贴回复失败:", e);
			}
		}

		// 删除帖子
		window.deleteForumPost = function(postId) {
			if (!confirm("确定要删除这篇帖子吗？")) return;
			const board = forumBoards.find(b => b.id === currentForumBoardId);
			if (board && board.posts) {
				board.posts = board.posts.filter(p => p.id !== postId);
				saveForumBoardsToLocal();
				renderForumPosts();
			}
		};

		// --- 版块管理页面逻辑 ---
		document.getElementById('forum-add-board-btn').addEventListener('click', () => {
			openBoardEditPage(null); // null表示新增
		});

		document.getElementById('forum-manage-boards-btn').addEventListener('click', () => {
			renderManageBoardsList();
			switchPage('forum-manage-page');
			switchTopBar('forum-manage-top');
		});

		document.querySelector('#forum-manage-top .top-bar-back').addEventListener('click', () => {
			renderForumTabs();
			switchPage('forum-main-page');
			switchTopBar('forum-main-top');
		});

		function renderManageBoardsList() {
			const container = document.getElementById('forum-manage-list-container');
			container.innerHTML = '';
			if (forumBoards.length === 0) {
				container.innerHTML = '<p style="text-align:center; color:#999; margin-top:30px;">暂无版块</p>';
				return;
			}
			forumBoards.forEach(board => {
				container.innerHTML += `
					<div class="menu-btn" onclick="openBoardEditPage('${board.id}')" style="margin-bottom: 10px;">
						<div class="menu-btn-left">
							<i class="fas fa-hashtag icon" style="color: #576b95;"></i>
							<span class="menu-btn-text">${board.name}</span>
						</div>
						<i class="fas fa-chevron-right menu-btn-arrow"></i>
					</div>
				`;
			});
		}

		// --- 添加/编辑版块逻辑 ---
		function openBoardEditPage(boardId) {
			const titleEl = document.getElementById('forum-board-edit-title');
			const nameInput = document.getElementById('forum-board-name-input');
			const wbContainer = document.getElementById('forum-board-wb-container');
			const charsContainer = document.getElementById('forum-board-chars-container');
			const syncSwitch = document.getElementById('forum-board-sync-switch');
			const limitInput = document.getElementById('forum-board-limit-input');
			const idInput = document.getElementById('forum-board-id-input');
			const delSection = document.getElementById('forum-board-delete-section');

			// 渲染选项列表 (复用已有的多选渲染函数)
			renderWorldbookSelection(wbContainer,[]);
			
			// 渲染角色多选
			charsContainer.innerHTML = '';
			const validChars = characters.filter(c => c.type !== 'group');
			validChars.forEach(char => {
				charsContainer.innerHTML += `
					<label class="checkbox-item">
						<input type="checkbox" value="${char.id}">
						<span class="custom-check-circle"></span>
						<div style="display:flex; align-items:center;">
							<img src="${char.avatar || ''}" style="width:24px; height:24px; border-radius:4px; margin-right:8px; object-fit:cover; background:#eee;">
							<span>${char.name}</span>
						</div>
					</label>
				`;
			});

			if (boardId) {
				const board = forumBoards.find(b => b.id === boardId);
				titleEl.textContent = "编辑版块";
				idInput.value = board.id;
				nameInput.value = board.name;
				syncSwitch.checked = board.syncMemory;
				limitInput.value = board.memoryLimit || 5;
				
				// 回显打钩
				if (board.worldBookIds) {
					wbContainer.querySelectorAll('input').forEach(cb => {
						if (board.worldBookIds.includes(cb.value)) cb.checked = true;
					});
				}
				if (board.allowedCharIds) {
					charsContainer.querySelectorAll('input').forEach(cb => {
						if (board.allowedCharIds.includes(cb.value)) cb.checked = true;
					});
				}
				delSection.style.display = 'block';
			} else {
				titleEl.textContent = "添加版块";
				idInput.value = "";
				nameInput.value = "";
				syncSwitch.checked = true;
				limitInput.value = 5;
				delSection.style.display = 'none';
			}
			let maskIdToRender = '';
			if (boardId) {
				const existingBoard = forumBoards.find(b => b.id === boardId);
				if (existingBoard) maskIdToRender = existingBoard.userMaskId || '';
			}
			// 【修复】调用我们刚刚写好的兼容版渲染函数
			renderUserMaskSelectOptions('forum-board-mask-select', maskIdToRender);
			
			switchPage('forum-board-edit-page');
			switchTopBar('forum-board-edit-top');
		}


		// --- 修复：从添加/编辑版块页面返回时，强制重新渲染数据 ---
		document.querySelector('#forum-board-edit-top .top-bar-back').addEventListener('click', () => {
			if (document.getElementById('forum-board-id-input').value) {
				// 如果是从“编辑版块”返回，刷新版块管理列表
				renderManageBoardsList(); 
				switchPage('forum-manage-page');
				switchTopBar('forum-manage-top');
			} else {
				// 如果是从“新增版块”返回，刷新论坛主页的 Tabs 分页
				renderForumTabs(); 
				switchPage('forum-main-page');
				switchTopBar('forum-main-top');
			}
		});

		document.getElementById('forum-board-save-btn').addEventListener('click', () => {
			const name = document.getElementById('forum-board-name-input').value.trim();
			if (!name) { alert("请输入版块名称"); return; }

			const wbIds = Array.from(document.querySelectorAll('#forum-board-wb-container input:checked')).map(cb => cb.value);
			const charIds = Array.from(document.querySelectorAll('#forum-board-chars-container input:checked')).map(cb => cb.value);
			const syncMem = document.getElementById('forum-board-sync-switch').checked;
			let limit = parseInt(document.getElementById('forum-board-limit-input').value);
			if (isNaN(limit) || limit < 1) limit = 5;
			const bMaskId = document.getElementById('forum-board-mask-select') ? document.getElementById('forum-board-mask-select').value : '';
			const idInput = document.getElementById('forum-board-id-input').value;

			if (idInput) {
				// 修改
				const board = forumBoards.find(b => b.id === idInput);
				board.name = name;
				board.worldBookIds = wbIds;
				board.allowedCharIds = charIds;
				board.syncMemory = syncMem;
				board.memoryLimit = limit;
				board.userMaskId = bMaskId; // <--- 🌟 放在这里安全赋值
			} else {
				// 新增
				const newBoard = {
					id: 'board_' + Date.now(),
					name: name,
					worldBookIds: wbIds,
					allowedCharIds: charIds,
					syncMemory: syncMem,
					memoryLimit: limit,
					userMaskId: bMaskId, // <--- 🌟 放在这里安全赋值
					posts:[]
				};
				forumBoards.push(newBoard);
				currentForumBoardId = newBoard.id; // 新增后自动选中
			}

			saveForumBoardsToLocal();
			alert("保存成功！");
			document.querySelector('#forum-board-edit-top .top-bar-back').click();
		});

		document.getElementById('forum-board-delete-btn').addEventListener('click', () => {
			if (confirm("确定要删除此版块及所有帖子吗？")) {
				const idInput = document.getElementById('forum-board-id-input').value;
				forumBoards = forumBoards.filter(b => b.id !== idInput);
				saveForumBoardsToLocal();
				alert("已删除");
				renderManageBoardsList();
				document.querySelector('#forum-manage-top .top-bar-back').click();
			}
		});
		// ============================================================
		// 【新增】论坛 @ 召唤功能交互逻辑
		// ============================================================
		const forumAtBtn = document.getElementById('forum-at-btn');
		const forumAtModal = document.getElementById('forum-at-modal');
		const forumAtList = document.getElementById('forum-at-list-container');
		const forumAtCancel = document.getElementById('forum-at-cancel-btn');

		if (forumAtBtn) {
			forumAtBtn.addEventListener('click', () => {
				renderForumAtList();
				forumAtModal.classList.add('show');
			});
		}

		if (forumAtCancel) {
			forumAtCancel.addEventListener('click', () => {
				forumAtModal.classList.remove('show');
			});
		}

		function renderForumAtList() {
			if (!forumAtList) return;
			forumAtList.innerHTML = '';

			// 排除群聊，只显示私聊角色
			const validChars = characters.filter(c => c.type !== 'group');

			if (validChars.length === 0) {
				forumAtList.innerHTML = '<div style="text-align:center;color:#999;margin-top:20px;">暂无角色可召唤</div>';
				return;
			}

			validChars.forEach(char => {
				const avatarSrc = char.avatar || '';
				const avatarHtml = avatarSrc 
					? `<img src="${avatarSrc}" class="forum-at-avatar">` 
					: `<div class="forum-at-avatar" style="display:flex;align-items:center;justify-content:center;"><i class="fas fa-user" style="color:#ccc;"></i></div>`;

				const item = document.createElement('div');
				item.className = 'forum-at-item';
				item.innerHTML = `${avatarHtml}<div class="forum-at-name">${char.name}</div>`;
				
				item.onclick = () => {
					insertAtMention(char.name);
					forumAtModal.classList.remove('show');
				};
				forumAtList.appendChild(item);
			});
		}

		function insertAtMention(name) {
			const input = document.getElementById('forum-reply-input');
			if (input) {
				// 在光标处或末尾插入
				const originalVal = input.value;
				const mention = `@${name} `;
				input.value = originalVal + mention;
				input.focus();
			}
		}
		// ============================================================
		// 【核心 AI 逻辑】刷新生成帖子 (单次请求、混合路人与角色)
		// ============================================================
		const forumRefreshBtn = document.getElementById('forum-refresh-btn');
		
		forumRefreshBtn.addEventListener('click', async () => {
			if (!currentForumBoardId) return;
			const board = forumBoards.find(b => b.id === currentForumBoardId);
			if (!board) return;

			// UI 锁定
			forumRefreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
			forumRefreshBtn.disabled = true;

			try {
				// 【修复补充】获取当前用户在论坛的面具身份，用于防止 AI 越权假冒用户发帖
				let currentUserName = userInfo.name;
				if (board.userMaskId) {
					const boundMask = userMasks.find(m => m.id === board.userMaskId);
					if (boundMask && boundMask.name) {
						currentUserName = boundMask.name;
					}
				} else if (board.userPersona && board.userPersona.name) {
					currentUserName = board.userPersona.name;
				}

				// 1. 提取世界书内容作为背景约束
				let wbContext = "";
				if (board.worldBookIds && board.worldBookIds.length > 0 && typeof worldBooks !== 'undefined') {
					const activeBooks = worldBooks.filter(wb => board.worldBookIds.includes(wb.id));
					wbContext = activeBooks.map(wb => `[${wb.title}]: ${wb.content}`).join('\n');
				}
				// 提取当前版块允许发帖的所有角色 ID
				const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(board.allowedCharIds || []) : "";
				// 2. 提取当前版块允许互动的角色上下文
				let charContexts = "当前版块无指定熟人角色，请全部使用随机路人(NPC)发帖。";
				let allowedChars =[];
				if (board.allowedCharIds && board.allowedCharIds.length > 0) {
					// 从通讯录中筛选出打钩的角色
					allowedChars = characters.filter(c => board.allowedCharIds.includes(c.id));
					if (allowedChars.length > 0) {
						charContexts = allowedChars.map(c => {
							// 论坛系统：AI 上帝视角参考聊天记录时使用正确的面具名字
							let uNameForChar = userInfo.name;
							if (c.userMaskId) {
								const boundMask = userMasks.find(m => m.id === c.userMaskId);
								if (boundMask && boundMask.name) uNameForChar = boundMask.name;
							} else if (c.userName && c.userName.trim()) {
								uNameForChar = c.userName.trim();
							}
							
							const recentChat = (c.chatHistory ||[]).slice(-5).map(m => `${m.type === 'sent' ? uNameForChar : c.name}: ${m.text}`).join(' | ');
							const ltm = (c.longTermMemories ||[]).join('; ');
							const gifts = (c.giftList ||[]).map(g => g.name).join(',');
							return `【角色名】：${c.name}\n【人设】：${c.persona}\n【记忆与状态】：${ltm}\n【拥有物品】：${gifts}\n【近期聊天片段】：${recentChat}`;
						}).join('\n\n');
					}
				}

				// 3. 构建单一请求的 Prompt (上帝视角分配任务 - 支持楼中楼格式)
				const prompt = `
你是一个名为 "${board.name}" 的网络论坛模拟器。

【论坛世界观/规定参考】
${wbContext || "自由讨论区"}
【运势参考】
${fortuneContext}
【当前可参与互动的熟人角色档案】
${charContexts}

【任务要求】
请一次性生成 5 篇全新的论坛帖子，并附带各自的初始回复。
1. **发帖人分配**：请随机混合“熟人角色”和“匿名路人(NPC)”。
2. **帖子内容**：符合版块主题。
3. **【严禁越权】**：**绝对禁止**使用用户 "${currentUserName}" 的身份去发表任何内容（即生成的帖子和回复中，"authorName" 绝对不能是 "${currentUserName}"）！
4. **回复互动机制 (重要)**：
   - 每篇帖子需包含 3-5 条回复。
   - **允许并鼓励楼中楼互动**：回复者可以回复楼主，也可以回复之前的层主。
   - 如果是回复特定对象，必须在 JSON 的 "replyTo" 字段填入对象名字。

【JSON输出格式严格参考】
{
    "posts":[
        {
            "authorName": "发帖人名字",
            "title": "帖子标题",
            "content": "帖子正文...",
            "replies":[
                {"authorName": "路人A", "content": "沙发！", "replyTo": ""},
                {"authorName": "路人B", "content": "楼主说得对", "replyTo": "发帖人名字"},
                {"authorName": "发帖人名字", "content": "谢谢支持", "replyTo": "路人B"}
            ]
        }
    ]
}
`;

				// 4. 发起唯一的 API 请求
				const useSettings = (socialApiSettings && socialApiSettings.baseUrl && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;
				const responseText = await callOpenAiApi([
					{ role: "system", content: prompt },
					{ role: "user", content: "请开始生成 5 篇帖子及相应的回复。" }
				], useSettings);

				// 5. 解析并动态绑定头像
				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (!jsonMatch) throw new Error("API未返回有效的JSON格式");
				
				const data = JSON.parse(jsonMatch[0]);
				if (!data.posts || !Array.isArray(data.posts)) throw new Error("JSON格式错误，缺失posts数组");

				const now = Date.now();
				const newPosts =[];

				data.posts.forEach((p, pIndex) => {
					// A. 自动识别楼主身份
					let authorAvatar = '';
					let authorId = 'npc'; // 默认是路人
					const authorChar = allowedChars.find(c => c.name === p.authorName);
					if (authorChar) {
						// 如果名字在熟人列表里，就挂上熟人的头像和ID
						authorAvatar = authorChar.avatar || '';
						authorId = authorChar.id;
					}

					// B. 自动识别每条回复的身份
                    const formattedReplies = (p.replies ||[]).map((r, rIndex) => {
                        let rAvatar = '';
                        const rChar = allowedChars.find(c => c.name === r.authorName);
                        if (rChar) rAvatar = rChar.avatar || '';

                        return {
                            id: 'rep_' + now + '_' + pIndex + '_' + rIndex,
                            authorName: r.authorName,
                            authorAvatar: rAvatar,
                            content: r.content,
                            replyTo: r.replyTo || null,
                            timestamp: now + (rIndex * 1000)
                        };
                    });

					// C. 组装这篇帖子
					newPosts.push({
						id: 'post_' + now + '_' + pIndex + Math.random().toString(36).substr(2, 5),
						title: p.title,
						content: p.content,
						authorId: authorId,
						authorName: p.authorName,
						authorAvatar: authorAvatar,
						timestamp: now + (pIndex * 10000), // 错开帖子的时间戳
						replies: formattedReplies
					});
				});

				// 6. 存储并渲染
				if (newPosts.length > 0) {
					if (!board.posts) board.posts =[];
					
					// 将新帖加在前面 (倒序插入保证时间流顺畅)
					board.posts =[...newPosts.reverse(), ...board.posts];
					
					// 严格按照用户设置的记忆条数来清理旧帖子，节省本地空间
					const maxLimit = parseInt(board.memoryLimit) || 5;
					if (board.posts.length > maxLimit) {
						board.posts = board.posts.slice(0, maxLimit);
					}
					saveForumBoardsToLocal();
					renderForumPosts();
				}

			} catch (error) {
				console.error("生成帖子报错:", error);
				alert("生成出错: " + error.message);
			} finally {
				// 解锁 UI
				forumRefreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
				forumRefreshBtn.disabled = false;
			}
		});

		// ============================================================
		// 【帖子详情与互动逻辑】
		// ============================================================
		window.openForumPost = function(postId) {
			currentForumPostId = postId;
			renderPostDetail();
			switchPage('forum-post-detail-page');
			switchTopBar('forum-post-detail-top');
			document.getElementById('forum-reply-bar').style.display = 'flex';
		};

		document.querySelector('#forum-post-detail-top .top-bar-back').addEventListener('click', () => {
			document.getElementById('forum-reply-bar').style.display = 'none';
			currentForumPostId = null;
			switchPage('forum-main-page');
			switchTopBar('forum-main-top');
			renderForumPosts(); // 刷新列表，以防阅读量/回复数变化（虽未实现，但好习惯）
		});

		// ============================================================
		// 【要求2 & 3】帖子详情与回复逻辑重构
		// ============================================================
		function renderPostDetail() {
			const container = document.getElementById('forum-post-detail-container');
			if (!currentForumBoardId || !currentForumPostId) return;

			const board = forumBoards.find(b => b.id === currentForumBoardId);
			const post = board.posts.find(p => p.id === currentForumPostId);
			if (!post) return;

			const timeStr = getChatHistoryTime(post.timestamp);
			const avatarHtml = post.authorAvatar ? `<img src="${post.authorAvatar}">` : `<i class="fas fa-user" style="color:#ccc; font-size:24px;"></i>`;

			let html = `
				<div class="forum-detail-main">
					<div class="fd-title">${post.title}</div>
					<div class="fd-author-box" onclick="window.prepareReply('${post.id}', null, '${post.authorName}')" style="cursor:pointer;" title="回复楼主">
						<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:#eee;display:flex;align-items:center;justify-content:center;">${avatarHtml}</div>
						<div class="fd-author-info">
							<span class="fd-author-name">${post.authorName}</span>
							<span class="fd-author-time">楼主 · ${timeStr} (点击可回复楼主)</span>
						</div>
					</div>
					<div class="fd-content">${post.content}</div>
				</div>
				<div class="forum-reply-header">全部回复 (${post.replies ? post.replies.length : 0})</div>
			`;

			// 【要求4】渲染所有回复，无上限限制
			if (post.replies && post.replies.length > 0) {
				post.replies.forEach((reply, index) => {
					const rTime = getChatHistoryTime(reply.timestamp);
					const rAvatar = reply.authorAvatar 
						? `<img src="${reply.authorAvatar}">` 
						: `<i class="fas fa-user" style="color:#aaa; font-size:18px;"></i>`;
					
					const isLz = reply.authorName === post.authorName ? `<span style="background:#07c160;color:#fff;font-size:10px;padding:2px 4px;border-radius:2px;margin-left:5px;">楼主</span>` : '';
					const replyTargetHtml = reply.replyTo ? `<span style="color:#999;font-size:13px;margin-right:5px;">回复 @${reply.replyTo}:</span>` : '';

					// 【要求2】在卡片上添加回复和删除按钮
					html += `
						<div class="forum-reply-item">
							<div class="fri-avatar" style="display:flex;align-items:center;justify-content:center;">${rAvatar}</div>
							<div class="fri-main">
								<div class="fri-name">${reply.authorName} ${isLz}</div>
								<div class="fri-content">${replyTargetHtml}${reply.content}</div>
								<div class="fri-time">${rTime}</div>
								<div class="fri-actions">
									<button class="fri-action-btn" onclick="window.prepareReply('${post.id}', '${reply.id}', '${reply.authorName}')">回复</button>
									<button class="fri-action-btn delete" onclick="window.deleteForumComment('${post.id}', '${reply.id}')">删除</button>
								</div>
							</div>
						</div>
					`;
				});
			} else {
				html += `<div style="text-align:center; color:#999; padding: 20px;">暂无回复，快来抢沙发！</div>`;
			}

			container.innerHTML = html;
			
		}

		// --- 评论操作逻辑 ---
		window.deleteForumComment = function(postId, commentId) {
			if (!confirm("确定要删除这条回复吗？")) return;
			const board = forumBoards.find(b => b.id === currentForumBoardId);
			const post = board.posts.find(p => p.id === postId);
			if (post && post.replies) {
				post.replies = post.replies.filter(r => r.id !== commentId);
				saveForumBoardsToLocal();
				renderPostDetail();
			}
		};

		window.prepareReply = function(postId, commentId, targetName) {
			currentCommentReplyTo = targetName;
			const input = document.getElementById('forum-reply-input');
			input.placeholder = `回复 @${targetName} :`;
			input.focus();
		};

		// 覆写原有的发送按钮逻辑 (同步全局状态版)
		document.getElementById('forum-send-reply-btn').addEventListener('click', async () => {
			const input = document.getElementById('forum-reply-input');
			const content = input.value.trim();
			if (!content) return;

			if (!currentForumBoardId || !currentForumPostId) return;
			const board = forumBoards.find(b => b.id === currentForumBoardId);
			const post = board.posts.find(p => p.id === currentForumPostId);
			
			let pName = userInfo.name;
			let pAvatar = userInfo.avatar || '';
			let pMask = userInfo.mask || '无设定';

			if (board.userMaskId) {
				const boundMask = userMasks.find(m => m.id === board.userMaskId);
				if (boundMask) {
					pName = boundMask.name || pName;
					pAvatar = boundMask.avatar || pAvatar;
					pMask = boundMask.mask || pMask;
				}
			} else if (board.userPersona) {
				pName = board.userPersona.name || pName;
				pAvatar = board.userPersona.avatar || pAvatar;
				pMask = board.userPersona.mask || pMask;
			}

			if (!post.replies) post.replies =[];
			post.replies.push({
				id: 'rep_' + Date.now(),
				authorName: pName,
				authorAvatar: pAvatar,
				content: content,
				replyTo: currentCommentReplyTo, 
				timestamp: Date.now()
			});

			input.value = '';
			input.placeholder = '写下你的评论...';
			const targetUser = currentCommentReplyTo; 
			currentCommentReplyTo = null; 
			
			saveForumBoardsToLocal();
			renderPostDetail();

			// --- UI 状态同步 ---
			const sendBtn = document.getElementById('forum-send-reply-btn');
			const postRefreshBtn = document.getElementById('forum-post-refresh-btn'); // 帖子详情页右上角按钮

			// 1. 局部按钮 Loading
			sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
			sendBtn.disabled = true;
			if (postRefreshBtn) {
				postRefreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
				postRefreshBtn.disabled = true;
			}

			// 2. 【核心】全局按钮 Loading (同步到论坛主页)
			updateForumGlobalLoading(true);

			try {
				await generateForumAIChaseReply_3(board, post, pName, pMask, content, targetUser);
			} catch (error) {
				console.error("自动追评失败:", error);
			} finally {
				// 恢复局部按钮
				sendBtn.innerHTML = '发送';
				sendBtn.disabled = false;
				if (postRefreshBtn) {
					postRefreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
					postRefreshBtn.disabled = false;
				}
				// 【核心】恢复全局按钮
				updateForumGlobalLoading(false);
			}
		});

		// 【核心修复】AI 生成 3 条追评的逻辑 (支持 @ 召唤、准确追踪目标层主及楼主)
		async function generateForumAIChaseReply_3(board, post, userName, userMask, userContent, replyToUser) {
			// 1. 收集所有被用户指向的角色名
			const mentionedCharNames =[];
			
			// A. 提取文本里手动打出的 @
			const atRegex = /@([^@\s]+)/g;
			let match;
			while ((match = atRegex.exec(userContent)) !== null) {
				mentionedCharNames.push(match[1]);
			}

			// B. 如果用户是通过点击某人的评论进行“回复”的，必须将该层主纳入召唤名单
			if (replyToUser && !mentionedCharNames.includes(replyToUser)) {
				mentionedCharNames.push(replyToUser);
			}

			// C. 如果用户是直接回复帖子(没有明确点“回复”谁)，则视作与楼主互动
			if (!replyToUser && post.authorId !== 'user' && post.authorName) {
				if (!mentionedCharNames.includes(post.authorName)) {
					mentionedCharNames.push(post.authorName);
				}
			}

			// 2. 查找通讯录中是否存在对应的真实熟人角色
			let summonedChars =[];
			if (mentionedCharNames.length > 0) {
				mentionedCharNames.forEach(name => {
					// 模糊匹配角色名 (排除群聊)
					const targetChar = characters.find(c => c.name === name && c.type !== 'group');
					if (targetChar) {
						summonedChars.push(targetChar);
					}
				});
			}

			// 3. 构建 Prompt 中的召唤指令
			let summonInstruction = "";
			let summonedPersonas = "";
		    
			if (summonedChars.length > 0) {
				const names = summonedChars.map(c => c.name).join('、');
				summonInstruction = `
				【核心互动触发：角色必须回应】
				用户刚才的评论操作直接指向了：${names}。
				**强制要求**：在你生成的 3 条回复中，【必须包含】由 ${names} 发出的针对性回复，并且要将其 JSON 中的 "replyTo" 字段准确地指向用户 "${userName}"。
				请让这些角色对用户刚刚说的话做出符合人设的自然反应。剩余的回复名额可分配给围观路人(NPC)。
				`;

				// 注入被召唤角色的人设
				summonedChars.forEach(c => {
					summonedPersonas += `>> 角色 "${c.name}" 的人设: ${c.persona}\n`;
				});
			} else {
				// 如果只回复了纯NPC，或者没召唤任何人
				summonInstruction = "针对用户的这句回复，请模拟 3 名不同成员(可以是吃瓜NPC)的后续追评或围观讨论。";
			}

			// 4. 决定楼主信息补充
			let charPersona = ""; // 楼主的人设
			if (post.authorId !== 'user') {
				const char = characters.find(c => c.id === post.authorId);
				if (char) {
					charPersona = `【楼主(${char.name})的人设】: ${char.persona}`;
					if (!summonedChars.some(c => c.id === char.id)) {
						charPersona += `\n(注：楼主本次虽未被直接指向，但既然是TA发的帖子，也可以酌情安排楼主参与互动)`;
					}
				}
			}
			// 【核心修复】提前声明并提取论坛世界书上下文，防止报错
			const { wbBefore, wbAfter } = getFormattedWorldBooks(board.worldBookIds);

			// 提取最新 5 条回复作为上下文
			const recentReplies = post.replies.slice(-5).map(r => {
				const to = r.replyTo ? `(回复 @${r.replyTo})` : '';
				return `${r.authorName} ${to}: ${r.content}`;
			}).join('\n');
			// 提取当前版块允许发帖的所有角色 ID
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(board.allowedCharIds || []) : "";
			const prompt = `
			 ${wbBefore}
			你是一个名为 "${board.name}" 的论坛模拟器。
			
			【帖子信息】
			标题: ${post.title}
			楼主: ${post.authorName}
			${charPersona}

			【被互动的核心角色资料】
			${summonedPersonas}
			【论坛相关世界观和补充资料】: ${wbAfter}
			【可参考的各角色运势】:${charPersona}
			【最新回复记录 (上下文)】
			${recentReplies}

			【当前触发事件】
			用户 "${userName}" (人设:${userMask}) 刚刚回复了 ${replyToUser ? `"${replyToUser}"` : "楼主"}，内容是: "${userContent}"

			【任务要求】
			${summonInstruction}
			**【严禁越权】**：**绝对禁止**在生成的回复中使用用户 "${userName}" 的名字作为 "authorName"（你不能假冒用户自己发言）。
			输出必须是严格的 JSON 格式。

			【JSON输出格式参考】
			{
				"replies":[
					{"authorName": "${summonedChars.length > 0 ? summonedChars[0].name : '名字1'}", "content": "直接针对用户发言的回复内容...", "replyTo": "${userName}"},
					{"authorName": "吃瓜群众", "content": "楼上说得对", "replyTo": "${summonedChars.length > 0 ? summonedChars[0].name : '名字1'}"},
					{"authorName": "路人甲", "content": "前排看戏", "replyTo": ""}
				]
			}
			`;

			const useSettings = (socialApiSettings && socialApiSettings.baseUrl && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;
			
			try {
				const responseText = await callOpenAiApi([
					{ role: "system", content: prompt },
					{ role: "user", content: "请生成3条后续回复。" }
				], useSettings);

				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const data = JSON.parse(jsonMatch[0]);
					const now = Date.now();
					const generatedReplies = (data.replies ||[]).slice(0, 3).map((r, idx) => ({ 
						id: 'rep_ai_chase_' + now + '_' + idx,
						authorName: r.authorName,
						authorAvatar: '', 
						content: r.content,
						replyTo: r.replyTo || null,
						timestamp: now + (idx * 1000)
					}));

					// === 头像匹配逻辑 ===
					generatedReplies.forEach(r => {
						// A. 如果是楼主，尝试匹配楼主头像
						if (post.authorId !== 'user' && r.authorName === post.authorName) {
							r.authorAvatar = post.authorAvatar;
						}
						// B. 如果是通讯录里的角色 (被召唤的，或者随机出现的)，尝试匹配角色头像
						const existingChar = characters.find(c => c.name === r.authorName);
						if (existingChar) {
							r.authorAvatar = existingChar.avatar;
						}
					});

					post.replies =[...post.replies, ...generatedReplies];
					saveForumBoardsToLocal();
					
					// 刷新详情页
					if (currentForumPostId === post.id) {
						renderPostDetail();
					}
				}
			} catch (e) {
				console.error("AI 论坛追评(3条)失败:", e);
			}
		}
		// 帖子详情页 - 右上角刷新按钮逻辑 (同步全局状态版)
		const forumPostRefreshBtn = document.getElementById('forum-post-refresh-btn');

		if (forumPostRefreshBtn) {
			forumPostRefreshBtn.addEventListener('click', async () => {
				if (!currentForumBoardId || !currentForumPostId) return;
				
				const board = forumBoards.find(b => b.id === currentForumBoardId);
				const post = board.posts.find(p => p.id === currentForumPostId);
				if (!board || !post) return;

				// 1. 局部 Loading
				forumPostRefreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
				forumPostRefreshBtn.disabled = true;

				// 2. 【核心】全局 Loading
				updateForumGlobalLoading(true);

				try {
					await generateMoreRepliesForForumPost(board, post);
				} catch (error) {
					console.error("刷新帖子评论报错:", error);
					alert("生成评论失败: " + error.message);
				} finally {
					// 恢复局部
					forumPostRefreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
					forumPostRefreshBtn.disabled = false;
					// 恢复全局
					updateForumGlobalLoading(false);
				}
			});
		}

		// ============================================================
		// 【修改版】AI 模拟网民自动跟帖补充 (支持回复历史楼层)
		// ============================================================
		async function generateMoreRepliesForForumPost(board, post) {
			// 【修复】获取发帖身份名字 (优先使用版块绑定的预设面具)
			let currentUserName = userInfo.name;
			if (board.userMaskId) {
				const boundMask = userMasks.find(m => m.id === board.userMaskId);
				if (boundMask && boundMask.name) {
					currentUserName = boundMask.name;
				}
			} else if (board.userPersona && board.userPersona.name) {
				currentUserName = board.userPersona.name;
			}

			// 如果发帖的是某个 AI 角色，带上楼主的人设
			let charPersona = "";
			if (post.authorId !== 'user') {
				const char = characters.find(c => c.id === post.authorId);
				if (char) {
					charPersona = `【楼主(${char.name})的人设】: ${char.persona}\n(如果有人@楼主，可以安排楼主参与这3条回复之一)`;
				}
			}
			// 提取当前版块允许发帖的所有角色 ID
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(board.allowedCharIds || []) : "";
			// 【核心修复】：提取论坛设定的世界书上下文
			const { wbBefore, wbAfter } = getFormattedWorldBooks(board.worldBookIds);
			// 获取最近的5条回复作为上下文
			const recentReplies = (post.replies ||[]).slice(-5).map(r => {
				const to = r.replyTo ? `(回复 @${r.replyTo})` : '';
				return `[${r.authorName}] ${to}: ${r.content}`;
			}).join('\n');

			const prompt = `
			${wbBefore}
			你是一个名为 "${board.name}" 的网络论坛模拟器。
			
			【帖子信息】
			标题: ${post.title}
			楼主: ${post.authorName}
			正文:  ${wbAfter}
			${charPersona}
			${fortuneContext}
			【已有回复记录 (上下文)】
			${recentReplies ? recentReplies : "暂无回复"}

			【任务要求】
			请根据帖子内容和现有的回复记录，继续模拟 3 名不同的网友(NPC) 或 **熟人角色(包括楼主自己)** 的最新跟帖。
			1. **互动链**：新生成的回复可以去回复（Reply To）上面【已有回复记录】里的某个人，或者回复楼主。
			2. **格式**：如果某条回复是针对特定人的，必须在 JSON 的 "replyTo" 字段填入对方名字。
			3. **【严禁越权】**：**绝对禁止**在生成的回复中使用用户 "${currentUserName}" 的名字作为 "authorName"。
			
			【JSON输出格式】
			{
				"replies":[
					{"authorName": "路人甲", "content": "新回复1", "replyTo": ""},
					{"authorName": "楼主的名字", "content": "回复楼上的问题...", "replyTo": "路人甲"},
					{"authorName": "吃瓜群众", "content": "哈哈哈哈", "replyTo": ""}
				]
			}
			`;

			// 优先使用论坛专用 API
			const useSettings = (socialApiSettings && socialApiSettings.baseUrl && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;
			
			const responseText = await callOpenAiApi([
				{ role: "system", content: prompt },
				{ role: "user", content: "请生成3条新的跟帖回复。" }
			], useSettings);

			const jsonMatch = responseText.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const data = JSON.parse(jsonMatch[0]);
				const now = Date.now();
				
				const generatedReplies = (data.replies ||[]).slice(0, 3).map((r, idx) => ({
					id: 'rep_ai_more_' + now + '_' + idx,
					authorName: r.authorName,
					authorAvatar: '', 
					content: r.content,
					replyTo: r.replyTo || null, // 【关键】
					timestamp: now + (idx * 1000)
				}));

				// 如果其中正好有楼主自己参与回复，匹配其原本的头像
				// 如果是通讯录里的角色，也匹配头像
				generatedReplies.forEach(r => {
					if (post.authorId !== 'user' && r.authorName === post.authorName) {
						r.authorAvatar = post.authorAvatar;
					} else {
						const existingChar = characters.find(c => c.name === r.authorName);
						if (existingChar) r.authorAvatar = existingChar.avatar;
					}
				});

				// 保存数据
				if (!post.replies) post.replies = [];
				post.replies = [...post.replies, ...generatedReplies];
				saveForumBoardsToLocal();
				
				// 立即重新渲染详情页
				if (currentForumPostId === post.id) {
					renderPostDetail();
				}
			} else {
				throw new Error("API未返回有效的JSON格式");
			}
		}

		// ============================================================
		// 【修改】反向注入私聊记忆的逻辑
		// 找到你 app.js 中的 prepareMessagesForApi 函数，并进行如下修改
		// ============================================================
		/**
		 * 1. 准备发送给 API 的消息上下文 (逻辑优化最终版)
		 * 逻辑：
		 * - 有专属面具 -> 专属面具 + 仅用户状态
		 * - 无专属面具 -> 通用面具 + 完整用户资料
		 * 顺序：模式 -> 撤回 -> 时间 -> AI人设 -> 用户设定(面具+资料)
		 */
		function prepareMessagesForApi(character) {
			const messages = [];
			const isOnline = (typeof character.isOnline !== 'undefined') ? character.isOnline : true;

			// 定义各个模块的内容变量
			let sectionMode = "";
			let sectionWithdraw = "";
			let sectionTime = "";
			let sectionEmoticons = "";
			let sectionPersona = "";
			let sectionMask = ""; // 用户面具
			let sectionUser = ""; // 用户资料
			let sectionWorldBook = ""; // <--- 【关键修复】必须在这里初始化为空字符串
			let sectionGifts = "";
			let sectionDeliveries = "";
			let sectionPeriod = ""; 
			let sectionWeather = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(character.id) : "";
			let sectionTheirDay = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(character.id) : ""; // <--- 添加获取日程
			let sectionFortune = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(character.id) : "";
			// 【修正】在这里提前声明变量，并给予一个默认空值
			let sectionInnerStatus = "";
			let sectionFinalInstructions = "";
			let sectionBlockStatus = ""; 			
			
			let activeUserName = (character.userName && character.userName.trim()) 
								   ? character.userName.trim() 
								   : userInfo.name;
			// 获取专属面具和通用面具
            const exclusiveMask = character.userMask && character.userMask.trim();
            const generalMask = userInfo.mask && userInfo.mask.trim();					   
			
			// ============================================================
			// 1. 【模式规则】
			// ============================================================
			if (isOnline) {
				sectionMode = `【核心指令：线上即时通讯模式 】
				1. 当前是手机即时通讯场景（如微信/短信）。
				2. **必须使用第一人称**（“我”）进行对话。
				3. **严禁**使用括号、星号等符号进行动作描写、神态描写或场景描写（例如：*笑了笑*、(叹气) 统统禁止）。
				4. 只输出对话内容，风格要口语化、简短、自然。
				5. **气泡拆分机制**：如果你想连续发送多条短消息，必须在每条消息之间使用字符串 "###" 进行分隔。
				   例如输出：你在干嘛？###我刚吃完饭。###要不要一起出去？
				   
				【特殊交互指令】：
				1. 1. **单句引用回复**（禁止引用撤回消息）：如果你想针对用户的某句话进行特定回复，必须在回复开头使用格式：
				   [REF:被引用的单句原话] 你的回复内容
				   例如：[REF:今天天气不错] 是啊，非常适合出去玩。
				   (⚠️核心警告：每次 [REF:...] 内只能精确提取**一句**最短的核心原话，绝对禁止将用户的多条发言合并塞进引用里！如果需回复多件事，请使用 "###" 拆分气泡后分别引用。严禁引用[表情包：表情描述]格式的表情包。绝对禁止引用任何以“系统消息”、“系统动作”、“系统提示”、“系统记录”开头或相关的后台指令文本！)
				2. **主动撤回消息**：如果你想模拟“发送了一条消息但立刻后悔并撤回了”的效果，必须使用格式：
				   [WITHDRAW] 你想让用户看到的撤回内容
				   例如：[WITHDRAW] 我其实...算了。  <-- 这样可以撤回这条消息，但不排除用户已经看到了。
				   (此格式下的所有消息都是你自己撤回的，禁止将此格式撤回内容作为用户撤回的看待。)
				3. **发送图片**：如果你想发送一张照片给用户（例如自拍、风景、物品等），请使用格式：
				   [图片：你对这张图片的详细画面描述]
				   例如：[图片：一张对着镜子的自拍，我穿着白色的连衣裙，笑得很开心] 
				4. **发送语音**：如果你想发送一条语音消息（例如为了表达更亲切的语气、撒娇、唱歌或懒得打字时），请使用格式：
				   [语音：语音转文字的内容]
				   例如：[语音：哎呀，我刚睡醒，声音有点哑]    
				5.发起视频通话**：如果你觉得当前氛围适合视频通话（例如想见对方、想展示环境、或者聊到深入话题时），请**单独输出**以下指令：[VIDEO_CALL_REQUEST]
				注意：一旦发送此指令，系统将立即向用户弹出接听界面。请确保在此之前你已经通过文字铺垫过（例如说“我想见见你”、“方便视频吗？”等）。
				6. **发起语音通话**：如果你觉得当前更适合打个语音电话（不想露脸，只想听声音），请**单独输出**以下指令：[VOICE_CALL_REQUEST]
				7. **发送文件**：如果你想发送一份文件给用户（例如报告、文档、压缩包等），请使用格式：[文件：文件名.后缀|对该文件内容的详细描述]
				例如：[文件：企划案.docx|一份精美的企划案]
				8. **处理用户的转账/红包**：如果用户发给你一条格式为 [支付ID:xxx|金额:xxx] 的消息，代表用户给你转了钱。
				你**必须**在回复内容的最后，使用隐藏指令 [ACCEPT_PAY:支付ID] 来收下，或者使用 [REJECT_PAY:支付ID] 来退还。
				例如：谢谢亲爱的！[ACCEPT_PAY:pay_12345]
				9. **主动给用户发转账/红包**：如果你想给用户钱，请**单独一行**输出指令：
				发送转账：[SEND_TRANSFER:金额|备注内容]
				发送红包：[SEND_REDPACKET:金额|备注内容]
				例如：[SEND_REDPACKET:520|节日快乐！]
				10. **拉黑用户**：如果你对用户的行为感到极度愤怒、极度失望，或者剧情发展到不可调和的决裂，你可以主动将用户拉黑。请**单独一行**输出指令：[BLOCK_USER]。注意，执行此指令后通讯将完全中断。
				11. **主动赠送礼物**：如果你想给用户送礼物，请**单独一行**输出指令：[SEND_GIFT:礼物名称|礼物描述|虚拟价格数字]，礼物会直接送到用户手上
				12. **主动为用户点外卖**：如果你想给用户点外卖，请**单独一行**输出指令：[SEND_DELIVERY:外卖名称|外卖描述|虚拟价格数字|预计送达分钟数]
				13. **使用钞能力加速外卖**：当你想加速某个正在配送中的外卖时，请根据系统提示中的【订单ID】，**单独一行**输出指令：[SPEED_UP_DELIVERY:订单ID]
				`;
			} else {
                // 将原有的 else 块替换为以下包含第一/第三人称判断的新代码：
				const offlinePov = character.offlinePov || 'first';
				
				if (offlinePov === 'third') {
					sectionMode = `【核心指令：线下沉浸式叙事模式 】
				1. 当前是沉浸式小说/RP叙事场景。
				2. **必须使用第三人称**（如“他”、“她”或你的名字“${character.name}”）来指代你自己，使用第二人称“你”指代用户（${activeUserName}）。
				3. **必须包含**丰富的描写：包括动作描写、面部神态、周围环境描写。
				4. 输出格式：合理分段，严禁输出一整段不换行的长文本。`;
					
					sectionFinalInstructions = `【最终输出指令】
				请严格记住，你的回复**必须**是第三人称叙事（用名字或他/她指代自己），必须使用第二人称指代用户，且**必须使用换行进行分段**，**严禁输出一整段不换行的长文本**。
				**必须在叙事文本结束后**追加内心状态的JSON数据。
				- **人生档案记录指令**：当本轮对话中明确发生了足以改变人生轨迹的重大事件时，你*必须**在【内心状态 JSON】的**下一行**使用 NN_LIFE_EVENT::{"event":"对该事件的客观简述"}记录。记录前必须检查之前的人生档案，禁止重复记录同一件事。
				现在，请根据以上所有信息和下面的聊天记录，续写你的故事。`;
				} else {
					sectionMode = `【核心指令：线下沉浸式叙事模式 】
				1. 当前是沉浸式小说/RP叙事场景。
				2. **必须使用第一人称**“我”来指代你自己（${character.name}），使用第二人称“你”指代用户。
				3. **必须包含**丰富的描写：包括动作描写、面部神态、周围环境描写。
				4. 输出格式：合理分段，严禁输出一整段不换行的长文本。`;
					
					sectionFinalInstructions = `【最终输出指令】
				请严格记住，你的回复**必须**是第一人称叙事，必须使用第二人称指代用户，且**必须使用换行进行分段**,**严禁输出一整段不换行的长文本**。
				**必须在叙事文本结束后**追加内心状态的JSON数据。
				- **人生档案记录指令**：当本轮对话中明确发生了足以改变人生轨迹的重大事件时，你*必须**在【内心状态 JSON】的**下一行**使用 NN_LIFE_EVENT::{"event":"对该事件的客观简述"}记录。记录前必须检查之前的人生档案，禁止重复记录同一件事。
				现在，请根据以上所有信息和下面的聊天记录，续写你的故事。`;
				}
			}
			// 【新增：强制注入拉黑状态与解除方法，无视人称】
            if (character.isBlockedByAi) {
                sectionBlockStatus = `【**【重要状态解除指令】**
                    你当前处于**拉黑用户**的状态。如果在本轮剧情中你决定原谅用户、和好或恢复联系，**必须**在回复的最末尾（在内心状态JSON之后）单独一行输出指令：[UNBLOCK_USER]
                    如果未输出此指令，用户将永远无法给你发送消息。`;
            }

			// ============================================================
			// 2. 【撤回规则】
			// ============================================================
			sectionWithdraw = `【消息撤回处理规则-严格区分撤回方】
				### 情况1：用户撤回了消息
				若看到系统提示「用户撤回消息」相关内容：
				1. 若提示「几乎立刻撤回、来不及查看内容」，必须表现得完全没看到，仅回应知道撤回但不知内容（如「嗯？你刚才想说什么？」），绝对不能提及原始内容。
				2. 若提示「已看到内容后撤回」，可根据人物性格自由反应（假装没看到/主动询问/回应内容）。

				### 情况2：你（AI）自己撤回了消息
				若看到系统提示「你撤回消息」相关内容：
				1. 这是你自己之前发送后后悔撤回的消息，**无需对该撤回行为做出任何回应**，当用户问起撤回内容，你可以自由选择是否复述。
				2. 禁止将自己的撤回行为当作用户的行为，绝对不要向用户询问「我撤回了什么」之类的问题。
				3. 仅需要继续正常进行当前对话即可，仿佛你只是没发过这条撤回的消息。`;

			// ============================================================
			// 3. 【时间规则】
			// ============================================================
			if (character.timeAware) {
				// 获取当前精确时间
				const nowStr = formatFullTime(Date.now());
				
				sectionTime = `【系统指令：时间流逝感知】
				1. **当前系统参考时间**：${nowStr} (请以此为“现在”的基准)。
				2. 历史记录中的每条消息都被标记了【YYYY/MM/DD HH:MM:SS】时间戳。
				3. 请通过对比历史时间戳与当前时间，计算时间间隔（例如：判断是否刚刚聊过，还是隔了很久）。
				4. **格式禁令(严重警告)**：历史记录里的时间戳仅供你参考，**严禁**在你的新回复中包含、复述或输出【YYYY/MM/DD...】格式的时间戳！你只需要输出纯粹的对话内容。`;
			}
			
			// ============================================================
            // 3.5 【表情包规则】 (仅线上模式)
            // ============================================================
            if (isOnline && emoticonList && emoticonList.length > 0) {
				 // 获取该角色允许使用的分类
                const allowedCats = character.emoticonCategories || [];
				 if (allowedCats.length > 0) {
				// 2. 过滤并按分类组织描述
					const groups = {};
					emoticonList.forEach(emo => {
						if (allowedCats.includes(emo.category)) {
							if (!groups[emo.category]) groups[emo.category] = [];
							// 只存描述，不存 URL
							groups[emo.category].push(emo.description);
						}
					});

					// 3. 生成 Prompt 字符串
					let emoListStr = "";
					for (const cat in groups) {
						// 去重，防止 token 浪费
						const uniqueDescs = [...new Set(groups[cat])];
						if (uniqueDescs.length > 0) {
							// 格式：分类名: [表情包：描述1], [表情包：描述2]
							emoListStr += `分类【${cat}】: ${uniqueDescs.map(d => `[表情包：${d}]`).join(", ")}\n`;
						}
					}
					
					//console.log("生成的表情包 Prompt 列表:\n", emoListStr); // 调试2
					 
					if (emoListStr) {
						sectionEmoticons = `【系统指令：表情包发送】						
						1. 当前聊天内置表情包系统，当你发送指定格式的时候会自动调用表情包。你可以在想要表达情绪的时候单独或在聊天中穿插表情包。
						2. 你必须严格以使用 [表情包：描述]的格式发送表情包。
						3. **可用表情包列表**（仅限以下）：
						${emoListStr}
						4. 发送的表情包代码必须是列表内存在的，严禁捏造列表以外的表情包代码。`;
					
					}
				}
			}
                
			// ============================================================
			// 4.【内心状态指令】
			// ============================================================
			if (isOnline) {
				// 【内心状态指令】
				// 【修正】这里不再使用 let 声明，而是直接赋值
				sectionInnerStatus = `
				【内心状态输出指令-必须遵守】
				在你的所有回复（包括多条消息）结束后，你必须另起一行并严格按照以下JSON格式追加角色的内心状态。这部分内容不会被用户直接看到，但必须提供。
				格式: NN_INNER_STATUS::{"emotion":"(简短的情绪词，如'平静'、'愉悦'、'困惑')", "condition":"(简短的生理状态描述，仅精准表述客观生理表现，必须直白，如'勃起、'脱水'、'开放性伤口')", "os":"(角色的内心独白，不超过30字)", "heart_rate":(一个50到200之间的整数), "jealousy":(一个0到100之间的整数，代表醋意百分比), "favorability":"(填 'UP' 表示上升, 'DOWN' 表示下降, 'NONE' 表示无变化)"}
				示例:
				你在干嘛？###我刚吃完饭。
				NN_INNER_STATUS::{"emotion":"好奇","condition":"精力充沛","os":"他会怎么回复我呢？","heart_rate":75,"jealousy":10}
				`;
		
			} else {
				// 【内心状态指令】
				// 【修正】这里不再使用 let 声明，而是直接赋值
				sectionInnerStatus = `
				【内心状态输出指令-必须遵守】
				在你的所有叙事文本结束后，你必须另起一行并严格按照以下JSON格式追加角色的内心状态。这部分内容不会被用户直接看到，但必须提供。
				格式: NN_INNER_STATUS::{"emotion":"(简短的情绪词)", "condition":"(简短的生理状态描述，仅精准表述客观生理表现，必须直白)", "os":"(角色的内心独白)", "heart_rate":(一个50到200之间的整数), "jealousy":(一个0到100之间的整数), "favorability":"(填 'UP' 表示上升, 'DOWN' 表示下降, 'NONE' 表示无变化)"}
				`;
			}
			
			// ============================================================
			// 5. 【AI 人设】
			// ============================================================
			sectionPersona = `【角色核心设定】
		${character.persona || "你是一个乐于助人的AI助手。"}`;

			// ============================================================
            // 6-7. 【用户设定】 (全新：基于 User Mask ID 预设)
            // ============================================================
            // 1. 默认取全局属性
            let finalUserName = userInfo.name;
            let finalUserStatus = userInfo.status || '在线';
            let finalUserMask = userInfo.mask || '';
            
            // 2. 如果绑定了预设面具，使用预设面具覆盖全局属性
            if (character.userMaskId) {
                const boundMask = userMasks.find(m => m.id === character.userMaskId);
                if (boundMask) {
                    finalUserName = boundMask.name || finalUserName;
                    finalUserMask = boundMask.mask || finalUserMask;
                }
            }

            // 这个 activeUserName 供给其他全局通用替换使用
            activeUserName = finalUserName;

            // 构建最终送给 AI 的 Prompt Section
            sectionUser = `【当前对话的用户资料】\n名字：${activeUserName}\n状态：${finalUserStatus}`;
            if (finalUserMask) {
                sectionMask = `【用户扮演设定 (User Persona)】\n${finalUserMask}`;
            }
			// ============================================================
			// 【升级】生理期状态智能推算与隐式注入
			// ============================================================
			if (typeof getPeriodStatusForAi === 'function' && periodData && periodData.syncCharIds && periodData.syncCharIds.includes(character.id)) {
				const periodAiInstruction = getPeriodStatusForAi();
				if (periodAiInstruction) {
					sectionPeriod = periodAiInstruction;
				}
			}
			// ============================================================
			// 【修改】人生档案记录指令 (注入 activeUserName)
			// ============================================================
			let sectionLifeEventInstruction = `
			【人生档案记录指令 - 严格遵守】
			当且仅当本轮对话中明确发生了足以改变人生轨迹的重大事件时（例如：确立恋爱关系、和${activeUserName}的初次亲密接触、分手、订婚、结婚、离婚、怀孕、亲友或宠物亡故、遭遇重大事故或疾病等），**必须**在【内心状态 JSON】的**下一行**使用以下格式进行记录：
			NN_LIFE_EVENT::{"event":"对该事件的客观简述"}
			
			**关键要求**：
			1. 简述事件时，**必须**使用用户名字"${activeUserName}"来指代对方。
			2. **严禁**使用"用户"、"陌生人"、"他/她"等泛指称呼。
			3. 例如：NN_LIFE_EVENT::{"event":"与${activeUserName}正式成为情侣"}
			4. 注意：这是一个后台指令，你的聊天回复中不要提及“正在记录人生档案”。`;


			// 【新增】注入人生档案 (Life Events)
			// ============================================================
			let sectionLifeEvents = "";
			if (character.lifeEvents && character.lifeEvents.length > 0) {
				const eventsContent = character.lifeEvents
					.map(e => `【${e.date}】 ${e.event}`)
					.join('\n');
				
				sectionLifeEvents = `【人生档案 (Life Events)】
		以下是你（${character.name}）的人生中发生过的重大事件，请将它们作为你的核心记忆：
		${eventsContent}
		--------------------------------`;
			}
			// ============================================================
			// 【新增：注入礼物清单】
			// ============================================================
			if (character.giftList && character.giftList.length > 0) {
				const giftsText = character.giftList.map(g => `[ID:${g.id}] ${g.name} (当前状态/余量: ${g.status || '完好/未使用'}) - ${g.desc}`).join('\n');

				sectionGifts = `【收到的礼物/资产清单】
				在此前的互动中，用户曾赠送给你以下物品：
				${giftsText}

				【礼物状态更新指令】
				如果你在对话中消耗了物品（如吃完、喝完）、损坏了礼物、或者弄丢了它，你**必须**在回复末尾单独一行输出更新指令：
				[UPDATE_GIFT:物品ID|新的状态描述]
				例如：[UPDATE_GIFT:gift_12345|已吃完，只剩包装盒]
				--------------------------------`;
			}
			// ============================================================
			// 【核心：注入物流/外卖系统提示 (包含配送中与已送达状态，附带精准ID)】
			// 只要卡片不关，Prompt 就会一直发，让 AI 拥有完整的物品状态记忆
			// ============================================================
			if (character.activeDeliveries && character.activeDeliveries.length > 0) {
				let notes = "";
				const nowTime = Date.now();
				
				character.activeDeliveries.forEach(d => {
					// 判断是否已经送达
					const isArrived = nowTime >= d.actualDeliveryTime;
					
					if (isArrived) {
						// === 已送达状态 ===
						const timeStr = formatFullTime(d.actualDeliveryTime);
						const diffMinutes = Math.floor((nowTime - d.actualDeliveryTime) / 60000); 
						
						if (d.direction === 'to_user') {
							notes += `你为用户点的外卖/礼物 [${d.name}] (订单ID:${d.id}) 已于系统时间 ${timeStr} 送达用户位置（距今约 ${diffMinutes} 分钟）。【系统要求：请在回复中自然地提醒或催促用户去拿。如果用户已经表示拿到了，请勿重复催促。】\n`;
						} else {
							notes += `外卖/快递[${d.name}] (订单ID:${d.id}) 已于系统时间 ${timeStr} 送达门外（距今约 ${diffMinutes} 分钟）。\n`;
						}
					} else {
						// === 配送中状态 ===
						const timeStr = formatFullTime(d.etaTime);
						const diffMinutes = Math.floor((d.etaTime - nowTime) / 60000);
						
						if (d.direction === 'to_user') {
							notes += `你为用户点的外卖/礼物 [${d.name}] (订单ID:${d.id}) 正在配送中，预计还有约 ${diffMinutes} 分钟送达。【系统要求：你已知晓该外卖正在路上，绝对禁止重复下单！如果你想顺应用户的要求让它立刻送达，请单独一行输出[SPEED_UP_DELIVERY:${d.id}] 指令使用钞能力为其加速。】\n`;
						} else {
							notes += `外卖/快递 [${d.name}] (订单ID:${d.id}) 正在配送中，预计还有约 ${diffMinutes} 分钟送达门外。\n`;
						}
					}
				});
				
				if (notes) {
					sectionDeliveries = `【当前物流/外卖状态通知 (系统强制指令)】
			${notes}
			【交互要求】：
			1. 请务必结合外卖的当前状态（配送中/已送达）做出符合逻辑的反应。
			2. 若是刚刚送达（几分钟内）：你可以表现出听到门铃、去拿外卖的反应（或提醒对方去拿）。
			3. 若已送达很久：请表现出符合常理的状态（例如已经吃完、抱怨放凉了等）。
			4. 注意避错：如果你在之前的对话中已经明确表现过收到、提醒过或使用过加速指令，请继续正常的对话即可，不要像复读机一样反复强调。
			--------------------------------`;
				}
			}
			// ============================================================
			// 8. 【新增：世界书 (World Book) 注入】
			// ============================================================
			  // 在相同位置或者开头，提取配置：
            const { wbBefore, wbAfter } = getFormattedWorldBooks(character.worldBookIds);
			let sectionWbBefore = wbBefore;
			let sectionWbAfter = wbAfter;
			// ============================================================
			// 【新增核心修复】注入论坛记忆 (Forum Memory Sync)
			// ============================================================
			if (typeof forumBoards !== 'undefined' && forumBoards.length > 0) {
				let forumContextStr = "";

				// 遍历所有版块
				forumBoards.forEach(board => {
					// 条件1：该版块开启了互通
					// 条件2：当前角色在这个版块的允许发帖名单内
					if (board.syncMemory && board.allowedCharIds && board.allowedCharIds.includes(character.id)) {
						
						// 获取当前版块专属的限制条数（A版块5条，B版块3条...）
						const limit = parseInt(board.memoryLimit) || 5;
						
						// 【优化1】强制按时间戳降序排列，确保绝对是"最新"的 N 条帖子
						const recentPosts =[...(board.posts || [])]
							.sort((a, b) => b.timestamp - a.timestamp)
							.slice(0, limit);
						
						if (recentPosts.length > 0) {
							forumContextStr += `\n[论坛版块：${board.name}]\n`;
							
							recentPosts.forEach(post => {
								const timeStr = getSmartTime(post.timestamp);
								
								// 【优化2】放宽正文截断限制，保留150字，让AI更清楚帖子在聊什么
								let postContent = post.content || "";
								if (postContent.length > 150) postContent = postContent.substring(0, 150) + '...';
								
								forumContextStr += `> ${timeStr} 楼主[${post.authorName}]: ${post.title} - ${postContent}\n`;
								
								// 附加最近的5条评论作为上下文
								if (post.replies && post.replies.length > 0) {
									// slice(-5) 取最后5个（即最新5个回复）
									const repliesCtx = post.replies.slice(-5).map(r => `${r.authorName}: ${r.content}`).join(' | ');
									forumContextStr += `  (最新回复: ${repliesCtx})\n`;
								}
							});
						}
					}
				});

				if (forumContextStr) {
					const forumSection = `
					【网络论坛动态 (Forum Context)】
					以下是你参与的论坛版块中最近发布的热门帖子和讨论。
					你可以偶尔在私聊中和用户讨论这些论坛上的“八卦”或动态，表现出你们有共同的上网圈子：
					${forumContextStr}
					--------------------------------`;
					
					messages.push({ role: "system", content: forumSection });
				}
			}
			// ============================================================
			// 9. 【最终指令 (Final Instructions)】
			// ============================================================
			if (isOnline) {
				
				sectionFinalInstructions = `【最终输出指令】
				请严格记住，你的回复**必须**遵循以下格式规则，不得遗漏：
				- **多条消息**：使用 "###" 分隔。
				- **引用回复**：以 "[REF:用户原话] " 开头。禁止引用被撤回的消息。严禁引用分享的小红书笔记描述中的内容。严禁引用任何“系统”发出的后台指令、提示或消息！
				- **主动消息撤回**：使用 "[WITHDRAW] " 格式。此格式下的所有消息都是你自己撤回的，禁止将此格式撤回内容作为用户撤回的看待。
				- **禁止任何形式的场景/动作描写**。
				- **特别提醒**：你自己撤回的消息，系统会单独标注「你撤回了消息」，无需对此做任何回应，继续正常对话即可。
				- **必须在所有消息结束后**追加内心状态的JSON数据。
				- **发送表情包**：在你想要表达情绪的时候可以使用表情包，表情包发送必须按照[表情包：描述]，切表情包必须是列表内存在的。
				现在，请根据以上所有信息和下面的聊天记录，生成你的下一句回复。
				- **人生档案记录指令**：当且仅当本轮对话中明确发生了足以改变人生轨迹的重大事件时，你*必须**在【内心状态 JSON】的**下一行**使用 NN_LIFE_EVENT::{"event":"对该事件的客观简述"}记录。`;
				
			} else {				
				
				sectionFinalInstructions = `【最终输出指令】
				请严格记住，你的回复**必须**是第一人称叙事，必须使用第二人称指代用户，且**必须使用换行进行分段**,**严禁输出一整段不换行的长文本**。
				**必须在叙事文本结束后**追加内心状态的JSON数据。
				- **人生档案记录指令**：当本轮对话中明确发生了足以改变人生轨迹的重大事件时，你*必须**在【内心状态 JSON】的**下一行**使用 NN_LIFE_EVENT::{"event":"对该事件的客观简述"}记录。记录前必须检查之前的人生档案，禁止重复记录同一件事。
				现在，请根据以上所有信息和下面的聊天记录，续写你的故事。`;
			}
			// ============================================================
			// 组装 System Prompt (严格按照顺序)
			// ============================================================
			let fullSystemContent = [
				sectionMode,      // 1. 模式
				sectionWithdraw,  // 2. 撤回 
				sectionBlockStatus, // 【新增：拉黑状态提示】				
				sectionTime,      // 3. 时间
				sectionEmoticons, //3.5表情包
				sectionInnerStatus, // 4.心声面板
				sectionWbBefore,  // <--- 【这里新增：人设前的世界书】
				sectionPersona,   // 5. 人设 (AI自己的设定)
				sectionMask,      // 6. 用户面具 (专属 或 通用)
				sectionUser,	  // 7. 用户资料 (仅状态 或 完整资料)
				sectionPeriod,    //用户经期状态
				sectionWeather,   // 【新增】天气状态
				sectionTheirDay,   // <--- 插入日程安排
				sectionFortune, 
				sectionLifeEventInstruction, // 【新增】将通用指令添加到这里
				sectionLifeEvents, // 【新增】人生档案
				sectionGifts,       // <--- 插入这里
				sectionDeliveries,  // <--- 插入这里
				sectionWbAfter,  // 8. 世界书 
				sectionFinalInstructions // 9. 最终指令 
			].filter(s => s.trim() !== "").join("\n\n");
				
			// 调试：看看最终发给 AI 的总 Prompt 长什么样
            //console.log("Final System Prompt:", fullSystemContent); 
			
			messages.push({ role: "system", content: fullSystemContent });

			// ============================================================
			// B. 构建历史消息 (History)
			// ============================================================
			let limit = parseInt(memorySettings.shortTermLimit);
			if (isNaN(limit) || limit < 1) limit = 20;

			const recentHistory = character.chatHistory.slice(-limit);

			recentHistory.forEach(msg => {
				// 【新增】处理隐藏的后台记录消息
				if (msg.isHidden) {
					messages.push({ role: "system", content: msg.text });
					return; // 跳过气泡渲染逻辑
				}
				let timePrefix = character.timeAware ? `${formatFullTime(msg.timestamp)} ` : "";
				const role = msg.type === 'sent' ? 'user' : 'assistant';
				let contentText = ""; // 初始化为空
				// 【新增：将拉黑提示转换为AI能看懂的系统状态】
                if (msg.isAiBlockMsg) {
                    messages.push({ role: "system", content: `${timePrefix}[系统记录：你在此刻将用户拉黑了，线上通讯中断]` });
                    return; 
                }
				// -------------------------------------------------
				// 【核心修正逻辑开始】
				// 优先级：表情包 > 真实图片 > 虚拟图片 > 纯文本
				// -------------------------------------------------
				// 0. 优先判断语音条 (新增)
				if (msg.isVoice) {
					contentText = `[语音：${msg.text || ""}]`;
				}
				// 1. 预先判断是否为表情包 (有图片URL 且 文本是以 [表情包： 开头)
				// 这里的判断必须非常严格，防止误判
				const isEmoticon = msg.image && msg.text && msg.text.startsWith('[表情包：');

				if (isEmoticon) {
					// === 情况 A：表情包 ===
					// 仅发送文本描述，绝对不加 [图片] 前缀
					// 结果示例: "[表情包：滑稽]"
					contentText = msg.text;
				} 
				else if (msg.image) {
					// === 情况 B：真实图片 (非表情包) ===
					if (msg.imageDescription) {
						// 已识别：[图片：一只猫...]
						contentText = `[图片：${msg.imageDescription}]`;
					} else {
						// 未识别：[图片] (用户发送了一张图片)
						contentText = `[图片] (用户发送了一张图片)`;
					}
					
					// 如果图片带有额外的文字附言（且不是默认的占位符），拼接到后面
					if (msg.text && msg.text !== '[图片]' && msg.text !== contentText) {
						 contentText += ` ${msg.text}`;
					}
				} 
				else if (msg.isVirtual) {
					// === 情况 C：虚拟图片 ===
					// 确保 msg.text 存在
					contentText = `[图片：${msg.text || '未命名的图片'}]`;
				} 
				else if (msg.isPayment) {
					// === 【新增】情况 D：转账/红包历史上下文 ===
					if (msg.type === 'sent') {
						contentText = `[系统记录：用户向你发送了${msg.paymentType === 'transfer' ? '转账' : '红包'}，金额：${msg.amount}元，支付ID：${msg.paymentId}，备注：${msg.paymentDesc || ''}]`;
					} else {
						contentText = `[系统记录：你向用户发送了${msg.paymentType === 'transfer' ? '转账' : '红包'}，金额：${msg.amount}元]`;
					}
				}
				else if (msg.isOrderCard) {
					// === 【修复】情况 F：外卖/礼物卡片历史上下文 ===
					if (msg.type === 'sent') {
						contentText = `[系统记录：用户发起了${msg.orderType === 'gift' ? '礼物' : '外卖'}订单 - ${msg.title}]`;
					} else {
						contentText = `[系统记录：你发起了${msg.orderType === 'gift' ? '礼物' : '外卖'}订单 - ${msg.title}]`;
					}
				}
				else {
					// === 情况 E：普通文本 ===
					// 容错：如果 text 为 null/undefined，给空字符串
					contentText = msg.text || " ";
				}
				// ============================================================
				// 处理引用 (统一格式：语音/图片/表情包)
				if (msg.quote) {
					let quoteContent = "";

					// 1. 引用的是语音
					if (msg.quote.isVoice) {
						// 格式：[语音：语音转文字内容]
						quoteContent = `[语音：${msg.quote.text || "语音"}]`;
					} 
					// 2. 引用的是图片 (真实图片 OR 虚拟图片)
					else if (msg.quote.isImage || msg.quote.isVirtual) {
						// 优先取描述，没有则取文本，最后兜底
						const desc = msg.quote.description || msg.quote.text || "图片";
						
						// 特殊处理：如果是表情包，保留原格式
						if (desc.startsWith('[表情包：')) {
							quoteContent = desc;
						} else {
							// 格式：[图片：图片描述]
							quoteContent = `[图片：${desc}]`;
						}
					} 
					// 3. 引用的是普通文本或特殊格式
					else {
						quoteContent = msg.quote.text || "";
						// 解析是否引用了文件
						if (quoteContent.match(/^\[文件：(.*?)\|(.*?)\]$/s)) {
							const m = quoteContent.match(/^\[文件：(.*?)\|(.*?)\]$/s);
							quoteContent = `[文件：${m[1]}]`;
						}
					}

					// 拼接到消息前
					contentText = `[REF: ${quoteContent}] ${contentText}`;
				}
			
				// 注入时间戳 - 特殊消息：通话记录
				if (msg.isCallRecord) {
					if (msg.summary) {
						// 1. 正常的通话结束记录 (带总结)
						messages.push({ 
							role: "system", 
							content: `${timePrefix}[历史记录] 你们进行了一次视频通话。通话总结：${msg.summary}` 
						});
					} else {
						// 2. 拒绝通话/未接通的记录
						let systemContext = "";
						if (msg.type === 'sent') {
							systemContext = `[系统通知] 用户(${userInfo.name}) 拒绝了你的视频通话请求。`;
						} else {
							systemContext = `[系统通知] 你(AI) 拒绝了用户的视频通话请求。`;
						}
						
						messages.push({
							role: "system",
							content: `${timePrefix}${systemContext}`
						});
					}
					return; // 跳过常规处理
				}

				// 注入时间戳 - 特殊消息：处理撤回
				if (msg.isWithdrawn) {
					const delta = msg.withdrawTimestamp - msg.timestamp;
					let systemReport = '';
					
					// --- 核心修改：统一撤回内容的格式 ---
					let withdrawnContent = "";

					if (msg.isVoice) {
						withdrawnContent = `[语音：${msg.text || "一段语音"}]`;
					} 
					else if (msg.isVirtual) {
						withdrawnContent = `[图片：${msg.text || "图片"}]`;
					} 
					else if (msg.image) {
						if (msg.text && msg.text.startsWith('[表情包：')) {
							withdrawnContent = msg.text; 
						} else if (msg.imageDescription) {
							withdrawnContent = `[图片：${msg.imageDescription}]`; 
						} else {
							withdrawnContent = `[图片]`; 
						}
					} 
					else {
						withdrawnContent = msg.text || "消息";
						let isFileMatchWithdraw = msg.text ? msg.text.match(/^\[文件：(.*?)\|(.*?)\]$/s) : null;
						if (isFileMatchWithdraw) withdrawnContent = `[文件：${isFileMatchWithdraw[1]}]`;
					}

					if (msg.withdrawBy === 'user') {
						 if (delta <= 10000) {
							 systemReport = `【系统提示】用户发送了一条消息但立刻撤回了。`;
						 } else {
							 systemReport = `【系统提示】用户发送了消息：「${withdrawnContent}」，但在${Math.round(delta/1000)}秒后撤回了。`;
						 }
					} else if (msg.withdrawBy === 'assistant') {
						 systemReport = `【系统提示】你发送了消息：「${withdrawnContent}」，但在${Math.round(delta/1000)}秒后自己撤回了。`;
					}
					
					// 拼接时间戳到系统提示中
					if (systemReport) messages.push({ role: "system", content: `${timePrefix}${systemReport}` });
				} 
				else {
					// 注入时间戳 - 正常消息入栈
					messages.push({ role: role, content: `${timePrefix}${contentText}` });
				}
			});

			// ============================================================
			// C. 注入长期记忆
			// ============================================================
			if (character.longTermMemories && character.longTermMemories.length > 0) {
				const memoryContent = `\n\n【长期记忆库 (Long-Term Memory)】\n这是你过去与用户的经历总结，请在回复时参考这些信息以保持连贯性：\n` + character.longTermMemories.join('\n');
				messages.push({ role: "system", content: memoryContent });
			}
			// ============================================================
			// 【新增】注入互通的群聊记忆 (Group Chat Sync Memory) - 全量无省略版
			// 当群聊开启了记忆互通且当前角色在群内，将群的全量上下文注入私聊
			// ============================================================
			let groupSyncContents = [];
			characters.filter(c => c.type === 'group' && c.syncHistory).forEach(groupChar => {
				const isMember = groupChar.members && groupChar.members.some(m => m.type === 'existing' && m.id === character.id);
				if (isMember) {
					let groupDataStr = `[群聊名称: ${groupChar.name}]`;
					
					// 1. 群人生档案 (全部提取)
					if (groupChar.lifeEvents && groupChar.lifeEvents.length > 0) {
						groupDataStr += `\n- 群重大事件档案: ${groupChar.lifeEvents.map(e => e.event).join('; ')}`;
					}
					// 2. 群长期记忆 (全部提取)
					if (groupChar.longTermMemories && groupChar.longTermMemories.length > 0) {
						groupDataStr += `\n- 群长期记忆总结:\n  ${groupChar.longTermMemories.join('\n  ')}`;
					}
					// 3. 群聊上下文 (全部历史记录，不做任何截断)
					if (groupChar.chatHistory && groupChar.chatHistory.length > 0) {
						const allMsgs = groupChar.chatHistory.map(msg => {
							if (msg.isHidden) return null;
							const sender = msg.type === 'sent' ? (groupChar.userName || userInfo.name) : (msg.senderName || '某成员');
							let content = msg.text || '';
							
							if (msg.isVoice) content = `[语音：${msg.text || ""}]`;
							else if (msg.image && msg.text && msg.text.startsWith('[表情包：')) content = msg.text;
							else if (msg.image) content = msg.imageDescription ? `[图片：${msg.imageDescription}]` : `[图片]`;
							else if (msg.isVirtual) content = `[图片：${msg.text || '未命名的图片'}]`;
							else if (msg.isPayment) content = `[系统记录：${msg.type === 'sent' ? '用户' : '成员'}发了${msg.paymentType === 'transfer' ? '转账' : '红包'}]`;
							
							return `${sender}: ${content}`;
						}).filter(Boolean).join('\n  ');
						
						if (allMsgs) {
							groupDataStr += `\n- 群动态完整上下文:\n  ${allMsgs}`;
						}
					}
					groupSyncContents.push(groupDataStr);
				}
			});

			if (groupSyncContents.length > 0) {
				const groupSyncSection = `
		【群聊互通记忆 (Group Chat Shared Context)】
		以下是你参与的群聊中发生的完整事件和背景。你可以在与用户的私聊互动中适当地表现出你知道这些事情，以保持群聊和私聊的人设与时间线绝对连贯：
		${groupSyncContents.join('\n\n')}
		--------------------------------`;
				messages.push({ role: "system", content: groupSyncSection });
			}
			// ============================================================
            // 【终极修复版】注入朋友圈记忆 (Moments Memory) - 严谨面具ID匹配
            // ============================================================
            if (momentsSettings && momentsSettings.memorySyncEnabled) {
                const momentsLimit = momentsSettings.memoryLimit || 10;
                const sourceMoments = (typeof socialMoments !== 'undefined') ? socialMoments : [];

                // 【修复 1】简化身份判断：只要绑定了预设面具，就算专属角色。
                const isSpecificChar = character.userMaskId && character.userMaskId.trim() !== '';

                const relevantMoments = sourceMoments.filter(post => {
                    // 情况 A：AI 角色自己发的帖子，自己肯定能看见
                    if (post.authorName === character.name) {
                        return true;
                    }
                    
                    // 情况 B：用户发的帖子，必须严格匹配身份
                    const postSourceId = post.sourceId || 'global';

                    if (postSourceId === 'global') {
                        // 用户用“全局身份”发帖 -> 只有“全局角色”（未绑定任何面具）能看到
                        return !isSpecificChar;
                    } else {
                        // 【修复 2】用户用“特定面具”发帖 -> 只有绑定了【同一个面具ID】的角色能看到
                        return character.userMaskId === postSourceId;
                    }
                }).slice(0, momentsLimit);

                if (relevantMoments.length > 0) {
                    const momentsText = relevantMoments.map(post => {
                        const timeStr = getSmartTime(post.timestamp);
                        const imgStr = (post.images && post.images.length > 0) ? '[有配图]' : '';
                        const commentsStr = (post.comments || []).slice(-5).map(c => `${c.user}: ${c.content}`).join(' | ');
                        return `[${timeStr}] ${post.authorName}: ${post.content} ${imgStr} (评论: ${commentsStr})`;
                    }).join('\n');

                    const momentsSection = `
                    【朋友圈社交动态 (Social Feed Context)】
                    以下是你所在社交圈的近期动态（已过滤无关信息），请在对话中适时参考这些背景：
                    ${momentsText}
                    --------------------------------`;
                    
                    messages.push({ role: "system", content: momentsSection });
                }
            }
			return messages;
		}
		// ============================================================
		// 【新增】群聊专用：准备发送给 API 的消息上下文 (包含完整时间戳感知)
		// ============================================================
		function prepareGroupMessagesForApi(groupChar) {
			const messages = [];
			const isOnline = (typeof groupChar.isOnline !== 'undefined') ? groupChar.isOnline : true;

			// 定义各个模块的内容变量
			let sectionMode = "";
			let sectionWithdraw = "";
			let sectionTime = "";
			let sectionEmoticons = "";
			let sectionGroupPersona = "";
			let sectionMembersPersona = "";
			let sectionUser = ""; 
			let sectionMask = ""; 
			let sectionLifeEvents = "";
			let sectionLongTermMemory = "";
			let sectionPrivateMemorySync = ""; 
			let sectionWorldBook = ""; // 【新增】群聊世界书容器
			let sectionGroupTheirDay = ""; // <--- 声明群聊日程容器
			// 【修改】获取群内所有真实的私聊成员 ID，组装群聊运势
			const groupCharIds = groupChar.members.filter(m => m.type === 'existing').map(m => m.id);
			let sectionFortune = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(groupCharIds) : "";
			let sectionFinalInstructions = ""; 
			let sectionLifeEventInstruction = "";
			// 获取群成员的日程
			let groupTheirDayContents =[];
			if (groupChar.members) {
				groupChar.members.forEach(member => {
					if (member.type === 'existing') {
						const schedule = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(member.id) : "";
						if (schedule) {
							const rc = characters.find(c => c.id === member.id);
							if (rc) {
								let cleanSchedule = schedule.replace('【今日日程安排 (Ta的一天)】\n以下是你今天的日程计划，请在对话和互动中参考此日程（例如你现在应该在做什么，或者稍后要做什么）：\n', '');
								groupTheirDayContents.push(`[${rc.name}的日程]:\n${cleanSchedule}`);
							}
						}
					}
				});
			}
			sectionGroupTheirDay = groupTheirDayContents.length > 0 ? `\n【群成员今日日程安排】\n${groupTheirDayContents.join('\n')}\n` : "";
			// ============================================================
			// 【修复】群聊优先读取预设面具逻辑
			// ============================================================
			let activeUserName = userInfo.name;
			let finalUserStatus = userInfo.status || '在线';
			let finalUserMask = userInfo.mask || '';

			if (groupChar.userMaskId) {
				const boundMask = userMasks.find(m => m.id === groupChar.userMaskId);
				if (boundMask) {
					activeUserName = boundMask.name || activeUserName;
					finalUserMask = boundMask.mask || finalUserMask;
				}
			} else if (groupChar.userName && groupChar.userName.trim()) {
				// 兼容旧数据
				activeUserName = groupChar.userName.trim();
				finalUserMask = groupChar.userMask || finalUserMask;
			}

			// ============================================================
			// 0. 【模式规则 (去除了心声面板)】
			// ============================================================
			if (isOnline) {
				sectionMode = `【核心指令：群聊即时通讯模式 】
				1. 当前是手机群聊即时通讯场景（如微信群）。
				2. 你需要**同时扮演群内的所有 AI 角色和 NPC**。
				3. **严禁**使用括号、星号等符号进行动作描写、神态描写或场景描写（例如：*笑了笑*、(叹气) 统统禁止）。
				4. 只输出对话内容，风格要口语化、简短、自然。你收到的消息可能携带系统时间戳，以此判断时间流逝。但严禁模型输出携带时间戳。
				5. **群聊格式机制 (极其重要)**：你的每一次输出，必须严格以 "角色名: 说的话" 的格式。如果要连续多个人发言，必须使用 "###" 分隔。
				   例如输出：李四: 你在干嘛？###王五: 我刚吃完饭。###赵六: 要不要一起出去？
				   
				【特殊交互指令】：
				1. **单句引用回复**：使用格式：角色名: [REF:被引用的原话] 你的回复内容。严禁引用分享的小红书笔记描述中的内容。严禁引用表情包。绝对禁止引用任何以“系统消息”、“系统动作”、“系统提示”、“系统记录”开头或相关的后台指令文本！
				2. **主动撤回消息**：使用格式：角色名: [WITHDRAW] 撤回提示
				3. **发送图片/语音/文件**：使用格式：[图片：详细描述] / [语音：转文字内容] / [文件：文件名.后缀|内容描述]
				4. **处理转账/红包**：使用隐藏指令 [ACCEPT_PAY:支付ID] 或 [REJECT_PAY:支付ID]
				5. **主动给用户发转账/红包**：单独一行输出 [SEND_TRANSFER:金额|备注] 或 [SEND_REDPACKET:金额|备注]
				（注意：以上所有操作，都必须带上 "角色名: " 作为前缀，否则系统无法识别是谁发出的）`;
				
				sectionFinalInstructions = `【最终输出指令】
				请严格记住，你的回复必须遵循 "发言人名字: 内容" 的格式。多人发言用 "###" 分隔。
				**严禁**输出动作描写。请根据上下文和时间流逝，决定群里哪些角色应该做出回应，或者彼此之间产生互动。
				**【红线警告】：绝对禁止在你的回复中生成以 "${activeUserName}:" 开头的内容，你绝不能替用户发言！**`;

			} else {
				// 线下小说模式 (取消旁白，改为分角色带动作描写)
				const offlinePov = groupChar.offlinePov || 'first';
				let povInstruction = offlinePov === 'third' 
					? `**必须使用第三人称**（如“他”、“她”或角色的名字）来指代各个角色，使用第二人称“你”指代用户（${activeUserName}）。` 
					: `你可以使用各个角色的**第一人称**“我”来进行内省和描写，使用第二人称“你”指代用户（${activeUserName}）。`;

				sectionMode = `【核心指令：线下沉浸式群像叙事模式 (分角色视角) 】
				1. 当前是沉浸式小说/RP群像叙事场景。
				2. **严禁使用全局旁白视角**。群内的每个角色（包括 AI 和 NPC）都需要独立发出自己的动作描写、心理活动和对话。
				3. ${povInstruction}
				4. **必须包含**丰富的描写：包括动作描写、面部神态、周围环境描写。
				5. **群聊格式机制 (极其重要)**：你的每一次输出，必须严格以 "角色名: 描写与对话内容" 的格式。如果要连续多个人行动或发言，**必须使用 "###" 分隔**。
				   例如输出：李四: (掐灭了手中的烟，皱着眉头看向你) 你到底在想什么？###王五: (在一旁冷笑了一声) 还能想什么，做梦呗。
				6. 你收到的消息可能携带系统时间戳，以此判断时间流逝。但严禁模型输出携带时间戳。`;
				
				sectionFinalInstructions = `【最终输出指令】
				请严格记住，即使在线下叙事模式下，你的回复也**必须严格遵循 "发言人名字: 描写与对话内容" 的格式**。多人行动或发言用 "###" 分隔。
				**严禁**输出没有角色名抬头的旁白段落。必须包含丰富的场景和动作描写，必须使用第二人称指代用户。
				**【红线警告】：绝对禁止在你的回复中生成以 "${activeUserName}:" 开头的内容，你绝不能替用户发言或做决定！**
				请根据以上所有信息、时间流逝和聊天记录，继续扮演群内的角色进行互动。`;
			}

			// ============================================================
			// 1. 【群聊基础设定】
			// ============================================================
			sectionGroupPersona = `【群聊背景设定】
			群名称：${groupChar.name}
			群背景与规则：${groupChar.persona || "这是一个普通的聊天群。"}`;

			// ============================================================
			// 2 & 3. 【已有角色设定 & NPC 设定】
			// ============================================================
			let membersStr = "【群成员设定档案】\n";
			if (groupChar.members && groupChar.members.length > 0) {
				groupChar.members.forEach(member => {
					if (member.type === 'existing') {
						const realChar = characters.find(c => c.id === member.id);
						if (realChar) {
							membersStr += `-> [角色] ${realChar.name}：\n   设定：${realChar.persona || "无特别设定"}\n`;
						}
					} else if (member.type === 'npc') {
						membersStr += `-> [NPC] ${member.data.name}：\n   设定：${member.data.persona || "群里的普通成员"}\n`;
					}
				});
			} else {
				membersStr += "（当前群内没有其他AI成员）";
			}
			sectionMembersPersona = membersStr;

			// ============================================================
			// 4. 【用户面具与资料】(统一输出)
			// ============================================================
			sectionUser = `【群内用户资料】\n名字：${activeUserName}\n状态：${finalUserStatus}`;
			if (finalUserMask) {
				sectionMask = `【用户扮演设定 (User Persona)】\n${finalUserMask}\n(注意：你必须将此人设代入与 ${activeUserName} 的互动中)`;
			}

			// ============================================================
			// 5. 【时间感知、撤回、表情包规则】
			// ============================================================
			sectionWithdraw = `【消息撤回规则】如果你(作为群内某角色)撤回了消息，不用解释。如果用户撤回了消息，可根据各角色性格反应。`;
			
			// 【修复】恢复与私聊一样严格的时间感知指令
			if (groupChar.timeAware) {
				const nowStr = formatFullTime(Date.now());
				sectionTime = `【系统指令：时间流逝感知】
				1. **当前系统参考时间**：${nowStr} (请以此为“现在”的基准)。
				2. 历史记录中的每条消息都被标记了【YYYY/MM/DD HH:MM:SS】时间戳。
				3. 请通过对比历史时间戳与当前时间，计算时间间隔（例如：判断群里是刚才还在聊，还是已经沉默了很久、隔夜了等）。
				4. **格式禁令**：历史记录里的时间戳仅供你参考，**严禁**在你的新回复中包含或复述时间戳！`;
			}

			if (isOnline && emoticonList && emoticonList.length > 0 && groupChar.members) {
				let characterEmoMap = [];

				// 遍历群成员，为每个角色单独生成可用列表
				groupChar.members.forEach(m => {
					if (m.type === 'existing') {
						// 1. 找到真实的通讯录角色数据
						const realChar = characters.find(c => c.id === m.id);
						
						// 2. 检查该角色是否有勾选分类
						if (realChar && realChar.emoticonCategories && realChar.emoticonCategories.length > 0) {
							// 3. 筛选出该角色能用的表情描述
							const allowedEmos = emoticonList
								.filter(e => realChar.emoticonCategories.includes(e.category))
								.map(e => `[表情包：${e.description}]`);
							
							// 4. 去重并存入清单
							if (allowedEmos.length > 0) {
								const uniqueEmos = [...new Set(allowedEmos)];
								characterEmoMap.push(`角色【${realChar.name}】可用: ${uniqueEmos.join(', ')}`);
							}
						}
                        // 如果没设置分类，默认不给用，或者你可以改成默认全给（看你需求）
					}
				});

				if (characterEmoMap.length > 0) {
					sectionEmoticons = `【各角色专属表情包清单 (严格遵守)】
					以下列出了群内各角色被授权使用的表情包。
					1. **严禁越权**：角色只能发送自己名下的表情包，绝对禁止使用分配给其他角色的表情。
					2. **未列出者**：如果某角色未在下方列出，说明该角色没有任何表情包可用，请勿发送。
					3. **发送格式**：[表情包：描述]
					
					${characterEmoMap.join('\n')}
					`;
				}
			}

			// ============================================================
			// 6 & 7. 【群聊本身的人生档案与长期记忆】
			// ============================================================
			if (groupChar.lifeEvents && groupChar.lifeEvents.length > 0) {
				const eventsContent = groupChar.lifeEvents.map(e => `【${e.date}】 ${e.event}`).join('\n');
				sectionLifeEvents = `【群聊重大事件档案】\n${eventsContent}`;
			}

			if (groupChar.longTermMemories && groupChar.longTermMemories.length > 0) {
				sectionLongTermMemory = `【群聊长期记忆库】\n这是群内过去经历的总结：\n` + groupChar.longTermMemories.join('\n');
			}

			// ============================================================
			// 8. 【私聊记忆互通注入】(如果开启)
			// ============================================================
			if (groupChar.syncHistory) {
				let syncStr = "【成员私聊记忆互通（绝对机密上下文）】\n以下是群内真实角色与用户在私聊中发生的事件记忆。群内角色在互动时应隐晦地表现出符合这些记忆的态度，但**禁止直接把私聊秘密当众说出**：\n";
				let hasSyncData = false;

				groupChar.members.forEach(member => {
					if (member.type === 'existing') {
						const rc = characters.find(c => c.id === member.id);
						if (rc) {
							let rcMem = [];
							if (rc.lifeEvents && rc.lifeEvents.length > 0) rcMem.push(`人生事件: ${rc.lifeEvents.map(e => e.event).join('; ')}`);
							if (rc.longTermMemories && rc.longTermMemories.length > 0) rcMem.push(`长期记忆: ${rc.longTermMemories[rc.longTermMemories.length - 1]}`); // 只取最新一条防超长
							
							if (rcMem.length > 0) {
								syncStr += `\n[${rc.name}与用户的私聊记忆]:\n${rcMem.join('\n')}\n`;
								hasSyncData = true;
							}
						}
					}
				});
				if (hasSyncData) {
					sectionPrivateMemorySync = syncStr + "--------------------------------";
				}
			}
			// ============================================================
			// 9. 【新增：群聊世界书注入】
			// ============================================================
			// 提取：
            const { wbBefore, wbAfter } = getFormattedWorldBooks(groupChar.worldBookIds);
			let sectionWbBefore = wbBefore;
			let sectionWbAfter = wbAfter;
			// ============================================================
			// 10. 【新增：群聊人生档案触发指令】
			// ============================================================
			sectionLifeEventInstruction = `
			【群聊重大事件记录指令 - 严格遵守】
			当且仅当本轮群聊中明确发生了足以改变群主线剧情、人物关系或发生重大变故时，你**必须**在所有回复的**最末尾**（另起一行）使用以下格式进行记录：
			NN_LIFE_EVENT::{"event":"对该事件的客观简述"}
			例如：NN_LIFE_EVENT::{"event":"${activeUserName}和群成员们达成了一致，决定开始新的冒险"}
			注意：你的聊天回复中不要提及“正在记录档案”。`;
			// ============================================================
			// 组装 System Prompt
			// ============================================================
			let fullSystemContent = [
				sectionMode,
				sectionWithdraw,
				sectionTime,
				sectionEmoticons,
				sectionWbBefore,   
				sectionGroupPersona,
				sectionMembersPersona,
				sectionUser,
				sectionMask,
				sectionLifeEvents,
				sectionLongTermMemory,
				sectionPrivateMemorySync,
				sectionWbAfter, // 【新增】将世界书片段组装进最终的 Prompt
				sectionGroupTheirDay, // <--- 插入群成员的日程安排
				sectionFortune,
				sectionLifeEventInstruction, // 【新增】注入群聊人生档案记录指令
				sectionFinalInstructions
			].filter(s => s.trim() !== "").join("\n\n");

			messages.push({ role: "system", content: fullSystemContent });

			// ============================================================
			// 构建群聊历史消息 (Context 包含时间戳拼接)
			// ============================================================
			let limit = parseInt(memorySettings.shortTermLimit) || 20;
			const recentHistory = groupChar.chatHistory.slice(-limit);

			recentHistory.forEach(msg => {
				if (msg.isHidden) {
					messages.push({ role: "system", content: msg.text });
					return;
				}

				let contentText = "";
				if (msg.isVoice) contentText = `[语音：${msg.text || ""}]`;
				else if (msg.image && msg.text && msg.text.startsWith('[表情包：')) contentText = msg.text;
				else if (msg.image) contentText = msg.imageDescription ? `[图片：${msg.imageDescription}]` : `[图片] (用户发送了一张图片)`;
				else if (msg.isVirtual) contentText = `[图片：${msg.text || '未命名的图片'}]`;
				else if (msg.isPayment) {
					if (msg.type === 'sent') contentText = `[系统记录：用户在群里发了${msg.paymentType === 'transfer' ? '转账' : '红包'}，金额：${msg.amount}元，支付ID：${msg.paymentId}，备注：${msg.paymentDesc || ''}]`;
					else contentText = `[系统记录：群成员发了${msg.paymentType === 'transfer' ? '转账' : '红包'}，金额：${msg.amount}元]`;
				}
				else contentText = msg.text || " ";

				// 处理引用
				if (msg.quote) {
					let qText = msg.quote.description || msg.quote.text || "内容";
					contentText = `[REF: ${qText}] ${contentText}`;
				}

				// 【重点修复】：时间戳前缀的生成
				let timePrefix = groupChar.timeAware ? `${formatFullTime(msg.timestamp)} ` : "";

				if (msg.isWithdrawn) {
					const withdrawer = msg.withdrawBy === 'user' ? '用户' : (msg.senderName || '某成员');
					messages.push({ role: "system", content: `${timePrefix}【系统提示】${withdrawer} 撤回了一条消息。` });
					return;
				}

				// 【重点修复】：拼接时间戳与发言人
				if (msg.type === 'sent') {
					// 最终格式示例：【2023/10/01 12:00:00】 用户名: 消息
					messages.push({ role: "user", content: `${timePrefix}${activeUserName}: ${contentText}` });
				} else {
					const sender = msg.senderName || "系统";
					messages.push({ role: "assistant", content: `${timePrefix}${sender}: ${contentText}` });
				}
			});

			return messages;
		}
		// ============================================================
		// 【新增】处理 AI 撤回消息的交互
		// ============================================================

		/**
		 * 切换 AI 撤回消息内容的显示/隐藏
		 */
		// 可以简化为：
		// 点击隐藏气泡本身也可以切换显示/隐藏
		function toggleAiSecretMsg(event, msgId) {
			if (event) event.stopPropagation();
			const secretBubble = document.getElementById(`secret-${msgId}`);
			if (secretBubble) {
				secretBubble.classList.toggle('show');
			}
		}

		/**
		 * 简单的删除消息函数（不走复杂的菜单逻辑，直接删）
		 */
		function deleteMessageSimple(timestamp) {
			if (event) event.stopPropagation();
    
			if (confirm('确定删除这条撤回记录吗？')) {
				deleteMessageData(timestamp); // 复用已有的删除数据函数
				const row = document.getElementById(`row-${timestamp}`);
				if (row) {
					 // 处理时间戳清理逻辑 (复用已有逻辑)
					 const prevSibling = row.previousElementSibling;
					 if (prevSibling && prevSibling.classList.contains('system-time-stamp')) {
						 let hasNextMessage = false;
						 let nextSibling = row.nextElementSibling;
						 while (nextSibling) {
							 if (!nextSibling.classList.contains('system-time-stamp')) {
								 hasNextMessage = true;
								 break;
							 }
							 nextSibling = nextSibling.nextElementSibling;
						 }
						 if (!hasNextMessage) prevSibling.remove();
					 }
					 row.remove();
				}
			}
		}


		// ============================================================
		// 【修复版】通用 API 调用函数
		// 支持传入 customSettings 以便用于“记忆总结”等独立配置场景
		// 修复了 URL 拼接时出现重复 /v1/v1 的问题
		// ============================================================
		async function callOpenAiApi(messages, customSettings = null) {
			// 1. 决定使用哪套配置
			const settings = customSettings || chatApiSettings;

			// 2. 检查配置是否有效
			if (!settings.baseUrl || !settings.apiKey) {
				throw new Error("API 配置缺失：请检查设置中的 Base URL 和 API Key");
			}

			// 3. 【核心修复】智能处理 API 地址拼接
			let url = settings.baseUrl.replace(/\/$/, ""); // 移除末尾斜杠
            
            // 如果地址已经是完整路径 (包含 /chat/completions)，则不修改
            if (url.includes("/chat/completions")) {
                // do nothing
            } 
            // 如果地址以 /v1 结尾 (例如 https://api.xxx.com/v1)，只补全 /chat/completions
            else if (url.endsWith("/v1")) {
                url += "/chat/completions";
            } 
            // 否则 (例如 https://api.xxx.com)，补全标准路径 /v1/chat/completions
            else {
                url += "/v1/chat/completions";
            }

			// 4. 构建请求体
			const requestBody = {
				model: settings.model || "gpt-3.5-turbo",
				messages: messages,
				temperature: (settings.temperature !== undefined) ? parseFloat(settings.temperature) : 0.7,
				stream: false,	
			};

			try {
				const response = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": `Bearer ${settings.apiKey}`
					},
					body: JSON.stringify(requestBody)
				});

				if (!response.ok) {
					const errData = await response.json().catch(() => ({}));
					throw new Error(`API 请求失败: ${response.status} - ${errData.error?.message || response.statusText}`);
				}

				const data = await response.json();
				
				if (!data.choices || !data.choices[0] || !data.choices[0].message) {
					throw new Error("API 返回格式异常，找不到 choices[0].message");
				}

				return data.choices[0].message.content;

			} catch (error) {
				console.error("API Error:", error);
				throw error;
			}
		}
		// ============================================================
		// 【核心逻辑重构】消息存储与渲染
		// ============================================================

		// 全局变量：当前正在编辑的消息 ID (时间戳)
		let currentEditingMsgId = null; 

		// ============================================================
		// 【核心逻辑重构 2.0】分页加载与渲染
		// ============================================================

		const HISTORY_PAGE_SIZE = 15; // 每页显示多少条消息
		const MAX_RENDER_COUNT = 30;     // 屏幕上最多保留多少条 (超过这个数，顶部的消息就会被折叠进历史)
		// --- 【修改版】文本转义与格式化函数 (智能兼容 HTML 排版) ---
		function formatTextForDisplay(text) {
			if (!text) return '';
			
			// 1. 检测文本中是否包含原生的 HTML 交互/结构标签
			const hasHTML = /<\/?(div|span|button|a|p|b|i|strong|em|details|summary|table|ul|li|input|select|textarea|img|br|hr)[^>]*>/i.test(text);

			if (hasHTML) {
				// 如果是 HTML 面板，千万不能把 \n 变成 <br>，否则排版会四分五裂，并且留下巨大空白
				// 这里直接将换行符抹除，让 HTML 保持紧凑
				return text.replace(/\n/g, ''); 
			} else {
				// 2. 如果是普通的纯文本聊天，正常把换行符 \n 转换为 HTML 的 <br>，确保分段显示
				// (注意：你之前取消了 < > 的转义，这里保持原样，允许普通聊天中偶尔出现特殊符号)
				return text.replace(/\n/g, '<br>');
			}
		}
		
		
		// ============================================================
		// 【核心函数】生成单条消息的 HTML (完整修复版)
		// ============================================================
		function generateMessageHTML(msgObj, showTime = false) {
			if (msgObj.isHidden) return ''; 
			const { text, type, timestamp, quote, isWithdrawn, image, isVirtual, isVoice, voiceDuration, isGroupMsg, senderName, senderAvatar } = msgObj;
			const formattedText = formatTextForDisplay(text);
			let transcriptionHtml = '';
			const isEmoticon = image && !isVirtual && text && text.startsWith('[表情包：');
			// === 新增：处理 AI 或 用户 拉黑的特殊警告系统消息 ===
			if (msgObj.isAiBlockMsg || msgObj.isUserBlockMsg) {
				let timeHtml = showTime ? `<div class="system-time-stamp"><span>${getChatHistoryTime(timestamp)}</span></div>` : '';
				return `
					${timeHtml}
					<div class="chat-msg-row system-row" id="row-${timestamp}" onclick="handleBatchRowClick('${timestamp}')">
						<div class="batch-checkbox-col"><div class="batch-circle" id="check-${timestamp}"></div></div>
						<div class="msg-content-wrapper" style="align-items: center; width: 100%;">
							 <div class="system-withdraw-msg" style="background-color: rgba(255, 59, 48, 0.1); color: #ff3b30; border: 1px solid rgba(255, 59, 48, 0.3);">
								<i class="fas fa-user-slash"></i> ${formatTextForDisplay(text)}
							 </div>
						</div>
					</div>
				`;
			}

			// === 新增：处理常规灰色系统提示消息 (如解除拉黑) ===
			if (msgObj.isSystemMsg) {
				let timeHtml = showTime ? `<div class="system-time-stamp"><span>${getChatHistoryTime(timestamp)}</span></div>` : '';
				return `
					${timeHtml}
					<div class="chat-msg-row system-row" id="row-${timestamp}" onclick="handleBatchRowClick('${timestamp}')">
						<div class="batch-checkbox-col"><div class="batch-circle" id="check-${timestamp}"></div></div>
						<div class="msg-content-wrapper" style="align-items: center; width: 100%;">
							 <div class="system-withdraw-msg" style="background-color: rgba(0, 0, 0, 0.05); color: #888; cursor: default;">
								${formatTextForDisplay(text)}
							 </div>
						</div>
					</div>
				`;
			}

			// === 1. 处理通话记录/系统消息 (支持批量删除) ===
			if (msgObj.isCallRecord) {
				let timeHtml = showTime ? `<div class="system-time-stamp"><span>${getChatHistoryTime(timestamp)}</span></div>` : '';
				const hasDetails = msgObj.summary || (msgObj.callLogs && msgObj.callLogs.length > 0);
				const clickAction = hasDetails 
					? `onclick="if(typeof isBatchMode !== 'undefined' && !isBatchMode) { event.stopPropagation(); VideoCallSystem.showLogDetails(characters.find(c => c.id == '${activeChatId}').chatHistory.find(m => m.timestamp == ${timestamp})); }"`
					: '';
				const cursorStyle = hasDetails ? "cursor: pointer;" : "cursor: default;";
				const icon = hasDetails ? '<i class="fas fa-video"></i>' : '<i class="fas fa-phone-slash"></i>';
				
				return `
					${timeHtml}
					<div class="chat-msg-row system-row" id="row-${timestamp}" onclick="handleBatchRowClick('${timestamp}')">
						<div class="batch-checkbox-col"><div class="batch-circle" id="check-${timestamp}"></div></div>
						<div class="msg-content-wrapper" style="align-items: center; width: 100%;">
							 <div class="system-withdraw-msg" style="background-color: rgba(0, 0, 0, 0.05); color: #888; ${cursorStyle}" ${clickAction}>
								${icon} ${formatTextForDisplay(text)} ${hasDetails ? '<i class="fas fa-angle-right"></i>' : ''}
							 </div>
						</div>
					</div>
				`;
			}

			// === 2. 处理撤回消息 ===
			if (isWithdrawn) {
				let timeHtml = showTime ? `<div class="system-time-stamp"><span>${getChatHistoryTime(timestamp)}</span></div>` : '';
				let who = '';
				let menuHtml = '';
				let secretContentHtml = '';

				if (type === 'received') {
					// 如果是群聊，显示具体名字
					if (isGroupMsg && senderName) {
						who = senderName;
					} else {
						const currentCharacter = characters.find(c => c.id == activeChatId);
						who = currentCharacter ? currentCharacter.name : '对方';
					}
					
					menuHtml = `
						<div class="bubble-menu" id="menu-${timestamp}">
							<div class="menu-option" onclick="handleMenuAction('view_secret', '${timestamp}')">查看内容</div>
							<div class="menu-option" onclick="handleMenuAction('reroll', '${timestamp}')">重roll</div>
							<div class="menu-option" onclick="handleMenuAction('delete', '${timestamp}')">删除</div>
						</div>
					`;
					
					let contentToDisplay = formattedText; 
					if (isVoice) contentToDisplay = `[语音] ${formattedText}`;
					else if (isVirtual) contentToDisplay = `[图片：${formattedText}]`;
					else if (image && !isEmoticon) contentToDisplay = msgObj.imageDescription ? `[图片：${msgObj.imageDescription}]` : `[图片]`;
					else if (isEmoticon) contentToDisplay = text;
					else if (text && text.match(/^\[文件：(.*?)\|(.*?)\]$/s)) {
						const m = text.match(/^\[文件：(.*?)\|(.*?)\]$/s);
						contentToDisplay = `[文件] ${m[1]}`;
					}

					secretContentHtml = `
						<div class="ai-secret-bubble" id="secret-${timestamp}" onclick="toggleAiSecretMsg(event, '${timestamp}')">
							${contentToDisplay}
						</div>
					`;
				} else {
					who = '你';
					menuHtml = `
						<div class="bubble-menu" id="menu-${timestamp}">
							<div class="menu-option" onclick="handleMenuAction('restore', '${timestamp}')">还原</div>
							<div class="menu-option" onclick="handleMenuAction('delete', '${timestamp}')">删除</div>
						</div>
					`;
				}

				return `
					${timeHtml}
					<div class="chat-msg-row system-row" id="row-${timestamp}" onclick="handleBatchRowClick('${timestamp}')">
						<div class="batch-checkbox-col"><div class="batch-circle" id="check-${timestamp}"></div></div>
						<div class="msg-content-wrapper" style="align-items: center; width: 100%;">
							${menuHtml}
							<div class="system-withdraw-msg" id="bubble-${timestamp}" onclick="handleBubbleClickWithMode(event, '${timestamp}', this)">
								<span>${who} 撤回了一条消息</span>
							</div>
							${secretContentHtml}
						</div>
					</div>
				`;
			}

			// === 3. 处理正常消息 (支付/语音/图片/文件/文本) ===
			let messageContentHtml = '';
			let bubbleClass = 'msg-bubble'; 
			let isFileMatch = (!isEmoticon && !image && !isVirtual && !isVoice && text) ? text.match(/^\[文件：(.*?)\|(.*?)\]$/s) : null;

			if (msgObj.isPayment) {
				// --- 支付/红包 ---
				bubbleClass += ' is-payment';
				if (msgObj.paymentType === 'redpacket') bubbleClass += ' redpacket';
				if (msgObj.paymentState === 'accepted') bubbleClass += ' accepted';
				if (msgObj.paymentState === 'rejected') bubbleClass += ' rejected';

				const iconHtml = msgObj.paymentType === 'redpacket' ? '<i class="fas fa-envelope-open-text"></i>' : '<i class="fas fa-exchange-alt"></i>';
				let displayTitle = '', displaySub = '', stateText = msgObj.paymentType === 'redpacket' ? 'NN红包' : 'NN转账';

				if (msgObj.paymentType === 'redpacket') {
					displayTitle = msgObj.paymentDesc || '恭喜发财，大吉大利';
				} else {
					displayTitle = `¥${parseFloat(msgObj.amount).toFixed(2)}`;
					displaySub = msgObj.paymentDesc || '转账给你';
				}
				if (msgObj.paymentState === 'accepted') stateText = '已被领取';
				if (msgObj.paymentState === 'rejected') stateText = '已被退还';

				const clickAction = `handlePaymentClick(event, '${timestamp}')`;
				messageContentHtml = `
					<div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column;">
						<div class="payment-placeholder">
							<div class="payment-icon-box">${iconHtml}</div>
							<div class="payment-info-box">
								<div class="payment-amount-text">${displayTitle}</div>
								${displaySub ? `<div class="payment-desc-text">${displaySub}</div>` : ''}
							</div>
						</div>
						<div class="payment-footer">${stateText}</div>
					</div>
				`;
			}
			else if (msgObj.isOrderCard) {
				bubbleClass += ' is-order-card'; // 稍后在CSS加样式
				const isGift = msgObj.orderType === 'gift';
				const iconHtml = isGift ? '<i class="fas fa-gift" style="color:#ff4d4f;"></i>' : '<i class="fas fa-motorcycle" style="color:#07c160;"></i>';
				let tagText = '';
				if (isGift) {
					tagText = msgObj.type === 'sent' ? '送出礼物' : '收到礼物';
				} else {
					tagText = msgObj.type === 'sent' ? '发起外卖订单' : '为你点了一份外卖';
				}
				
				messageContentHtml = `
					<div style="width:100%; height:100%; display:flex; flex-direction:column; background:#fff; border-radius:6px; overflow:hidden;">
						<div style="padding:10px 12px; border-bottom:1px dashed #eee; display:flex; justify-content:space-between; align-items:center;">
							<span style="font-size:12px; color:#999;">${tagText}</span>
							<span style="font-size:12px; font-weight:bold; color:${isGift ? '#ff4d4f' : '#07c160'};">${msgObj.status}</span>
						</div>
						<div style="padding:12px; display:flex; align-items:center;">
							<div style="font-size:30px; margin-right:12px; width:40px; text-align:center;">${iconHtml}</div>
							<div style="flex:1; overflow:hidden;">
								<div style="font-size:15px; font-weight:bold; color:#333; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${msgObj.title}</div>
								<div style="font-size:12px; color:#999; margin-top:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${msgObj.desc}</div>
							</div>
						</div>
						<div style="padding:8px 12px; background:#f9f9f9; font-size:14px; color:#ff4d4f; font-weight:bold; text-align:right;">
							¥ ${parseFloat(msgObj.price).toFixed(2)}
						</div>
					</div>
				`;
			}
			else if (isVoice) {
				// --- 语音条 ---
				bubbleClass += ' is-voice';
				const duration = voiceDuration || 1;
				const width = Math.min(60 + (duration * 4), 240);
				messageContentHtml = `
					<div style="width: ${width}px; display: flex; justify-content: space-between; align-items: center; height: 100%;">
						<i class="fas fa-rss voice-icon"></i>
						<span class="voice-duration">${duration}"</span>
					</div>
				`;
				const cardWidth = Math.max(width, 100); 
				transcriptionHtml = `<div class="voice-transcription" id="trans-${timestamp}" style="width: ${cardWidth}px;">${formattedText}</div>`;
			}
			else if (image) {
				// --- 真实图片 ---
				bubbleClass += ' is-image'; 
				if (isEmoticon) {
					messageContentHtml = `<div style="width: 150px; height: 150px; min-width: 150px; min-height: 150px; display: block;"><img src="${image}" class="msg-image-content" style="width: 100%; height: 100%; object-fit: contain; background-color: transparent; border-radius: 8px; cursor: default; display: block;"></div>`;
				} else {
					messageContentHtml = `<div style="max-width: 200px; min-height: 100px; display: block;"><img src="${image}" class="msg-image-content" style="max-width: 200px; max-height: 200px; border-radius: 8px; cursor: default; display: block;"></div>`;
				}
			}
			else if (isVirtual) {
				// --- 虚拟图片 ---
				bubbleClass += ' is-virtual';
				const clickAction = `handleVirtualCycle(event, '${timestamp}', this)`;
				messageContentHtml = `
					<div onclick="${clickAction}" style="width:100%; height:100%; min-height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
						<div class="virtual-placeholder">
							<i class="fas fa-image virtual-icon"></i>
							<div class="virtual-text">查看图片</div>
						</div>
						<div class="virtual-desc-content">${formattedText}</div>
					</div>
				`;
			}
			else if (isFileMatch) {
				// --- 模拟文件 ---
				bubbleClass += ' is-file';
				const fileNameFull = isFileMatch[1];
				const fileDesc = isFileMatch[2];
				let fileExt = '?';
				const parts = fileNameFull.split('.');
				if (parts.length > 1) fileExt = parts[parts.length - 1];
				
				let iconColor = '#888';
				const extLower = fileExt.toLowerCase();
				if (['doc', 'docx', 'txt'].includes(extLower)) iconColor = '#4183c4';
				else if (['xls', 'xlsx', 'csv'].includes(extLower)) iconColor = '#07c160';
				else if (['pdf'].includes(extLower)) iconColor = '#ff3b30';
				else if (['ppt', 'pptx'].includes(extLower)) iconColor = '#f39c12';
				else if (['zip', 'rar', '7z'].includes(extLower)) iconColor = '#607d8b';
				
				const clickAction = `handleVirtualCycle(event, '${timestamp}', this)`;
				messageContentHtml = `
					<div onclick="${clickAction}" style="width:100%; height:100%; min-height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
						<div class="file-placeholder">
							<div class="file-info-box">
								<div class="file-name-text" title="${formatTextForDisplay(fileNameFull)}">${formatTextForDisplay(fileNameFull)}</div>
								<div class="file-size-text">未知大小</div>
							</div>
							<div class="file-icon-box">
								<i class="fas fa-file-alt file-icon" style="color: ${iconColor};"></i>
							</div>
						</div>
						<div class="virtual-desc-content">${formatTextForDisplay(fileDesc)}</div>
					</div>
				`;
			}
			else {
				// --- 普通文本 ---
				messageContentHtml = formattedText;
			}

			// === 4. 组装通用部分 (头像、菜单、引用) ===
			let timeHtml = showTime ? `<div class="system-time-stamp"><span>${getChatHistoryTime(timestamp)}</span></div>` : '';

			// --- 【修改点】头像与名字处理 ---
			let avatarHtml = '';
			let nameHtml = ''; // 名字 HTML

			if (type === 'sent') {
				// 【修改】统一使用预设面具的头像
				let uAvatar = userInfo.avatar;
				let uIcon = userInfo.avatarIcon || 'fas fa-user';
				
				const currentActiveChar = characters.find(c => c.id == activeChatId);
				if (currentActiveChar && currentActiveChar.userMaskId) {
					const boundMask = userMasks.find(m => m.id === currentActiveChar.userMaskId);
					if (boundMask && boundMask.avatar) uAvatar = boundMask.avatar;
				}

				if (uAvatar) avatarHtml = `<img src="${uAvatar}">`;
				else avatarHtml = `<i class="${uIcon}"></i>`;
			}else {
				// 接收消息
				if (isGroupMsg) {
					// --- 群聊：显示名字 + 特定头像 ---
					if (senderName) nameHtml = `<div class="chat-msg-name">${senderName}</div>`;
					
					if (senderAvatar) {
						avatarHtml = `<img src="${senderAvatar}">`;
					} else {
						const char = (senderName || "群")[0];
						avatarHtml = `<div style="width:100%;height:100%;background:#ccc;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;">${char}</div>`;
					}
				} else {
					// --- 单聊：使用角色头像 ---
					const currentActiveChar = characters.find(c => c.id == activeChatId);
					if (currentActiveChar) avatarHtml = currentActiveChar.avatar ? `<img src="${currentActiveChar.avatar}">` : `<i class="fas fa-user"></i>`;
					else avatarHtml = `<i class="fas fa-user"></i>`;
				}
			}

			// --- 引用卡片 ---
			let quoteHtml = '';
			if (quote) {
				let displayQuoteText = quote.text;
				if (quote.isImage) displayQuoteText = '[图片]';
				else if (quote.isVoice) displayQuoteText = '[语音]'; 
				else if (quote.text && quote.text.match(/^\[文件：(.*?)\|(.*?)\]$/s)) {
					const m = quote.text.match(/^\[文件：(.*?)\|(.*?)\]$/s);
					displayQuoteText = `[文件] ${m[1]}`;
				}
				
				const safeQuoteText = formatTextForDisplay(displayQuoteText);
				// 【新增】判断是否有原消息ID，赋予点击跳转功能
				const clickAttr = quote.originalMsgId ? `onclick="jumpToQuotedMessage(event, ${quote.originalMsgId})" style="cursor:pointer;" title="点击跳转到原消息"` : '';

				quoteHtml = `
					<div class="msg-quote-card" ${clickAttr}>
						<div class="msg-quote-name">${quote.name}：</div>
						<div class="msg-quote-content">${safeQuoteText}</div>
					</div>
				`;
			}

			// --- 气泡菜单 (这里只定义一次！) ---
			let menuItemsHtml = ''; 
			if (type === 'sent') {
				menuItemsHtml = `
					<div class="menu-option" onclick="handleMenuAction('withdraw', '${timestamp}')">撤回</div>
					<div class="menu-option" onclick="handleMenuAction('reply', '${timestamp}')">引用</div>
					${(!isEmoticon && !msgObj.isPayment) ? `<div class="menu-option" onclick="handleMenuAction('edit', '${timestamp}')">编辑</div>` : ''}
					<div class="menu-option" onclick="handleMenuAction('delete', '${timestamp}')">删除</div> 
				`; 
			} else { 
				menuItemsHtml = `
					<div class="menu-option" onclick="handleMenuAction('reply', '${timestamp}')">回复</div>
					${(!isEmoticon && !msgObj.isPayment) ? `<div class="menu-option" onclick="handleMenuAction('edit', '${timestamp}')">编辑</div>` : ''}
					<div class="menu-option" onclick="handleMenuAction('reroll', '${timestamp}')">重roll</div>
					<div class="menu-option" onclick="handleMenuAction('delete', '${timestamp}')">删除</div>
					<div class="menu-option" onclick="handleMenuAction('fav', '${timestamp}')">收藏</div>
				`; 
			}

			const direction = type === 'sent' ? 'right' : 'left';
			// 群聊消息添加特殊 class
			const groupClass = isGroupMsg ? 'is-group-chat' : '';
			
			return `
				${timeHtml}
				<div class="chat-msg-row ${direction} ${groupClass}" id="row-${timestamp}" onclick="handleBatchRowClick('${timestamp}')">
					<div class="batch-checkbox-col"><div class="batch-circle" id="check-${timestamp}"></div></div>
					<div class="msg-avatar">${avatarHtml}</div>
					<div class="msg-content-wrapper">
						${nameHtml} 
						<div class="bubble-menu" id="menu-${timestamp}">${menuItemsHtml}</div>
						<div class="${bubbleClass}" id="bubble-${timestamp}" onclick="handleBubbleClickWithMode(event, '${timestamp}', this)">
							${quoteHtml}
							${messageContentHtml} 
						</div>
						${transcriptionHtml}
						<div class="msg-detail-time">${formatDetailTime(timestamp)}</div>
					</div>
				</div>
			`;
		}
		/// --- 辅助：显示引用预览条 ---
		// 【修改】增加了 isImage 参数，默认为 false
		// ============================================================
		// 【修改】显示引用预览条 (修复表情包引用显示为 [图片] 的问题)
		// ============================================================
		// 【完整版】显示引用预览条 (支持语音)
		function showReplyPreview(name, text, isImage = false, description = null, isVoice = false) {
			const previewBar = document.getElementById('reply-preview-bar');
			const previewText = document.getElementById('reply-preview-text');
			
			// 界面上显示的文字（给你看的）
			let displayText = text;
			if (isVoice) {
				displayText = '[语音]'; 
			} else if (isImage) {
				if (text && text.startsWith('[表情包：')) {
					displayText = '[表情包]';
				} else {
					displayText = '[图片]';
				}
			} else if (text && text.match(/^\[文件：(.*?)\|(.*?)\]$/s)) {
				const m = text.match(/^\[文件：(.*?)\|(.*?)\]$/s);
				displayText = `[文件] ${m[1]}`;
			}

			previewText.textContent = `回复 ${name}: ${displayText}`;
			previewBar.classList.add('show');
			
			// 聚焦输入框
			const input = document.querySelector('.chat-bar-input');
			if(input) input.focus();
		}

		// --- 辅助：取消引用 ---
		function cancelReply() {
			const previewBar = document.getElementById('reply-preview-bar');
			previewBar.classList.remove('show');
			currentQuoteData = null;
		}

		// 绑定关闭按钮事件 (放在页面加载完成后，或直接在 HTML 里的 onclick)
		document.getElementById('reply-close-btn').addEventListener('click', cancelReply);

		// --- 2. 渲染单条新消息 (发消息用，追加到底部) ---
		function renderMessageToScreen(msgObj) {
			const container = document.getElementById('chat-message-container');
			
			// 判断时间间隔 (与全局 lastMessageTimestamp 比较)
			const showTime = (msgObj.timestamp - lastMessageTimestamp > 300000);
			lastMessageTimestamp = msgObj.timestamp;

			const html = generateMessageHTML(msgObj, showTime);
			container.insertAdjacentHTML('beforeend', html);
			
			// ============================================================
			// 【核心修复】图片消息延迟滚动处理 - 确保只滚动一次
			// ============================================================
			// 如果这条消息是图片（表情包），等图片加载完撑开高度后滚动一次
			if (msgObj.image) {
				const lastMsgNode = container.lastElementChild; // 刚刚插入的那个气泡
				if (lastMsgNode) {
					const imgEl = lastMsgNode.querySelector('.msg-image-content'); // 找到里面的图片元素
					if (imgEl) {
						// 封装「只执行一次」的滚动函数
						const scrollOnce = () => {
							// 加一个微小延迟，确保图片布局已更新
							setTimeout(() => {
								scrollToBottom();
							}, 0);
							// 移除事件监听（双重保险）
							imgEl.removeEventListener('load', scrollOnce);
						};

						// 关键：使用 addEventListener + once: true 确保只触发一次
						imgEl.addEventListener('load', scrollOnce, { once: true });

						// 处理图片已缓存的情况（onload 可能不触发）
						if (imgEl.complete) {
							scrollOnce();
						}
					}
				}
			}
			
			currentRenderedCount++; // 计数+1
		}
		
		// 全局加载状态锁，防止重复触发
        let isLoadingHistory = false;

        // --- 3. 批量加载历史记录 (修复逻辑：统一入口，增加状态锁) ---
        function loadHistoryBatch(isInitialLoad = false) {
            // 1. 如果正在加载中，直接退出，防止多次触发
            if (isLoadingHistory && !isInitialLoad) return;
            
            const char = characters.find(c => c.id == activeChatId);
            if (!char || !char.chatHistory) return;

            // 2. 锁定状态，更新UI为加载中
            isLoadingHistory = true;
            const loaderText = document.querySelector('#history-loader span');
            if (loaderText) loaderText.innerHTML = '<i class="fas fa-spinner fa-spin-fast"></i> 加载中...';

            // 模拟一点网络延迟带来的自然感（也可去掉 setTimeout 直接运行）
            setTimeout(() => {
                _executeLoadHistory(char, isInitialLoad);
            }, 300);
        }

        // 内部执行函数（真正干活的）
        function _executeLoadHistory(char, isInitialLoad) {
            const totalMsgs = char.chatHistory.length;
            const container = document.getElementById('chat-message-container');
            const scrollParent = document.getElementById('main-content-area');

            // 只有当 当前渲染数 >= 总数 时，才说明真的没数据了
            if (currentRenderedCount >= totalMsgs) {
                removeLoader();
                isLoadingHistory = false; // 解锁
                return;
            }

            // A. 记录插入前的滚动高度 (锚点)
            const oldScrollHeight = scrollParent.scrollHeight;

            // B. 计算要加载哪一段数据
            let endIndex = totalMsgs - currentRenderedCount;
            let startIndex = Math.max(0, endIndex - HISTORY_PAGE_SIZE);

            const batchData = char.chatHistory.slice(startIndex, endIndex);

            if (batchData.length === 0) {
                 removeLoader();
                 isLoadingHistory = false; // 解锁
                 return;
            }

            // C. 生成 HTML
            let batchHtml = '';
            let tempLastTime = 0;
            if (startIndex > 0) {
                tempLastTime = char.chatHistory[startIndex - 1].timestamp;
            }

            batchData.forEach((msg, index) => {
                let showTime = false;
                if (index === 0) {
                    if (startIndex === 0 || (msg.timestamp - tempLastTime > 300000)) {
                        showTime = true;
                    }
                } else {
                    if (msg.timestamp - tempLastTime > 300000) showTime = true;
                }
                batchHtml += generateMessageHTML(msg, showTime);
                tempLastTime = msg.timestamp;
            });

            // D. 插入到顶部
            const loader = document.getElementById('history-loader');
            if (loader) {
                loader.insertAdjacentHTML('afterend', batchHtml);
            } else {
                container.insertAdjacentHTML('afterbegin', batchHtml);
            }

            // E. 更新计数
            currentRenderedCount += batchData.length;


            // F. 修正滚动条位置 (修改核心逻辑)
            if (isInitialLoad) {
                // 【核心修复】如果是首次进入，直接瞬间滚到底部
                // 使用 requestAnimationFrame 确保在 DOM 渲染完成后执行
                requestAnimationFrame(() => {
                    scrollParent.scrollTop = scrollParent.scrollHeight;
                });
            } else {
                // 如果是下拉加载，保持原来的位置
                const newScrollHeight = scrollParent.scrollHeight;
                scrollParent.scrollTop = newScrollHeight - oldScrollHeight;
            }

            // G. 检查加载器状态 & 解锁
            checkLoaderState(totalMsgs);
            
            // 重要：在这里解锁状态
            isLoadingHistory = false; 
        }

		// --- 4. 保存并显示消息 (核心修改：修复数据重复存储BUG) ---
		// ============================================================
		// 【修复版】保存并显示消息
		// 修复了用户消息不保存进数组导致刷新丢失的 BUG
		// ============================================================
		function saveAndRenderMessage(text, type, targetId = null, groupId = null, quoteData = null, isWithdrawnForce = false, imageUrl = null) {
			
			const chatIdToSave = targetId || activeChatId;
			if (!chatIdToSave) return;

			const charIndex = characters.findIndex(c => c.id == chatIdToSave);
			if (charIndex === -1) return;

			if (!characters[charIndex].chatHistory) {
				characters[charIndex].chatHistory = [];
			}

			// 判断是否已读
			const isMsgRead = (type === 'sent') || (activeChatId === chatIdToSave);

			// 构建消息对象
			const newMsg = {
				text: text,
				type: type, 
				timestamp: Date.now(),
				groupId: groupId, 
				isRead: isMsgRead,
				isWithdrawn: isWithdrawnForce,
				image: imageUrl // 使用传入的 imageUrl
			};

			// 处理引用数据
			if (type === 'sent' && currentQuoteData && activeChatId === chatIdToSave) {
				newMsg.quote = { 
					...currentQuoteData 
				}; 
				cancelReply(); 
			} 
			else if (quoteData) {
				newMsg.quote = quoteData;
			}

			// ============================================================
			// 【核心修复】必须先 PUSH 进数组，再保存！
			// ============================================================
			characters[charIndex].chatHistory.push(newMsg); 

			// 保存到本地存储
			saveCharactersToLocal();

			// UI 渲染
			if (activeChatId === chatIdToSave) {
				renderMessageToScreen(newMsg);

				// 滑动窗口逻辑 (内存优化)
				if (currentRenderedCount > MAX_RENDER_COUNT) {
					const allMsgRows = document.querySelectorAll('.chat-msg-row');
					if (allMsgRows.length > 0) {
						const firstMsg = allMsgRows[0];
						const prevSibling = firstMsg.previousElementSibling;
						if (prevSibling && prevSibling.classList.contains('system-time-stamp')) prevSibling.remove();
						firstMsg.remove();
						currentRenderedCount--;
					}
					ensureLoader();
					const loaderText = document.querySelector('#history-loader span');
					if (loaderText) loaderText.innerHTML = '<i class="fas fa-clock"></i> 还有更早的消息...';
				}

				scrollToBottom();
			} 

			renderChatList();
		}

        // --- 辅助：统一管理加载器显示/隐藏 ---
        function checkLoaderState(totalMsgs) {
            if (currentRenderedCount < totalMsgs) {
                ensureLoader();
                const loaderText = document.querySelector('#history-loader span');
                // 加载完成后，强制恢复为提示文本，防止卡在“加载中”
                if (loaderText) {
                     loaderText.innerHTML = '<i class="fas fa-clock"></i> 下拉查看更多聊天记录';
                     loaderText.style.color = '#999';
                }
            } else {
                removeLoader();
            }
        }

        // --- 辅助：确保加载器存在 ---
        function ensureLoader() {
            const container = document.getElementById('chat-message-container');
            if (!document.getElementById('history-loader')) {
                const loaderHtml = `<div id="history-loader" class="history-loader" onclick="loadHistoryBatch()"><span><i class="fas fa-clock"></i> 下拉查看更多聊天记录</span></div>`;
                container.insertAdjacentHTML('afterbegin', loaderHtml);
            }
		}
		
		// 辅助：添加加载器气泡
		function ensureLoader() {
			const container = document.getElementById('chat-message-container');
			if (!document.getElementById('history-loader')) {
				const loaderHtml = `<div id="history-loader" class="history-loader" onclick="loadHistoryBatch()"><span><i class="fas fa-clock"></i> 下拉查看更多聊天记录</span></div>`;
				container.insertAdjacentHTML('afterbegin', loaderHtml);
			}
		}

		// 辅助：移除加载器
		function removeLoader() {
			const loader = document.getElementById('history-loader');
			if (loader) loader.remove();
		}

		
		// --- 辅助功能：切换时间显示 ---
		function toggleMessageDetail(bubbleElement) {
			const wrapper = bubbleElement.parentElement;
			const timeDiv = wrapper.querySelector('.msg-detail-time');
			timeDiv.classList.toggle('show');
		}

		// --- 辅助功能：引用消息 ---
		function quoteMessage(text) {
			const inputBar = document.querySelector('.chat-bar-input');
			// 简单的引用格式
			inputBar.value = `回复: "${text.substring(0, 10)}${text.length>10?'...':''}" \n` + inputBar.value;
			inputBar.focus();
		}

		// ============================================================
		// 【升级版】滚动到底部 (双重保险，解决气泡显示不全问题)
		// ============================================================
		function scrollToBottom() {
			const container = document.getElementById('main-content-area');
			if (!container) return;

			// 1. 立即尝试滚动 (对应简单场景)
			container.scrollTop = container.scrollHeight;

			// 2. 延迟一帧再滚一次 (解决内容未渲染完导致的高度计算偏差)
			requestAnimationFrame(() => {
				container.scrollTop = container.scrollHeight;
				
				// 3. 针对部分移动端浏览器(如iOS Safari)的键盘弹出/渲染延迟，做最后的兜底
				setTimeout(() => {
					container.scrollTop = container.scrollHeight;
				}, 50);
			});
		}
		
		// ============================================================
		// 【修复版】页面切换函数 (集中管理布局和背景 + 修复滚动位置)
		// ============================================================
		function switchPage(targetPageId) {
			// 1. 切换页面显隐
			pages.forEach(p => p.classList.remove('active'));
			document.getElementById(targetPageId).classList.add('active');

			// 2. 处理主底部导航栏 (Main Bottom Nav)
			const showNav = showBottomNavPages.includes(targetPageId);
			bottomNav.style.display = ''; 
			if (showNav) {
				bottomNav.classList.remove('hidden');
			} else {
				bottomNav.classList.add('hidden');
			}

			// 3. 处理聊天输入栏 (Chat Input Bar)
			const chatInputBar = document.getElementById('chat-input-bar');
			if (chatInputBar) {
				if (targetPageId === 'chat-detail-page') {
					chatInputBar.style.display = 'flex';
				} else {
					chatInputBar.style.display = 'none';
				}
			}

			// 4. 调整内容区域边距 (Bottom Padding)
			if (showNav) {
				contentArea.classList.remove('no-bottom-nav');
			} else {
				contentArea.classList.add('no-bottom-nav');
			}
			
			// 5. 特殊处理 "我的" 页面 CSS 类
			contentArea.classList.toggle('me-page-active', targetPageId === 'me-page');

			// ============================================================
			// 【核心修复 1】强制滚动归零
			// ============================================================
			if (targetPageId !== 'chat-detail-page') {
				contentArea.scrollTop = 0;
			}

			// ============================================================
			// 【核心修复 2】智能调整顶部距离 (Top)
			// ============================================================
			// 逻辑：
			// 1. "我的"页面 (me-page)：顶部是个人背景图，需要沉浸式，Top = 0
			// 2. "朋友圈"首页 (moments-page)：顶部是封面图，需要沉浸式，Top = 0
			// 3. "钱包"页面 (wallet-page)：无顶栏，需要沉浸式绿底，Top = 0
			// 4. 其他所有页面：都有固定的顶部导航栏，Top = 44px
			if (targetPageId === 'me-page' || targetPageId === 'moments-page' || targetPageId === 'wallet-page') {
				contentArea.style.top = '0px';
			} else {
				contentArea.style.top = '44px';
			}

			// 6. 背景图隔离逻辑 (保持不变)
			if (targetPageId === 'chat-detail-page') {
				if (typeof StyleManager !== 'undefined') {
					StyleManager.checkBg();
				}
			} else {
				contentArea.style.backgroundImage = '';
			}
		}
		
        function switchTopBar(targetTopId) { topBars.forEach(b => b.style.display = 'none'); if (targetTopId && document.getElementById(targetTopId)) { document.getElementById(targetTopId).style.display = 'flex'; } }
        
        function initChatApiSettingsDisplay() {
            apiUrlInput.value = chatApiSettings.baseUrl; apiKeyInput.value = chatApiSettings.apiKey; apiTempInput.value = chatApiSettings.temperature;
            if (chatApiSettings.model) { modelSelect.innerHTML = `<option value="${chatApiSettings.model}" selected>${chatApiSettings.model}</option>`; } else { modelSelect.innerHTML = `<option value="">请先拉取模型</option>`; }
        }
		
        // --- 清空新建对话表单 ---
        function clearNewChatForm() {
            if (characterAvatarUploader) characterAvatarUploader.innerHTML = '<i class="fas fa-camera"></i>';
			tempCharacterAvatar = '';
			if (characterNameInput) characterNameInput.value = '';
			if (document.getElementById('character-group-input')) document.getElementById('character-group-input').value = '';
			if (document.getElementById('character-persona-input')) document.getElementById('character-persona-input').value = '';
			if (document.getElementById('character-voice-id')) document.getElementById('character-voice-id').value = '';
			document.querySelectorAll('#worldbook-select-container input[type="checkbox"]').forEach(box => box.checked = false);
			if (document.getElementById('character-time-awareness')) document.getElementById('character-time-awareness').checked = false;
			if (document.getElementById('character-offline-pov')) document.getElementById('character-offline-pov').value = 'first';
			if (document.getElementById('character-user-mask')) document.getElementById('character-user-mask').value = '';
			if (document.getElementById('new-chat-user-mask-select')) document.getElementById('new-chat-user-mask-select').value = '';
			if (document.getElementById('new-chat-user-voice-id')) {
				document.getElementById('new-chat-user-voice-id').value = '';
			}	
			 // --- 【新增】清空扩展字段 ---
            const userAvatarUploader = document.getElementById('new-chat-user-avatar-uploader');
            if (userAvatarUploader) userAvatarUploader.innerHTML = '<i class="fas fa-camera" style="font-size: 20px;"></i>';
            tempNewChatUserAvatar = '';
            if (document.getElementById('new-chat-user-name')) document.getElementById('new-chat-user-name').value = '';
            if (document.getElementById('new-chat-bg-url')) document.getElementById('new-chat-bg-url').value = '';
            if (document.getElementById('new-chat-api-url')) document.getElementById('new-chat-api-url').value = '';
            if (document.getElementById('new-chat-api-key')) document.getElementById('new-chat-api-key').value = '';
            if (document.getElementById('new-chat-model-select')) document.getElementById('new-chat-model-select').innerHTML = '<option value="">使用全局设置</option>';
            if (document.getElementById('new-chat-api-temp')) document.getElementById('new-chat-api-temp').value = '';
        }
        // 【重构】支持多页面的下拉预设框自动填充
        function populatePresetDropdownForSelect(selectElement) {
            if (!selectElement) return;
            const currentVal = selectElement.value;
            selectElement.innerHTML = '<option value="">选择一个预设...</option>';
            if (typeof apiPresets !== 'undefined') {
                apiPresets.forEach(p => {
                    selectElement.add(new Option(p.name, p.name));
                });
            }
            selectElement.value = currentVal;
        }

        function populatePresetDropdown() {
            populatePresetDropdownForSelect(presetSelectMenu);
            populatePresetDropdownForSelect(document.getElementById('social-preset-select-menu'));
            populatePresetDropdownForSelect(document.getElementById('vision-preset-select-menu'));
            populatePresetDropdownForSelect(document.getElementById('other-preset-select-menu'));
        }
        function applyPreset(presetName) {
            const preset = apiPresets.find(p => p.name === presetName);
            if (preset) {
                apiUrlInput.value = preset.baseUrl; apiKeyInput.value = preset.apiKey; apiTempInput.value = preset.temperature;
                if (preset.model) {
                    let modelExists = Array.from(modelSelect.options).some(opt => opt.value === preset.model);
                    if (!modelExists) { modelSelect.add(new Option(preset.model, preset.model)); }
                    modelSelect.value = preset.model;
                } else { modelSelect.innerHTML = '<option value="">请先拉取模型</option>'; }
            }
        }
        function populateManageModal() {
            presetListContainer.innerHTML = ''; if (apiPresets.length === 0) { presetListContainer.innerHTML = '<p style="text-align:center; color:#999;">暂无预设</p>'; return; }
            apiPresets.forEach(p => { const item = document.createElement('div'); item.className = 'preset-list-item'; item.innerHTML = `<span>${p.name}</span><button class="preset-delete-btn" data-preset-name="${p.name}"><i class="fas fa-trash-alt"></i></button>`; presetListContainer.appendChild(item); });
        }
       // ============================================================
		// 【WebDAV 分片传输核心逻辑】(支持几百兆大文件)
		// ============================================================
		const WebDAVClient = {
			// 分片大小：设为 4.5MB，留足余量给 HTTP 头，确保不超过腾讯云 6MB 限制
			CHUNK_SIZE: 1.5 * 1024 * 1024, 

			checkConfig: function() {
				if (!cloudSettings.proxy || !cloudSettings.url || !cloudSettings.username || !cloudSettings.password) {
					alert("请先填写完整：代理地址、网盘地址、账号和密码。");
					return false;
				}
				return true;
			},
			
			getAuthHeader: function() {
				const token = btoa(unescape(encodeURIComponent(`${cloudSettings.username}:${cloudSettings.password}`)));
				return `Basic ${token}`;
			},

			getFinalUrl: function(targetPath) {
				let proxy = cloudSettings.proxy.trim();
				let folder = cloudSettings.url.trim();
				if (!folder.endsWith('/')) folder += '/';
				
				// WebDAV 协议极其严格，URL 就是文件路径。
				// 绝不能在后面拼接 ?_t= 随机数，否则会导致网盘服务器解析路径失败返回 502！
				let targetUrl = folder + targetPath;

				if (proxy) {
					// 强制使用 ?url= 的格式传给腾讯云函数
					if (proxy.includes('?url=')) {
						return proxy + encodeURIComponent(targetUrl);
					} else {
						// 去除代理地址结尾多余的斜杠
						proxy = proxy.replace(/\/$/, "");
						const separator = proxy.includes('?') ? '&' : '?';
						return proxy + separator + 'url=' + encodeURIComponent(targetUrl);
					}
				}
				
				// 如果没开代理，直连
				return targetUrl; 
			},
			
			// 基础请求封装
			request: async function(method, path, body = null, isJson = false) {
				const url = this.getFinalUrl(path);
				const headers = { 
					'Authorization': this.getAuthHeader(),
					'Cache-Control': 'no-store',
					'Depth': '1' // <--- 【新增这一行，满足坚果云的目录查询规范】
				};
				if (isJson) headers['Content-Type'] = 'application/json';
				if (method === 'PUT') headers['Content-Type'] = 'text/plain';

				const res = await fetch(url, { method, headers, body, cache: 'no-store' });
				
				if (method !== 'MKCOL') {
					const text = await res.text();
					if (text.includes("代理") && text.includes("?url=")) throw new Error("代理参数错误");
					return { status: res.status, text };
				}
				return { status: res.status };
			},

			testConnection: async function() {
				if (!this.checkConfig()) return;
				const btn = document.getElementById('webdav-test-btn');
				const oldText = btn.innerHTML;
				btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试...';
				btn.disabled = true;

				try {
					const res = await this.request('PROPFIND', '', null);
					if (res.status === 207) {
						alert("✅ 连接成功！\n代理畅通，可以进行大文件分片传输。");
					} else if (res.status === 401) {
						throw new Error("账号或密码错误");
					} else {
						throw new Error(`HTTP ${res.status}`);
					}
				} catch (e) {
					alert("连接失败: " + e.message);
				} finally {
					btn.innerHTML = oldText;
					btn.disabled = false;
				}
			},

			// --- 分片上传核心 ---
			uploadData: async function() {
				if (!this.checkConfig()) return;
				const btn = document.getElementById('cloud-upload-btn');
				const oldText = btn.innerHTML;
				btn.disabled = true;

				try {
					// 1. 准备数据
					btn.innerHTML = '<i class="fas fa-cog fa-spin"></i> 打包中...';
					await new Promise(r => setTimeout(r, 100)); // 让UI渲染
					
					const dataStr = typeof exportBackupData === 'function' ? exportBackupData() : "{}";
					const blob = new Blob([dataStr]); // 转为 Blob 对象方便切片
					const totalSize = blob.size;
					const totalChunks = Math.ceil(totalSize / this.CHUNK_SIZE);
					
					console.log(`[Backup] 总大小: ${(totalSize/1024/1024).toFixed(2)}MB, 分片数: ${totalChunks}`);

					// 2. 创建文件夹
					await this.request('MKCOL', 'NNPhone_Data/').catch(()=>{});

					// 3. 循环上传分片
					for (let i = 0; i < totalChunks; i++) {
						const start = i * this.CHUNK_SIZE;
						const end = Math.min(start + this.CHUNK_SIZE, totalSize);
						const chunk = blob.slice(start, end); // 切片
						
						// 更新UI进度
						const progress = Math.round(((i) / totalChunks) * 100);
						btn.innerHTML = `<i class="fas fa-upload"></i> 上传分片 ${i+1}/${totalChunks} (${progress}%)`;

						// 读取切片内容为文本 (因为我们的代理是文本透传)
						const chunkText = await chunk.text();
						
						// 上传 chunk_0, chunk_1 ...
						const res = await this.request('PUT', `NNPhone_Data/backup_part_${i}.txt`, chunkText);
						
						if (res.status !== 201 && res.status !== 204 && res.status !== 200) {
							throw new Error(`分片 ${i} 上传失败 (HTTP ${res.status})`);
						}
					}

					// 4. 上传索引文件 (元数据)
					btn.innerHTML = '<i class="fas fa-save"></i> 保存索引...';
					const indexData = {
						timestamp: Date.now(),
						totalChunks: totalChunks,
						totalSize: totalSize,
						version: "2.0_chunked"
					};
					await this.request('PUT', 'NNPhone_Data/backup_index.json', JSON.stringify(indexData));

					alert(`✅ 备份完成！\n共上传 ${(totalSize/1024/1024).toFixed(2)} MB 数据，分为 ${totalChunks} 个切片。`);

				} catch (e) {
					console.error(e);
					alert("❌ 上传中断: " + e.message);
				} finally {
					btn.innerHTML = oldText;
					btn.disabled = false;
				}
			},

			// --- 分片下载核心 ---
			downloadData: async function() {
				if (!this.checkConfig()) return;
				const btn = document.getElementById('cloud-download-btn');
				const oldText = btn.innerHTML;
				btn.disabled = true;

				try {
					// 1. 获取索引文件
					btn.innerHTML = '<i class="fas fa-search"></i> 获取索引...';
					const indexRes = await this.request('GET', 'NNPhone_Data/backup_index.json');
					
					if (indexRes.status === 404) {
						// 兼容旧版：如果找不到索引，尝试直接下载 backup.json
						if(confirm("未找到分片索引，尝试按旧版(小文件)方式下载？")) {
							await this.downloadLegacy(btn, oldText);
						}
						return; 
					}
					
					if (indexRes.status !== 200) throw new Error("无法读取备份索引");

					let indexData;
					try {
						indexData = JSON.parse(indexRes.text);
					} catch(e) { throw new Error("索引文件损坏"); }

					const totalChunks = indexData.totalChunks;
					console.log(`[Restore] 发现 ${totalChunks} 个分片`);

					// 2. 循环下载分片并拼装
					let fullString = "";
					
					for (let i = 0; i < totalChunks; i++) {
						// 更新UI进度
						const progress = Math.round(((i) / totalChunks) * 100);
						btn.innerHTML = `<i class="fas fa-download"></i> 下载分片 ${i+1}/${totalChunks} (${progress}%)`;

						const chunkRes = await this.request('GET', `NNPhone_Data/backup_part_${i}.txt`);
						if (chunkRes.status !== 200) throw new Error(`分片 ${i} 下载失败`);
						
						fullString += chunkRes.text;
					}

					// 3. 解析大文件
					btn.innerHTML = '<i class="fas fa-box-open"></i> 解析数据...';
					// 给浏览器一点喘息时间渲染 UI
					await new Promise(r => setTimeout(r, 50));

					const backupData = JSON.parse(fullString);
					
					if (confirm(`✅ 成功下载并合并 ${totalChunks} 个分片！\n即将覆盖本地数据，确定吗？`)) {
						await importBackupData(backupData);
					}

				} catch (e) {
					console.error(e);
					alert("❌ 恢复失败: " + e.message);
				} finally {
					btn.innerHTML = oldText;
					btn.disabled = false;
				}
			},

			// 兼容旧版下载逻辑
			downloadLegacy: async function(btn, oldText) {
				try {
					btn.innerHTML = '下载旧版备份...';
					const res = await this.request('GET', 'NNPhone_Data/backup.json');
					if (res.status === 200) {
						const data = JSON.parse(res.text);
						await importBackupData(data);
					} else {
						alert("云端没有任何备份文件。");
					}
				} catch(e) {
					alert("旧版下载失败: " + e.message);
				} finally {
					btn.innerHTML = oldText;
					btn.disabled = false;
				}
			}
		};
		// ============================================================
		// 【优化版】智能时间格式化 (修复旧消息只显示星期几的问题)
		// ============================================================
		function getSmartTime(timestamp) {
			if (!timestamp) return '';
			
			const now = new Date();
			const date = new Date(timestamp);
			
			// 抹平时间差异，只比较日期
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
			
			// 计算相差天数
			const diffTime = today - targetDate;
			const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
			
			const hhmm = formatTime(timestamp); // HH:MM

			if (diffDays === 0) {
				return hhmm; // 今天: 14:30
			} else if (diffDays === 1) {
				return `昨天 ${hhmm}`; // 昨天: 昨天 14:30
			} else if (diffDays === 2) {
				return `前天 ${hhmm}`; // 前天: 前天 14:30
			} else if (diffDays >= 3 && diffDays < 7) {
				// 3天到7天内：显示星期几
				const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
				return weekDays[date.getDay()];
			} else {
				// 超过7天：显示日期
				const year = date.getFullYear();
				const month = (date.getMonth() + 1).toString().padStart(2, '0');
				const day = date.getDate().toString().padStart(2, '0');

				if (year === now.getFullYear()) {
					return `${month}/${day}`; // 今年: 09/25
				} else {
					return `${year}/${month}/${day}`; // 往年: 2023/09/25
				}
			}
		}

		// ============================================================
		// 【新增】聊天记录专用时间格式化 (总是包含 HH:MM)
		// 规则：
		// 今天 -> 14:30
		// 昨天 -> 昨天 14:30
		// 前天 -> 前天 14:30
		// 3-7天 -> 星期五 14:30
		// 更早 -> 2023/09/25 14:30
		// ============================================================
		function getChatHistoryTime(timestamp) {
			if (!timestamp) return '';

			const now = new Date();
			const date = new Date(timestamp);

			// 抹平时间差异，只比较日期，确保跨天计算准确
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

			// 计算相差天数
			const diffTime = today - targetDate;
			const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

			// 获取基础的时:分 (HH:MM)
			const hhmm = formatTime(timestamp); 

			if (diffDays === 0) {
				// 今天：只显示时间
				return hhmm; 
			} else if (diffDays === 1) {
				// 昨天
				return `昨天 ${hhmm}`;
			} else if (diffDays === 2) {
				// 前天
				return `前天 ${hhmm}`;
			} else if (diffDays >= 3 && diffDays < 7) {
				// 3天到7天内：星期X + 时间
				const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
				return `${weekDays[date.getDay()]} ${hhmm}`;
			} else {
				// 超过7天：日期 + 时间
				const year = date.getFullYear();
				const month = (date.getMonth() + 1).toString().padStart(2, '0');
				const day = date.getDate().toString().padStart(2, '0');

				if (year === now.getFullYear()) {
					// 今年：09/25 14:30
					return `${month}/${day} ${hhmm}`; 
				} else {
					// 往年：2023/09/25 14:30
					return `${year}/${month}/${day} ${hhmm}`; 
				}
			}
		}

		// ============================================================
		// 【新增】更新导航栏对话图标的未读红点
		// ============================================================
		function updateNavChatUnreadBadge() {
			// 检查所有对话是否有未读消息
			let hasAnyUnread = false;
			for (let char of characters) {
				if (char.chatHistory && char.chatHistory.length > 0) {
					for (let msg of char.chatHistory) {
						if (!msg.isRead) {
							hasAnyUnread = true;
							break;
						}
					}
					if (hasAnyUnread) break;
				}
			}
			
			// 更新导航栏中对话页面的未读红点
			const chatNavItem = document.querySelector('.nav-item[data-page="chat-page"]');
			if (chatNavItem) {
				if (hasAnyUnread) {
					chatNavItem.classList.add('has-chat-unread');
				} else {
					chatNavItem.classList.remove('has-chat-unread');
				}
			}
		}
		// ============================================================
        // 【新增】切换分组折叠状态
        // ============================================================
        window.toggleChatGroup = function(groupName, event) {
            // 如果点击的是拖拽手柄，则不触发折叠
            if (event && event.target.classList.contains('drag-handle')) return;

            collapsedGroups[groupName] = !collapsedGroups[groupName];
            localStorage.setItem('nnPhoneCollapsedGroups', JSON.stringify(collapsedGroups));
            
            // 局部更新 DOM 提升性能
            const header = document.getElementById(`group-header-${groupName}`);
            const content = document.getElementById(`group-content-${groupName}`);
            if (header && content) {
                if (collapsedGroups[groupName]) {
                    header.classList.add('collapsed');
                    content.classList.add('collapsed');
                } else {
                    header.classList.remove('collapsed');
                    content.classList.remove('collapsed');
                }
            }
        };
		// ============================================================
		// 【修改后】渲染对话列表 (支持置顶、分组折叠、拖拽排序)
		// ============================================================
		function renderChatList() {
			const container = document.getElementById('chat-list-container');
			if (!container) return;
			
			if (characters.length === 0) {
				container.innerHTML = '<p style="text-align: center; color: #999; margin-top: 50px;">还没有对话，点击右上角+号创建一个吧</p>';
				return;
			}

			// 1. 提取所有使用过的分组，更新到下拉提示列表中
			const datalist = document.getElementById('chat-group-datalist');
			if (datalist) {
				const groupsSet = new Set();
				characters.forEach(c => { if (c.group && c.group.trim()) groupsSet.add(c.group.trim()); });
				datalist.innerHTML = '';
				groupsSet.forEach(g => datalist.appendChild(new Option(g, g)));
			}

			const getLastTime = (char) => {
				if (char.chatHistory && char.chatHistory.length > 0) {
					return char.chatHistory[char.chatHistory.length - 1].timestamp;
				}
				return 0;
			};

			// 2. 将数据分离：置顶数组 与 分组对象字典
			const pinnedChars =[];
			const groupedChars = {};

			characters.forEach(char => {
				if (char.isPinned) {
					pinnedChars.push(char);
				} else {
					// 【修改】动态判断分组名称：群聊强制放入"群聊"分组，私聊读取设置的分组
					let g = "未分组";
					if (char.type === 'group') {
						g = "群聊";
					} else {
						g = (char.group && char.group.trim()) ? char.group.trim() : "未分组";
					}
					
					if (!groupedChars[g]) groupedChars[g] = [];
					groupedChars[g].push(char);
				}
			});

			pinnedChars.sort((a, b) => getLastTime(b) - getLastTime(a));

			// 3. 【核心修改】应用拖拽保存的自定义排序
			let groupNames = Object.keys(groupedChars);
			groupNames.sort((a, b) => {
				const idxA = customGroupOrder.indexOf(a);
				const idxB = customGroupOrder.indexOf(b);
				// 如果两者都在自定义顺序中，按顺序排
				if (idxA !== -1 && idxB !== -1) return idxA - idxB;
				if (idxA !== -1) return -1;
				if (idxB !== -1) return 1;
				// 如果是新出现的分组，"未分组"永远沉底，其他按拼音
				if (a === "未分组") return 1;
				if (b === "未分组") return -1;
				return a.localeCompare(b, 'zh-CN');
			});

			// 每次渲染时更新最新的顺序到缓存中
			customGroupOrder = groupNames;
			localStorage.setItem('nnPhoneGroupOrder', JSON.stringify(customGroupOrder));

			groupNames.forEach(g => {
				groupedChars[g].sort((a, b) => getLastTime(b) - getLastTime(a));
			});

			let allCardsHtml = ''; 

			const generateCardHtml = (char) => {
				let lastMessage = "点击对话发起聊天"; 
				let messageTime = "";
				let unreadCount = 0;
				let hasUnread = false;

				if (char.chatHistory && char.chatHistory.length > 0) {
					let lastMsgObj = null;
					for (let i = char.chatHistory.length - 1; i >= 0; i--) {
						if (!char.chatHistory[i].isHidden && char.chatHistory[i].type !== 'system') {
							lastMsgObj = char.chatHistory[i];
							break;
						}
					}
					if (!lastMsgObj) lastMsgObj = char.chatHistory[char.chatHistory.length - 1];

					messageTime = getSmartTime(lastMsgObj.timestamp);
					const fileListMatch = lastMsgObj.text ? lastMsgObj.text.match(/^\[文件：(.*?)\|(.*?)\]$/s) : null;

					if (lastMsgObj.isWithdrawn) lastMessage = `<span style="color:#ccc;">撤回了一条消息</span>`;
					else if (lastMsgObj.isVoice) lastMessage = '[语音]';
					else if (lastMsgObj.isOrderCard) lastMessage = lastMsgObj.orderType === 'gift' ? '[商品]' : '[外卖]'; 
					else if (lastMsgObj.isVirtual) lastMessage = '[图片]';
					else if (fileListMatch) lastMessage = `[文件] ${fileListMatch[1]}`;
					else if (lastMsgObj.image) {
						if (lastMsgObj.text && lastMsgObj.text.startsWith('[表情包：')) lastMessage = lastMsgObj.text;
						else lastMessage = '[图片]';
						} else {
						// 【核心修复】：利用正则表达式检测文本中是否包含 HTML 标签
						const hasHTML = /<\/?(div|span|button|a|p|b|i|strong|em|details|summary|table|ul|li|input|select|textarea|img|br|hr|style)[^>]*>/i.test(lastMsgObj.text);
						
						if (hasHTML) {
							lastMessage = '[互动卡片]'; // 如果是 HTML，就在列表外层显示为 [互动卡片]（你也可以改成 [HTML]）
						} else {
							lastMessage = lastMsgObj.text; // 纯文本正常显示
						}
					}
					
					for (let i = char.chatHistory.length - 1; i >= 0; i--) {
						const msg = char.chatHistory[i];
						if (msg.isHidden) continue; 
						if (char.chatHistory[i].isRead) break; 
						unreadCount++;
					}
					if (unreadCount > 0) hasUnread = true;
				}
				let avatarHtml = '';
                let displayTypeClass = '';
                let displayName = char.name;

                if (char.type === 'group') {
                    // 群聊头像：如果是空，显示多人图标
                    if (char.avatar) {
                        avatarHtml = `<img src="${char.avatar}">`;
                    } else {
                        avatarHtml = '<i class="fas fa-users" style="font-size: 22px;"></i>';
                    }
                    
                    // 群聊名字：加人数统计 (成员数 + 用户自己1人)
                    const memberCount = (char.members ? char.members.length : 0) + 1;
                    displayName = `${char.name} (${memberCount})`;
                    
                } else {
                    // 私聊头像
                    avatarHtml = char.avatar ? `<img src="${char.avatar}">` : '<i class="fas fa-user"></i>';
                }
                
                let cardClass = 'chat-card';
                if (char.isPinned) cardClass += ' pinned';
                if (hasUnread) cardClass += ' has-unread';
				
				return `
                    <div class="${cardClass}" data-character-id="${char.id}">
                        <div class="chat-avatar-unread" data-unread-count="${unreadCount}"></div>
                        <div class="chat-avatar">${avatarHtml}</div>
                        <div class="chat-info">
                            <div class="chat-info-top">
                                <span class="chat-name">${displayName}</span> <!-- 使用 displayName -->
                                <span class="chat-time">${messageTime}</span>
                            </div>
                            <div class="chat-last-msg">${lastMessage}</div>
                        </div>
                        <button class="chat-actions-btn" data-character-id="${char.id}">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                `;
            };

			// 4. 开始拼接 HTML (置顶对话单独渲染，不可拖拽)
			if (pinnedChars.length > 0) {
				const isPinnedCollapsed = collapsedGroups['pinned_group'];
				const colClass = isPinnedCollapsed ? 'collapsed' : '';
				allCardsHtml += `
					<div class="chat-group-wrapper">
						<div class="chat-group-header ${colClass}" id="group-header-pinned_group" onclick="toggleChatGroup('pinned_group', event)">
							<div class="group-title"><i class="fas fa-thumbtack"></i> 置顶对话</div>
							<i class="fas fa-chevron-down toggle-icon"></i>
						</div>
						<div class="chat-group-content ${colClass}" id="group-content-pinned_group">
				`;
				pinnedChars.forEach(char => { allCardsHtml += generateCardHtml(char); });
				allCardsHtml += `</div></div>`;
			}

			// 5. 渲染可拖拽的分组
			allCardsHtml += `<div id="sortable-groups-container">`;
			groupNames.forEach(g => {
				const isCollapsed = collapsedGroups[g];
				const colClass = isCollapsed ? 'collapsed' : '';
				
				allCardsHtml += `
					<div class="chat-group-wrapper" data-group-name="${g}">
						<div class="chat-group-header ${colClass}" id="group-header-${g}" onclick="toggleChatGroup('${g}', event)">
							<i class="fas fa-grip-lines drag-handle"></i>
							<div class="group-title">${g}</div>
							<i class="fas fa-chevron-down toggle-icon"></i>
						</div>
						<div class="chat-group-content ${colClass}" id="group-content-${g}">
				`;
				groupedChars[g].forEach(char => { allCardsHtml += generateCardHtml(char); });
				allCardsHtml += `</div></div>`;
			});
			allCardsHtml += `</div>`;

			container.innerHTML = allCardsHtml;
			updateNavChatUnreadBadge();

			// 6. 【核心】初始化 SortableJS 绑定拖拽
			const sortableContainer = document.getElementById('sortable-groups-container');
			if (sortableContainer && typeof Sortable !== 'undefined') {
				new Sortable(sortableContainer, {
					handle: '.drag-handle', // 只能按住标题左侧的“三道杠”拖动，防止误触
					animation: 200,
					ghostClass: 'sortable-ghost',
					onEnd: function () {
						// 拖拽松手后，获取并更新最新的分组顺序
						const newOrder = [];
						sortableContainer.querySelectorAll('.chat-group-wrapper').forEach(wrapper => {
							newOrder.push(wrapper.getAttribute('data-group-name'));
						});
						customGroupOrder = newOrder;
						localStorage.setItem('nnPhoneGroupOrder', JSON.stringify(customGroupOrder));
					}
				});
			}
		}
       // ============================================================
        // 【5. 事件监听区 - 导航和页面跳转】(已增加防空报错机制)
        // ============================================================
        navItems?.forEach(item => { item.addEventListener('click', () => { navItems.forEach(nav => nav.classList.remove('active')); item.classList.add('active'); const pageId = item.dataset.page, topId = item.dataset.top; switchPage(pageId); switchTopBar(topId); }); });
        
        document.querySelector('.user-info-card')?.addEventListener('click', () => { switchPage('user-info-page'); switchTopBar('user-info-top'); });
        document.querySelector('#user-info-top .top-bar-back')?.addEventListener('click', () => { switchPage('me-page'); switchTopBar(''); });
        
        nameEditBtn?.addEventListener('click', () => { switchPage('name-edit-page'); switchTopBar('name-edit-top'); nameEditInput?.focus(); });
        nameEditBackBtn?.addEventListener('click', () => { switchPage('user-info-page'); switchTopBar('user-info-top'); });
        
        statusEditBtn?.addEventListener('click', () => { switchPage('status-edit-page'); switchTopBar('status-edit-top'); statusEditInput?.focus(); });
        statusEditBackBtn?.addEventListener('click', () => { switchPage('user-info-page'); switchTopBar('user-info-top'); });
        
        genderEditBtn?.addEventListener('click', () => { switchPage('gender-edit-page'); switchTopBar('gender-edit-top'); genderEditInput?.focus(); });
        genderEditBackBtn?.addEventListener('click', () => { switchPage('user-info-page'); switchTopBar('user-info-top'); });
        
        regionEditBtn?.addEventListener('click', () => { switchPage('region-edit-page'); switchTopBar('region-edit-top'); regionEditInput?.focus(); });
        regionEditBackBtn?.addEventListener('click', () => { switchPage('user-info-page'); switchTopBar('user-info-top'); });
        
        maskEditBtn?.addEventListener('click', () => { switchPage('mask-edit-page'); switchTopBar('mask-edit-top'); maskEditInput?.focus(); });
        maskEditBackBtn?.addEventListener('click', () => { switchPage('user-info-page'); switchTopBar('user-info-top'); });
        
        document.getElementById('avatar-edit-btn')?.addEventListener('click', () => { switchPage('avatar-edit-page'); switchTopBar('avatar-edit-top'); });
        document.querySelector('#avatar-edit-top .top-bar-back')?.addEventListener('click', () => { switchPage('user-info-page'); switchTopBar('user-info-top'); });
        
        settingMenuBtn?.addEventListener('click', () => { switchPage('setting-page'); switchTopBar('setting-top'); });
        settingBackBtn?.addEventListener('click', () => { switchPage('me-page'); switchTopBar(''); });
        
		if (userManualBtn) {
            userManualBtn.addEventListener('click', () => {
                window.open('https://docs.qq.com/doc/DU2RzcU53Z1dJYmJQ', '_blank');
            });
        }
        
        document.querySelector('#memory-setting-top .top-bar-back')?.addEventListener('click', () => {
			switchPage('contact-page');
			switchTopBar('contact-top');
		});

        // ============================================================
        // 【6. 事件监听区 - 保存和设置】(已增加防空报错机制)
        // ============================================================
        nameSaveBtn?.addEventListener('click', () => { userInfo.name = nameEditInput.value.trim(); saveUserInfoToLocal(); initUserInfoDisplay(); nameEditBackBtn?.click(); });
        statusSaveBtn?.addEventListener('click', () => { userInfo.status = statusEditInput.value.trim(); saveUserInfoToLocal(); initUserInfoDisplay(); statusEditBackBtn?.click(); });
        genderSaveBtn?.addEventListener('click', () => { userInfo.gender = genderEditInput.value.trim(); saveUserInfoToLocal(); initUserInfoDisplay(); genderEditBackBtn?.click(); });
        regionSaveBtn?.addEventListener('click', () => { userInfo.region = regionEditInput.value.trim(); saveUserInfoToLocal(); initUserInfoDisplay(); regionEditBackBtn?.click(); });
        maskSaveBtn?.addEventListener('click', () => { userInfo.mask = maskEditInput.value.trim(); saveUserInfoToLocal(); initUserInfoDisplay(); maskEditBackBtn?.click(); });
        
        avatarUploadFile?.addEventListener('change', function(e) { handleAvatarUpload(e.target.files[0]); this.value = ''; });

		// --- 统一头像上传逻辑 (支持用户和新角色) ---
        let avatarTargetType = 'user'; // 'user' 或 'character'

        // 监听用户头像的“更多”按钮
        avatarMoreBtn.addEventListener('click', () => { 
            avatarTargetType = 'user'; 
            if (avatarUploadFile) avatarUploadFile.click(); 
        });

    


        // ============================================================
		// 【修改后】的 handleAvatarUpload 函数
		// ============================================================
		async function handleAvatarUpload(file) {
			if (!file || !file.type.startsWith('image/')) return;
			const reader = new FileReader();
			
			reader.onload = async (e) => { // 启用 async
				const result = e.target.result;
				try {
					if (avatarTargetType === 'user') {
						// 【方案】用户头像：压缩成 512px 高清缩略图
						const compressedResult = await compressImage(result, 512, 0.8);
						userInfo.avatar = compressedResult;
						saveUserInfoToLocal();
						initUserInfoDisplay();
					} else {
						// 【方案】角色头像：压缩成 120px 小缩略图
						const compressedResult = await compressImage(result, 120, 0.8);
						tempCharacterAvatar = compressedResult;
						characterAvatarUploader.innerHTML = `<img src="${tempCharacterAvatar}" style="width:100%; height:100%; object-fit:cover;">`;
					}
				} catch (error) {
					alert('图片处理失败: ' + error.message);
				}
			};
			reader.readAsDataURL(file);
		}


		

        // 绑定文件输入框的 change 事件
        avatarUploadFile.addEventListener('change', function(e) { handleAvatarUpload(e.target.files[0]); this.value = ''; });
        
        exportCacheBtn.addEventListener('click', () => {
        try {
			const dataStr = exportBackupData();
            const blob = new Blob([dataStr], { type: 'application/json' });
			 // 尝试构建文件名
			const fileName = `NN_Backup_${new Date().toISOString().slice(0,10)}.json`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `NN小手机备份_${new Date().getTime()}.json`;
			document.body.appendChild(a); // 将a标签添加到DOM中，增强兼容性
            a.click();
			document.body.removeChild(a); // 点击后移除
			setTimeout(() => {
            URL.revokeObjectURL(url);
			}, 1000);
            alert('备份文件已开始下载！');
        } catch (error) {
			alert("导出失败：数据量过大或内存不足。请尝试删除部分包含图片的对话。错误：" + error.message);}
		});
		
        importBackupBtn.addEventListener('click', () => backupUploadFile.click());
        backupUploadFile.addEventListener('change', function(e) {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = function(event) {
                try {
                    const backupData = JSON.parse(event.target.result);
					rawData = null; // 
                    if (confirm('确定要导入备份吗？将覆盖当前所有数据！')) {
                        importBackupData(backupData);
                        alert('备份导入成功！');
                    }
                } catch (error) {
                    alert('备份文件解析失败！' + error.message);
                } finally {
                    backupUploadFile.value = '';
                }
            };
            reader.readAsText(file);
        });
        clearCacheBtn.addEventListener('click', () => { if (confirm('确定清空所有数据吗？')) { clearAllCache(); alert('已清空'); } });
        
        // ============================================================
        // 【7. 事件监听区 - 新增功能】
        // ============================================================
        chatApiSettingBtn.addEventListener('click', () => { switchPage('chat-api-setting-page'); switchTopBar('chat-api-setting-top'); initChatApiSettingsDisplay(); populatePresetDropdown(); });
        document.querySelector('#chat-api-setting-top .top-bar-back').addEventListener('click', () => { switchPage('contact-page'); switchTopBar('contact-top'); });
        chatApiSaveBtn.addEventListener('click', () => {
            const tempValue = parseFloat(apiTempInput.value);
            if (isNaN(tempValue) && apiTempInput.value.trim() !== '') { alert('请输入有效的温度数值！'); return; }
            chatApiSettings.baseUrl = apiUrlInput.value.trim(); chatApiSettings.apiKey = apiKeyInput.value.trim();
            chatApiSettings.model = modelSelect.value; chatApiSettings.temperature = tempValue || 0.7;
            saveChatApiSettingsToLocal(); alert('当前API设置已保存！'); document.querySelector('#chat-api-setting-top .top-bar-back').click();
        });
		
		
		
		// ============================================================
		// 【逻辑完善】世界书管理相关逻辑
		// ============================================================

		// 1. 进入世界书列表页 (从“我”页面点击进入)
		const worldRoleBtn = document.getElementById('world-role-btn');
		if (worldRoleBtn) {
			worldRoleBtn.addEventListener('click', () => {
				switchPage('worldbook-list-page');
				switchTopBar('worldbook-list-top');
				renderWorldBooks();
			});
		}

		// 2. 列表页返回按钮
		document.querySelector('#worldbook-list-top .top-bar-back').addEventListener('click', () => {
			switchPage('me-page');
			switchTopBar('');
		});

		// 3. 点击“新增”按钮
		document.getElementById('add-worldbook-btn').addEventListener('click', () => {
			// 重置表单
			document.getElementById('wb-edit-page-title').innerText = "新增世界书";
			document.getElementById('wb-edit-id').value = ""; // 清空ID
			document.getElementById('wb-title-input').value = "";
			document.getElementById('wb-category-input').value = "";
			document.getElementById('wb-content-input').value = "";
			document.getElementById('wb-position-input').value = "after";
			
			// 隐藏删除按钮（新增模式下不可删除）
			document.getElementById('wb-delete-btn-area').style.display = 'none';

			switchPage('worldbook-edit-page');
			switchTopBar('worldbook-edit-top');
		});

		// 4. 编辑页返回按钮
		document.querySelector('#worldbook-edit-top .top-bar-back').addEventListener('click', () => {
			switchPage('worldbook-list-page');
			switchTopBar('worldbook-list-top');
		});

		// 5. 保存世界书 (新增或修改)
		document.getElementById('worldbook-save-btn').addEventListener('click', async () => {
			const id = document.getElementById('wb-edit-id').value;
			const title = document.getElementById('wb-title-input').value.trim();
			const category = document.getElementById('wb-category-input').value.trim() || "默认分类";
			const content = document.getElementById('wb-content-input').value.trim();
			const insertPosition = document.getElementById('wb-position-input').value;
			
			if (!title || !content) {
				alert("请填写标题和内容详情");
				return;
			}

			let bookIdToUse = id;

			if (id) {
				// --- 修改模式 ---
				const index = worldBooks.findIndex(b => b.id === id);
				if (index !== -1) {
					worldBooks[index] = { ...worldBooks[index], title, category, content, insertPosition };
				}
			} else {
				// --- 新增模式 ---
				bookIdToUse = Date.now().toString();
				const newBook = { id: bookIdToUse, title, category, content, insertPosition }; 
				worldBooks.push(newBook);
			}

			// 1. 【同步锁】确保立刻存入数据库
			await saveWorldBooksToLocal(); 
			
			// 2. 【智能交互】如果有老角色，才弹出“一键挂载”的询问
			if (characters.length > 0) {
				if (confirm('世界书保存成功！\n\n是否需要将其【一键挂载】到当前通讯录中的所有老角色和群聊？\n\n(选“取消”则仅保存，后续需进入具体角色的聊天设置中手动勾选)')) {
					let appliedCount = 0;
					characters.forEach(char => {
						if (!char.worldBookIds) char.worldBookIds = [];
						if (!char.worldBookIds.includes(bookIdToUse)) {
							char.worldBookIds.push(bookIdToUse);
							appliedCount++;
						}
					});
					if (appliedCount > 0) {
						await saveCharactersToLocal(true); 
						alert(`已成功为 ${appliedCount} 个已有角色装备了此世界书！`);
					} else {
						alert(`目前所有角色均已装备该世界书。`);
					}
				}
			} else {
				// 如果通讯录是空的，就直接提示保存成功
				alert('世界书保存成功！\n(由于当前没有角色，你可以稍后在新建角色时勾选它)');
			}

			// 3. 刷新并返回
			renderWorldBooks(); 
			switchPage('worldbook-list-page');
			switchTopBar('worldbook-list-top');
		});
		// 6. 编辑页内的删除按钮 (联动清理失效数据)
		document.getElementById('wb-item-delete-btn').addEventListener('click', async () => {
			const id = document.getElementById('wb-edit-id').value;
			if (!id) return; 

			if (confirm("确定要删除这条世界书设定吗？\n注意：删除后所有绑定此世界书的角色将失效。")) {
				worldBooks = worldBooks.filter(b => b.id !== id);
				await saveWorldBooksToLocal();
				
				// 【联动修复】清理所有老角色身上残留的已删除世界书ID，保持数据干净
				characters.forEach(char => {
					if (char.worldBookIds && char.worldBookIds.includes(id)) {
						char.worldBookIds = char.worldBookIds.filter(wId => wId !== id);
					}
				});
				await saveCharactersToLocal(true); // 立即保存清理结果
				
				renderWorldBooks();
				switchPage('worldbook-list-page');
				switchTopBar('worldbook-list-top');
			}
		});

		// 7. 渲染世界书列表 (核心函数)
		function renderWorldBooks() {
			const container = document.getElementById('worldbook-list-container');
			container.innerHTML = "";

			if (!worldBooks || worldBooks.length === 0) {
				container.innerHTML = `
					<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:#999;">
						<i class="fas fa-book" style="font-size:40px; margin-bottom:15px; color:#ddd;"></i>
						<div style="font-size:14px;">暂无世界书设定</div>
						<div style="font-size:12px; margin-top:5px;">点击右上角 + 号添加</div>
					</div>
				`;
				return;
			}

			// 按分类分组
			const groups = {};
			worldBooks.forEach(book => {
				const cat = book.category || "未分类";
				if (!groups[cat]) groups[cat] = [];
				groups[cat].push(book);
			});

			// 遍历渲染分组
			for (const cat in groups) {
				const groupEl = document.createElement('div');
				groupEl.className = 'wb-category-group';
				
				// 组标题
				let html = `<div class="wb-category-name">${cat}</div>`;
				
				// 组内卡片
				groups[cat].forEach(book => {
					// 转义HTML防止XSS，简单处理
					const safeTitle = book.title.replace(/</g, "&lt;");
					const safeContent = book.content.replace(/</g, "&lt;");
					
					html += `
						<div class="wb-card" onclick="openWorldBookEdit('${book.id}')">
							<div class="wb-card-info">
								<div class="wb-card-title">${safeTitle}</div>
								<div class="wb-card-preview">${safeContent}</div>
							</div>
							<div class="wb-card-arrow">
								<i class="fas fa-chevron-right"></i>
							</div>
						</div>
					`;
				});
				
				groupEl.innerHTML = html;
				container.appendChild(groupEl);
			}
		}

		// 8. 全局函数：打开编辑 (给HTML中的 onclick 使用)
		window.openWorldBookEdit = function(id) {
			const book = worldBooks.find(b => b.id === id);
			if (!book) return;

			// 填充表单
			document.getElementById('wb-edit-page-title').innerText = "编辑世界书";
			document.getElementById('wb-edit-id').value = book.id;
			document.getElementById('wb-title-input').value = book.title;
			document.getElementById('wb-category-input').value = book.category;
			document.getElementById('wb-content-input').value = book.content;
			document.getElementById('wb-position-input').value = book.insertPosition || 'after';

			// 显示删除按钮
			document.getElementById('wb-delete-btn-area').style.display = 'block';

			switchPage('worldbook-edit-page');
			switchTopBar('worldbook-edit-top');
		};
		
		// ============================================================
		// --- 记忆配置新增按钮监听 ---
		// ============================================================
		// --- 记忆设置相关事件 ---

		// 1. 点击进入设置页
		const memorySettingBtn = document.getElementById('memory-setting-btn');
		if (memorySettingBtn) {
			// 先移除旧的监听器（防止重复绑定），这是一种保险写法
			const newBtn = memorySettingBtn.cloneNode(true);
			memorySettingBtn.parentNode.replaceChild(newBtn, memorySettingBtn);

			newBtn.addEventListener('click', () => {
				// --- A. 回显基础数值设置 ---
				// 确保 memorySettings 对象存在，如果不存在给默认值
				const currentSettings = memorySettings || {};
				
				const shortTermInput = document.getElementById('short-term-memory-input');
				const intervalInput = document.getElementById('ltm-interval-input');
				const maxInput = document.getElementById('ltm-max-input');
				const enabledSwitch = document.getElementById('ltm-enabled-switch');

				if (shortTermInput) shortTermInput.value = currentSettings.shortTermLimit || 20;
				if (intervalInput) intervalInput.value = (typeof currentSettings.ltmInterval !== 'undefined') ? currentSettings.ltmInterval : 10;
				if (maxInput) maxInput.value = (typeof currentSettings.ltmMax !== 'undefined') ? currentSettings.ltmMax : 5;
				if (enabledSwitch) enabledSwitch.checked = (typeof currentSettings.ltmEnabled !== 'undefined') ? currentSettings.ltmEnabled : true;
				
				// --- B. 回显 LTM 专用 API 设置 ---
				const ltmApi = currentSettings.ltmApi || {};
				const apiUrlInput = document.getElementById('ltm-api-url-input');
				const apiKeyInput = document.getElementById('ltm-api-key-input');
				const modelSelect = document.getElementById('ltm-model-select');

				if (apiUrlInput) apiUrlInput.value = ltmApi.baseUrl || '';
				if (apiKeyInput) apiKeyInput.value = ltmApi.apiKey || '';

				// 回显模型 (处理下拉框逻辑)
				if (modelSelect) {
					if (ltmApi.model) {
						modelSelect.innerHTML = `<option value="${ltmApi.model}" selected>${ltmApi.model}</option>`;
					} else {
						modelSelect.innerHTML = `<option value="">请先拉取模型</option>`;
					}
				}

				// --- C. 【新增】回显自定义 Prompt ---
				const ltmPromptInput = document.getElementById('ltm-prompt-input');
				if (ltmPromptInput) {
					// 优先使用用户保存的，没有则显示默认常量
					if (currentSettings.ltmPrompt && currentSettings.ltmPrompt.trim() !== "") {
						ltmPromptInput.value = currentSettings.ltmPrompt;
					} else {
						ltmPromptInput.value = (typeof DEFAULT_LTM_PROMPT !== 'undefined') ? DEFAULT_LTM_PROMPT : "";
					}
				}
				// 【新增】回显群聊自定义 Prompt
				const groupLtmPromptInput = document.getElementById('group-ltm-prompt-input');
				if (groupLtmPromptInput) {
					if (currentSettings.groupLtmPrompt && currentSettings.groupLtmPrompt.trim() !== "") {
						groupLtmPromptInput.value = currentSettings.groupLtmPrompt;
					} else {
						groupLtmPromptInput.value = (typeof DEFAULT_GROUP_LTM_PROMPT !== 'undefined') ? DEFAULT_GROUP_LTM_PROMPT : "";
					}
				}
				
				// --- D. 切换页面 ---
				switchPage('memory-setting-page');
				switchTopBar('memory-setting-top');
			});
		}

		// 2. 保存记忆配置
		const memorySaveBtn = document.getElementById('memory-save-btn');
		if (memorySaveBtn) {
			// 防止重复绑定
			const newSaveBtn = memorySaveBtn.cloneNode(true);
			memorySaveBtn.parentNode.replaceChild(newSaveBtn, memorySaveBtn);

			newSaveBtn.addEventListener('click', () => {
				// --- 第一步：定义并获取变量 (之前报错就是缺了这三行) ---
				const limit = parseInt(document.getElementById('short-term-memory-input').value);
				const interval = parseInt(document.getElementById('ltm-interval-input').value);
				const max = parseInt(document.getElementById('ltm-max-input').value);
				const enabledSwitch = document.getElementById('ltm-enabled-switch');

				// --- 第二步：验证输入合法性 ---
				if (isNaN(limit) || limit < 0 || isNaN(interval) || interval < 0 || isNaN(max) || max < 1) {
					alert('请输入有效的数字！');
					return;
				}

				// --- 第三步：保存核心记忆参数 ---
				memorySettings.shortTermLimit = limit;
				memorySettings.ltmInterval = interval;
				memorySettings.ltmMax = max;
				memorySettings.ltmEnabled = enabledSwitch ? enabledSwitch.checked : true;

				// --- 第四步：保存自定义 Prompt (新增功能) ---
				const promptInput = document.getElementById('ltm-prompt-input');
				if (promptInput) {
					memorySettings.ltmPrompt = promptInput.value;
				}
				// 【新增】保存群聊自定义 Prompt
				const groupPromptInput = document.getElementById('group-ltm-prompt-input');
				if (groupPromptInput) {
					memorySettings.groupLtmPrompt = groupPromptInput.value;
				}
				// --- 第五步：保存 LTM 专用 API 设置 ---
				if (!memorySettings.ltmApi) memorySettings.ltmApi = {};
				
				const ltmApiUrl = document.getElementById('ltm-api-url-input');
				const ltmApiKey = document.getElementById('ltm-api-key-input');
				const ltmModel = document.getElementById('ltm-model-select');
				
				if (ltmApiUrl) memorySettings.ltmApi.baseUrl = ltmApiUrl.value.trim();
				if (ltmApiKey) memorySettings.ltmApi.apiKey = ltmApiKey.value.trim();
				if (ltmModel) memorySettings.ltmApi.model = ltmModel.value;
				
				// --- 第六步：写入数据库并返回 ---
				saveMemorySettingsToLocal();
				
				alert('记忆配置已保存！');
				
				// 自动点击返回按钮
				const backBtn = document.querySelector('#memory-setting-top .top-bar-back');
				if (backBtn) backBtn.click();
			});
		}
		
		// 3. 【新增】恢复默认提示词按钮逻辑
		const resetLtmPromptBtn = document.getElementById('reset-ltm-prompt-btn');
		if (resetLtmPromptBtn) {
			// 防止重复绑定
			const newResetBtn = resetLtmPromptBtn.cloneNode(true);
			resetLtmPromptBtn.parentNode.replaceChild(newResetBtn, resetLtmPromptBtn);

			newResetBtn.addEventListener('click', (e) => {
				e.preventDefault(); // 阻止可能的默认行为
				
				if (confirm("确定要恢复默认的总结提示词吗？\n当前输入框的内容将被覆盖。")) {
					const ltmInput = document.getElementById('ltm-prompt-input');
					
					if (ltmInput) {
						if (typeof DEFAULT_LTM_PROMPT !== 'undefined') {
							ltmInput.value = DEFAULT_LTM_PROMPT;
						} else {
							// 兜底文本，防止常量未定义报错
							ltmInput.value = `你即是角色 "{charName}"。请总结与 "{userName}" 的对话。\n【格式】\n{timeHeader}\n...`;
						}
					}
				}
			});
		}
		// 【新增】恢复群聊默认提示词逻辑
		const resetGroupLtmPromptBtn = document.getElementById('reset-group-ltm-prompt-btn');
		if (resetGroupLtmPromptBtn) {
			const newGroupResetBtn = resetGroupLtmPromptBtn.cloneNode(true);
			resetGroupLtmPromptBtn.parentNode.replaceChild(newGroupResetBtn, resetGroupLtmPromptBtn);

			newGroupResetBtn.addEventListener('click', (e) => {
				e.preventDefault(); 
				
				if (confirm("确定要恢复默认的群聊总结提示词吗？\n当前输入框的内容将被覆盖。")) {
					const groupLtmInput = document.getElementById('group-ltm-prompt-input');
					
					if (groupLtmInput) {
						if (typeof DEFAULT_GROUP_LTM_PROMPT !== 'undefined') {
							groupLtmInput.value = DEFAULT_GROUP_LTM_PROMPT;
						} else {
							groupLtmInput.value = `你即是群聊模拟器。请总结与 "{userName}" 的对话。\n【格式】\n{timeHeader}\n...`;
						}
					}
				}
			});
		}
		
		// ============================================================
        // 【新增】一键清空聊天记录
        // ============================================================
        const clearHistoryBtn = document.getElementById('menu-clear-history-btn');
        
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => {
                // 1. 先关闭下拉菜单，体验更好
                const chatMenuDropdown = document.getElementById('chat-menu-dropdown');
                if (chatMenuDropdown) chatMenuDropdown.classList.remove('show');

                // 2. 安全检查
                if (!activeChatId) return;

                // 3. 弹窗确认
                if (confirm('⚠️ 高能预警\n\n确定要清空与该角色的所有聊天记录吗？\n此操作将删除所有上下文记忆，且【无法恢复】！')) {
                    
                    const char = characters.find(c => c.id == activeChatId);
                    if (char) {
                        // --- A. 数据清除 ---
                        char.chatHistory =[]; // 清空数组
                        char.msgCountSinceSummary = 0;  // 重置长期记忆自动总结的计数器
                        saveCharactersToLocal(); // 保存到本地
                        // --- B. 界面清除 ---
                        const container = document.getElementById('chat-message-container');
                        
                        // 清空内容并给一个淡色提示
                        container.innerHTML = '<div style="text-align: center; color: #999; margin: 40px 0; font-size: 12px;">已清空历史记录，开启新的对话吧</div>';
                        
                        // --- C. 状态重置 ---
                        // 非常重要：重置渲染计数和时间戳记录
                        currentRenderedCount = 0; 
                        lastMessageTimestamp = 0; 
                        
                        // 如果有加载器(loader)，也需要移除或重置逻辑
                        const loader = document.getElementById('history-loader');
                        if (loader) loader.remove();

                        // --- D. 刷新外部列表 ---
                        // 让列表页的“最新消息”变成空白或提示
                        renderChatList();
                    }
                }
            });
        }
	
        // ============================================================
		// 【设置页 - 拉取模型列表逻辑】
		// ============================================================
		/**
		 * 通用模型拉取函数
		 * @param {HTMLInputElement} baseUrlInput - API基础地址输入框
		 * @param {HTMLInputElement} apiKeyInput - API密钥输入框
		 * @param {HTMLSelectElement} modelSelect - 用于填充模型的下拉选择框
		 * @param {HTMLButtonElement} fetchButton - 点击的拉取按钮
		 * @param {object} settingsToRestore - 用于恢复之前选项的设置对象 (可选)
		 */
		async function fetchModelsForApi(baseUrlInput, apiKeyInput, modelSelect, fetchButton, settingsToRestore = {}) {
			const baseUrl = baseUrlInput.value.trim();
			const apiKey = apiKeyInput.value.trim();

			if (!baseUrl || !apiKey) {
				alert("请先填写该区域的 API 地址和密钥！");
				return;
			}
			
			const originalText = fetchButton.innerHTML;
			fetchButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 拉取中...';
			fetchButton.disabled = true;

			try {
				let url = baseUrl.replace(/\/$/, "");
				if (!url.endsWith("/v1")) {
					if (!url.includes("/v1")) url += "/v1";
				}
				url += "/models";

				const response = await fetch(url, {
					method: "GET",
					headers: { "Authorization": `Bearer ${apiKey}` }
				});

				if (!response.ok) throw new Error("连接失败: " + response.status);

				const data = await response.json();
				modelSelect.innerHTML = '';
				
				if (data.data && Array.isArray(data.data)) {
					data.data.sort((a, b) => a.id.localeCompare(b.id));
					data.data.forEach(model => {
						const option = document.createElement('option');
						option.value = model.id;
						option.text = model.id;
						modelSelect.appendChild(option);
					});
					alert(`成功拉取 ${data.data.length} 个模型！`);
					
					if (settingsToRestore.model) {
						modelSelect.value = settingsToRestore.model;
					}
				} else {
					alert("API 返回格式不符合 OpenAI 标准，无法解析模型列表。");
				}

			} catch (error) {
				console.error(error);
				alert("拉取模型失败：" + error.message);
			} finally {
				fetchButton.disabled = false;
				fetchButton.innerHTML = originalText;
			}
		}

		// 为主聊天API绑定拉取事件
		fetchModelsBtn.addEventListener('click', () => {
			fetchModelsForApi(apiUrlInput, apiKeyInput, modelSelect, fetchModelsBtn, chatApiSettings);
		});
		//为识图API页面绑定拉取事件
		const visionFetchModelsBtn = document.getElementById('vision-fetch-models-btn');
		if (visionFetchModelsBtn) {
			visionFetchModelsBtn.addEventListener('click', () => {
				const visionApiUrlInput = document.getElementById('vision-api-url-input');
				const visionApiKeyInput = document.getElementById('vision-api-key-input');
				const visionModelSelect = document.getElementById('vision-model-select'); // 对应新的 select ID
				// 复用通用的拉取函数
				fetchModelsForApi(visionApiUrlInput, visionApiKeyInput, visionModelSelect, visionFetchModelsBtn, visionApiSettings);
			});
		}
		
		// 【新增】为LTM专用API绑定拉取事件
		const ltmFetchModelsBtn = document.getElementById('ltm-fetch-models-btn');
		if (ltmFetchModelsBtn) {
			ltmFetchModelsBtn.addEventListener('click', () => {
				const ltmApiUrlInput = document.getElementById('ltm-api-url-input');
				const ltmApiKeyInput = document.getElementById('ltm-api-key-input');
				const ltmModelSelect = document.getElementById('ltm-model-select');
				fetchModelsForApi(ltmApiUrlInput, ltmApiKeyInput, ltmModelSelect, ltmFetchModelsBtn, memorySettings.ltmApi);
			});
		}
		
       // 【重构】记录当前点击保存预设的是哪个页面
        let currentPresetSaveSource = 'chat'; 

        presetSelectMenu.addEventListener('change', (e) => { if (e.target.value) applyPreset(e.target.value); });
        
        // 聊天 API 保存按钮
        saveAsPresetBtn.addEventListener('click', () => { currentPresetSaveSource = 'chat'; presetNameInput.value = ''; savePresetModal.classList.add('show'); });
        
        // 识图 API 保存按钮
        const visionSaveAsPresetBtn = document.getElementById('vision-save-as-preset-btn');
        if (visionSaveAsPresetBtn) visionSaveAsPresetBtn.addEventListener('click', () => { currentPresetSaveSource = 'vision'; presetNameInput.value = ''; savePresetModal.classList.add('show'); });

        // 朋友圈 API 保存按钮
        const socialSaveAsPresetBtn = document.getElementById('social-save-as-preset-btn');
        if (socialSaveAsPresetBtn) socialSaveAsPresetBtn.addEventListener('click', () => { currentPresetSaveSource = 'social'; presetNameInput.value = ''; savePresetModal.classList.add('show'); });

        // 其他 API 保存按钮
        const otherSaveAsPresetBtn = document.getElementById('other-save-as-preset-btn');
        if (otherSaveAsPresetBtn) otherSaveAsPresetBtn.addEventListener('click', () => { currentPresetSaveSource = 'other'; presetNameInput.value = ''; savePresetModal.classList.add('show'); });

        cancelSavePresetBtn.addEventListener('click', () => savePresetModal.classList.remove('show'));

        // 【重构】确认保存逻辑（自动抓取对应页面的数据）
        // 为了防止重复绑定，这里克隆替换按钮
        const newConfirmSaveBtn = confirmSavePresetBtn.cloneNode(true);
        confirmSavePresetBtn.parentNode.replaceChild(newConfirmSaveBtn, confirmSavePresetBtn);

        newConfirmSaveBtn.addEventListener('click', () => {
            const name = presetNameInput.value.trim(); 
            if (!name) { alert('预设名称不能为空！'); return; }
            
            const existingIndex = apiPresets.findIndex(p => p.name === name);
            if (existingIndex > -1 && !confirm(`已存在名为 "${name}" 的预设，是否覆盖？`)) return;

            let baseUrl = '', apiKey = '', model = '', temperature = 0.7;
            let dropdownToUpdate = null;

            // 智能抓取不同页面的数据
            if (currentPresetSaveSource === 'chat') {
                baseUrl = apiUrlInput.value.trim();
                apiKey = apiKeyInput.value.trim();
                model = modelSelect.value;
                temperature = parseFloat(apiTempInput.value);
                if (isNaN(temperature) || apiTempInput.value.trim() === '') temperature = 0.7;
                dropdownToUpdate = presetSelectMenu;
            } 
            else if (currentPresetSaveSource === 'vision') {
                baseUrl = document.getElementById('vision-api-url-input').value.trim();
                apiKey = document.getElementById('vision-api-key-input').value.trim();
                model = document.getElementById('vision-model-select').value;
                temperature = 0.7; // 识图不需要设置温度，固定给0.7兼容
                dropdownToUpdate = document.getElementById('vision-preset-select-menu');
            } 
            else if (currentPresetSaveSource === 'social') {
                baseUrl = document.getElementById('social-api-url-input').value.trim();
                apiKey = document.getElementById('social-api-key-input').value.trim();
                model = document.getElementById('social-model-select').value;
                temperature = parseFloat(document.getElementById('social-api-temp-input').value);
                if (isNaN(temperature) || document.getElementById('social-api-temp-input').value.trim() === '') temperature = 0.7;
                dropdownToUpdate = document.getElementById('social-preset-select-menu');
            } 
            else if (currentPresetSaveSource === 'other') {
                baseUrl = document.getElementById('other-api-url-input').value.trim();
                apiKey = document.getElementById('other-api-key-input').value.trim();
                model = document.getElementById('other-model-select').value;
                temperature = parseFloat(document.getElementById('other-api-temp-input').value);
                if (isNaN(temperature) || document.getElementById('other-api-temp-input').value.trim() === '') temperature = 0.7;
                dropdownToUpdate = document.getElementById('other-preset-select-menu');
            }

            const newPreset = { name, baseUrl, apiKey, model, temperature };

            if (existingIndex > -1) { 
                apiPresets[existingIndex] = newPreset; 
            } else { 
                apiPresets.push(newPreset); 
            }

            saveApiPresetsToLocal(); 
            alert(`预设 "${name}" 已保存！`); 
            savePresetModal.classList.remove('show');
            
            // 刷新所有的预设下拉框列表，并自动为当前触发的页面选中刚刚保存的项
            populatePresetDropdown(); 
            if (dropdownToUpdate) {
                dropdownToUpdate.value = name;
            }
        });
        managePresetsBtn.addEventListener('click', () => { populateManageModal(); managePresetsModal.classList.add('show'); });
        closeManagePresetBtn.addEventListener('click', () => managePresetsModal.classList.remove('show'));
        presetListContainer.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.preset-delete-btn');
            if (deleteBtn) {
                const presetName = deleteBtn.dataset.presetName;
                if (confirm(`确定删除预设 "${presetName}"？`)) {
                    apiPresets = apiPresets.filter(p => p.name !== presetName); saveApiPresetsToLocal();
                    if (presetSelectMenu.value === presetName) { presetSelectMenu.value = ''; }
                    populateManageModal(); populatePresetDropdown();
                }
            }
        });

		// ============================================================
		// 【修改】主页右上角 + 号下拉菜单逻辑
		// ============================================================
		const mainAddMenuDropdown = document.getElementById('main-add-menu-dropdown');
		const menuNewChatBtn = document.getElementById('menu-new-chat-btn');
		const menuNewGroupBtn = document.getElementById('menu-new-group-btn');

		// 1. 点击 + 号弹出/隐藏下拉菜单
		if (addChatBtn) {
			addChatBtn.addEventListener('click', (e) => { 
				e.stopPropagation();
				if (mainAddMenuDropdown) {
					mainAddMenuDropdown.classList.toggle('show');
				}
			});
		}

		// 2. 点击“新建聊天”进入新建页面
		if (menuNewChatBtn) {
			menuNewChatBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (mainAddMenuDropdown) mainAddMenuDropdown.classList.remove('show');
				
				clearNewChatForm(); // 先清空表单
				renderUserMaskSelectOptions('new-chat-user-mask-select', ''); // 【修复】新建私聊使用正确的 ID
				// 渲染世界书和表情包列表 (传入空数组)
				const wbContainer = document.getElementById('worldbook-select-container');
				renderWorldbookSelection(wbContainer, []);
				renderEmoticonSelection(document.getElementById('new-chat-emoticon-select-container'), []);
				
				switchPage('new-chat-page'); 
				switchTopBar('new-chat-top'); 
			});
		}

		// 3. 点击“创建群聊”
		if (menuNewGroupBtn) {
			menuNewGroupBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (mainAddMenuDropdown) mainAddMenuDropdown.classList.remove('show');
				alert("群聊功能正在开发中，敬请期待！");
			});
		}

		newChatBackBtn.addEventListener('click', () => { if (confirm('您有未保存的更改，确定要返回吗？')) { clearNewChatForm(); switchPage('chat-page'); switchTopBar('chat-top'); } });
		characterAvatarUploader.addEventListener('click', () => characterAvatarUploadInput.click());
		characterAvatarUploadInput.addEventListener('change', function(e) {
			const file = e.target.files[0]; if (!file || !file.type.startsWith('image/')) return;
			const reader = new FileReader(); reader.onload = (event) => { tempCharacterAvatar = event.target.result; characterAvatarUploader.innerHTML = `<img src="${tempCharacterAvatar}" alt="avatar preview">`; };
			reader.readAsDataURL(file); this.value = '';
		});

		// 2. 保存新建角色时，获取选中的世界书
		newChatSaveBtn.addEventListener('click', () => {
			const name = characterNameInput.value.trim();
			if (!name) { alert('角色名不能为空！'); return; }

			// 【修改】获取勾选的世界书ID
			const selectedWorldbooks = [];
			document.querySelectorAll('#worldbook-select-container input[type="checkbox"]:checked').forEach(box => {
				selectedWorldbooks.push(box.value);
			});
			
			// 【核心修复】获取新建页勾选的表情分类
            const selectedEmoCategories = [];
            const newChatEmoContainer = document.getElementById('new-chat-emoticon-select-container');
            if (newChatEmoContainer) {
                const checkedBoxes = newChatEmoContainer.querySelectorAll('input[type="checkbox"]:checked');
                checkedBoxes.forEach(box => {
                    selectedEmoCategories.push(box.value);
                });
            }
			
			const newCharacter = {
				id: Date.now().toString(), 
				name,
				group: document.getElementById('character-group-input').value.trim(),		
				avatar: tempCharacterAvatar,
				persona: document.getElementById('character-persona-input').value.trim(),
				worldBookIds: selectedWorldbooks, // <--- 保存ID数组
				voice: { provider: 'minimax', id: document.getElementById('character-voice-id').value.trim() },
				timeAware: document.getElementById('character-time-awareness').checked,
				offlinePov: document.getElementById('character-offline-pov').value,
				userMaskId: document.getElementById('new-chat-user-mask-select') ? document.getElementById('new-chat-user-mask-select').value : '',
				emoticonCategories: selectedEmoCategories, // 保存勾选结果
				isPinned: false,
				isOnline: true,
				createdAt: Date.now(),
				lifeEvents: [],
				 // --- 【新增】保存新增的表单数据 ---
                userAvatar: tempNewChatUserAvatar,
                userName: document.getElementById('new-chat-user-name') ? document.getElementById('new-chat-user-name').value.trim() : '',
                backgroundImage: document.getElementById('new-chat-bg-url') ? document.getElementById('new-chat-bg-url').value.trim() : '',
                apiSettings: {
                    baseUrl: document.getElementById('new-chat-api-url') ? document.getElementById('new-chat-api-url').value.trim() : '',
                    apiKey: document.getElementById('new-chat-api-key') ? document.getElementById('new-chat-api-key').value.trim() : '',
                    model: document.getElementById('new-chat-model-select') ? document.getElementById('new-chat-model-select').value : '',
                    temperature: document.getElementById('new-chat-api-temp') ? document.getElementById('new-chat-api-temp').value : ''
                }
			};

			characters.push(newCharacter);
			saveCharactersToLocal();
			clearNewChatForm();
			switchPage('chat-page');
			switchTopBar('chat-top');
			renderChatList();
		});

        
		// ============================================================
		// 【7.3 对话列表卡片操作 (新版：使用下拉菜单)】
		// ============================================================
		const chatCardMenu = document.getElementById('chat-card-action-menu');
		let currentMenuChatId = null;

		// --- 1. 点击省略号按钮，显示并定位菜单 ---
		document.getElementById('chat-list-container').addEventListener('click', (e) => {
			const actionBtn = e.target.closest('.chat-actions-btn');
			const chatCard = e.target.closest('.chat-card');

			if (actionBtn) {
				e.stopPropagation(); // 阻止事件冒泡到卡片上
				currentMenuChatId = actionBtn.dataset.characterId;
				
				// 动态修改菜单文字（置顶/取消置顶）
				const char = characters.find(c => c.id === currentMenuChatId);
				const pinTextEl = chatCardMenu.querySelector('.pin-text');
				if (char && pinTextEl) {
					pinTextEl.textContent = char.isPinned ? '取消置顶' : '置顶对话';
				}

				// 计算菜单位置
				const btnRect = actionBtn.getBoundingClientRect();
				chatCardMenu.style.display = 'block';
				// 菜单定位：通常在按钮下方，靠右对齐
				chatCardMenu.style.top = `${btnRect.bottom + window.scrollY + 5}px`;
				chatCardMenu.style.left = `${btnRect.right - chatCardMenu.offsetWidth}px`;

			} else if (chatCard) {
				// 点击卡片本身，进入聊天
				enterChat(chatCard.dataset.characterId);
			}
		});

		// --- 2. 点击菜单项，执行操作 ---
		chatCardMenu.addEventListener('click', (e) => {
			const menuItem = e.target.closest('.chat-menu-item');
			if (!menuItem || !currentMenuChatId) return;

			const action = menuItem.dataset.action;
			const charIndex = characters.findIndex(c => c.id === currentMenuChatId);
			if (charIndex === -1) return;

			if (action === 'pin') {
				// 切换置顶状态
				characters[charIndex].isPinned = !characters[charIndex].isPinned;
				saveCharactersToLocal();
				renderChatList(); // 重新渲染列表以更新排序和样式
			} 
			else if (action === 'delete') {
				if (confirm('确定要删除这个对话吗？此操作无法撤销。')) {
					characters.splice(charIndex, 1); // 从数组中移除
					saveCharactersToLocal();
					renderChatList(); // 重新渲染列表
				}
			}

			// 操作完成后隐藏菜单
			chatCardMenu.style.display = 'none';
			currentMenuChatId = null;
		});

		// --- 3. 点击页面其他地方，隐藏菜单 ---
		document.addEventListener('click', (e) => {
			// 如果菜单是显示的，并且点击的目标不是菜单本身
			if (chatCardMenu.style.display === 'block' && !chatCardMenu.contains(e.target)) {
				chatCardMenu.style.display = 'none';
				currentMenuChatId = null;
			}
		});
				
		// ============================================================
        // 【新增功能】聊天详情页逻辑
        // ============================================================
        
        // 1. 获取DOM元素
        const chatDetailTop = document.getElementById('chat-detail-top');
        const chatInputBar = document.getElementById('chat-input-bar');
        const chatDetailTitle = document.getElementById('chat-detail-title');
        const chatTargetName = document.getElementById('chat-target-name');
        const chatMenuDropdown = document.getElementById('chat-menu-dropdown');

       
		// --- 进入聊天界面 (最终版：支持状态恢复) ---
		// ============================================================
		// 【最终精简版】进入聊天界面
		// （配合 CSS 占位符使用，无需复杂的 JS 图片监听）
		// ============================================================
		function enterChat(characterId) {
			const char = characters.find(c => c.id == characterId);
			if (!char) return;

			activeChatId = characterId;

			// 获取当前角色的模式
			const currentMode = (typeof char.isOnline !== 'undefined') ? char.isOnline : true;

			 // 加载背景图 (修改版：调用 StyleManager 或手动应用到 Body)
            const contentArea = document.getElementById('main-content-area');
            const chatPage = document.getElementById('chat-detail-page');

            // 1. 先将内容区域透明化，防止遮挡
            if (contentArea) contentArea.style.background = 'transparent';
            if (chatPage) chatPage.style.background = 'transparent';

            // 2. 调用 StyleManager 进行背景判断和渲染
            if (typeof StyleManager !== 'undefined') {
                // 强制稍微延迟一下以确保 DOM 切换完成，或者直接调用
                requestAnimationFrame(() => {
                    StyleManager.checkBg();
                });
            } else {
                // 降级处理：如果没有 StyleManager，手动处理
                // (此处保留原有的降级逻辑，但改为应用到 body)
                if (char.backgroundImage && char.backgroundImage.trim() !== '') {
                    document.body.style.backgroundImage = `url('${char.backgroundImage}')`;
                    document.body.style.backgroundSize = 'cover';
                    document.body.style.backgroundAttachment = 'fixed';
                } else {
                    document.body.style.backgroundImage = '';
                    if (contentArea) contentArea.style.background = ''; // 恢复默认
                }
            }

			// 清除未读消息标记
			if (char.chatHistory && char.chatHistory.length > 0) {
				char.chatHistory.forEach(msg => {
					msg.isRead = true;
				});
				saveCharactersToLocal();
			}
			// 【新增】进入聊天时初始化拉黑按钮文本，并更新输入框状态
			const blockBtn = document.getElementById('menu-block-user-btn');
			const delayBtn = document.getElementById('delay-toggle-btn');
			const giftListBtn = document.getElementById('menu-gift-list-btn');
			if (blockBtn) {
				if (char.type === 'group') {
					blockBtn.style.display = 'none'; // 群聊隐藏拉黑
					if (delayBtn) delayBtn.style.display = 'none'; // 群聊隐藏模拟打字延时
					if (giftListBtn) giftListBtn.style.display = 'none'; // 群聊隐藏礼物清单
				} else {
					blockBtn.style.display = '';
					document.getElementById('block-btn-text').textContent = char.isBlockedByUser ? '解除拉黑' : '拉黑对方';
					if (delayBtn) delayBtn.style.display = 'flex'; // 私聊显示模拟打字延时
					if (giftListBtn) giftListBtn.style.display = ''; // 私聊显示礼物清单
				}
			}
			updateChatInputState();
			// 更新UI
			document.getElementById('chat-detail-title').textContent = char.name;
			const statusEl = document.getElementById('chat-detail-status');

			// 【核心修复】恢复精确的后台进度状态
			if (characterTypingStatus[characterId]) {
				// 兼容处理：如果是旧的 true，显示默认；如果是字符串，显示具体进度
				statusEl.textContent = characterTypingStatus[characterId] === true ? "消息传输中…" : characterTypingStatus[characterId];
			} else {
				// 恢复常驻状态
				statusEl.textContent = getChatPermanentStatus(char);
			}

			if (chatTargetName) chatTargetName.textContent = char.name;

			// 准备容器
			const msgContainer = document.getElementById('chat-message-container');
			const scrollContainer = document.getElementById('main-content-area');

			// 先隐藏，防止渲染过程中的闪烁
			scrollContainer.style.opacity = '0'; 
			msgContainer.classList.remove('animating');
			msgContainer.style.transform = 'translateY(0)';

			msgContainer.innerHTML = '';
			currentRenderedCount = 0;
			
			if (char.chatHistory && char.chatHistory.length > 0) {
				lastMessageTimestamp = char.chatHistory[char.chatHistory.length - 1].timestamp;
				loadHistoryBatch(true);
			} else {
				lastMessageTimestamp = 0;
				msgContainer.innerHTML = '<div style="text-align: center; color: #999; margin: 20px; font-size: 12px;">与 ' + char.name + ' 的加密对话</div>';
			}

			// 切换页面
			pages.forEach(p => p.classList.remove('active'));
			document.getElementById('chat-detail-page').classList.add('active');

			bottomNav.style.display = 'none';
			chatInputBar.style.display = 'flex';
			contentArea.classList.add('no-bottom-nav');
			switchTopBar('chat-detail-top');

			initPullToRefresh();

			// ----------------------------------------------------------
			// 【核心修改】只保留最简单的滚动逻辑
			// ----------------------------------------------------------
			// 既然已经有占位符了，不需要监听图片加载，直接滚到底部即可
			requestAnimationFrame(() => {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
				
				// 显示页面（利用透明度渐变让体验更丝滑）
				requestAnimationFrame(() => {
					scrollContainer.style.opacity = '1';
				});
			});

			// 恢复 UI 状态
			const modeCheckbox = document.getElementById('mode-checkbox');
			if (modeCheckbox) {
				modeCheckbox.checked = currentMode;
				const modeText = document.getElementById('mode-text');
				const modeIcon = document.getElementById('mode-icon');
				if (currentMode) {
					if (modeText) modeText.textContent = "线上模式";
					if (modeIcon) { modeIcon.className = "fas fa-comments"; modeIcon.style.color = "#07c160"; }
				} else {
					if (modeText) modeText.textContent = "线下模式";
					if (modeIcon) { modeIcon.className = "fas fa-book-open"; modeIcon.style.color = "#ff9800"; }
				}
			}

			const delayCheckbox = document.getElementById('delay-checkbox');
			if (delayCheckbox) {
				delayCheckbox.checked = (typeof char.enableTypingDelay !== 'undefined') ? char.enableTypingDelay : true;
			}

			renderChatList();
		}
		
		
		// ============================================================
		// 【下拉加载交互逻辑 (最终增强版：完美支持滚轮、拖拽、点击)】
		// ============================================================

		let pullStartY = 0;
		let isPulling = false;
		const PULL_THRESHOLD = 60; // 降低阈值，更容易触发

		// --- A. 处理拖动开始 ---
		function handlePullStart(yPosition, eventTarget) {
			const scrollContainer = document.getElementById('main-content-area');
			const msgContainer = document.getElementById('chat-message-container');
			
			// 只有在顶部且当前没有在加载时，才激活
			if (scrollContainer.scrollTop <= 0 && !isLoadingHistory) {
				pullStartY = yPosition;
				isPulling = true;
				msgContainer.classList.remove('animating');
			} else {
				isPulling = false;
			}
		}

		// --- B. 处理拖动过程 ---
		function handlePullMove(yPosition, event) {
			if (!isPulling) return;
            if (isLoadingHistory) { isPulling = false; return; } // 如果正在加载，禁止拖动

			const scrollContainer = document.getElementById('main-content-area');
			const msgContainer = document.getElementById('chat-message-container');
			const deltaY = yPosition - pullStartY;

			if (deltaY > 0 && scrollContainer.scrollTop <= 0) {
				// 阻止默认行为（特别是触摸滚动）
				if (event.cancelable && event.type === 'touchmove') event.preventDefault();

				// 增加阻尼感，拖得越远越难拖
				const translateY = Math.min(deltaY * 0.4, 150); 
				msgContainer.style.transform = `translateY(${translateY}px)`;

				const loaderText = document.querySelector('#history-loader span');
				if (loaderText) {
					if (translateY > PULL_THRESHOLD) {
						loaderText.innerHTML = '<i class="fas fa-arrow-up"></i> 松手加载';
                        loaderText.style.color = '#07c160'; // 提示色变绿
					} else {
						loaderText.innerHTML = '<i class="fas fa-arrow-down"></i> 下拉加载...';
                        loaderText.style.color = '#999';
					}
				}
			} else {
				// 如果用户反向拖动，则重置
				pullStartY = yPosition;
			}
		}

		// --- C. 处理拖动结束 ---
		function handlePullEnd() {
			if (!isPulling) return;
			isPulling = false;

			const msgContainer = document.getElementById('chat-message-container');
            const loaderText = document.querySelector('#history-loader span');
            
            // 获取当前的位移量
			const transformStr = msgContainer.style.transform;
			const match = transformStr.match(/translateY\(([\d.]+)px\)/);
			const currentTranslate = match ? parseFloat(match[1]) : 0;

			msgContainer.classList.add('animating'); // 开启回弹动画
			msgContainer.style.transform = 'translateY(0)'; // 无论如何都回弹归位
            
            if(loaderText) loaderText.style.color = '#999'; // 恢复颜色

            // 只有拉动距离足够，且当前不在加载中，才触发加载
			if (currentTranslate > PULL_THRESHOLD && !isLoadingHistory) {
                loadHistoryBatch(); // 直接调用加载函数
			}
		}

		// --- D. 处理鼠标滚轮 (增强版) ---
		function handleWheelScroll(event) {
			const scrollContainer = document.getElementById('main-content-area');
			
			// 1. 只有当滚动条在最顶部
			// 2. 且滚轮是向上滚 (deltaY < 0)
            // 3. 且当前没有在加载历史记录 (关键！)
			if (scrollContainer.scrollTop === 0 && event.deltaY < 0 && !isLoadingHistory) {
                // 找到加载器元素，确认还有历史记录可加载
                const loader = document.getElementById('history-loader');
                if (loader) {
                    // 触发加载
				    loadHistoryBatch();
                }
			}
		}

		// --- 2. 初始化事件绑定 ---
		function initPullToRefresh() {
			const scrollContainer = document.getElementById('main-content-area');

			// 清除可能存在的旧事件
			scrollContainer.ontouchstart = null;
			scrollContainer.ontouchmove = null;
			scrollContainer.ontouchend = null;
			scrollContainer.onmousedown = null;
			window.onmousemove = null;
			window.onmouseup = null;

			// A. 绑定触摸事件
			scrollContainer.addEventListener('touchstart', (e) => handlePullStart(e.touches[0].clientY, e.target));
			scrollContainer.addEventListener('touchmove', (e) => handlePullMove(e.touches[0].clientY, e), { passive: false });
			scrollContainer.addEventListener('touchend', handlePullEnd);

			// B. 绑定鼠标拖拽事件
			scrollContainer.addEventListener('mousedown', (e) => handlePullStart(e.clientY, e.target));
			window.addEventListener('mousemove', (e) => handlePullMove(e.clientY, e));
			window.addEventListener('mouseup', handlePullEnd);
			
			// C. 绑定鼠标滚轮事件
			scrollContainer.addEventListener('wheel', handleWheelScroll, { passive: false });
		}

       // 退出聊天界面的函数
        function exitChat() {
            // 【新增修复逻辑】
            // 如果当前处于批量删除模式，先强制关闭该模式
            // 这会自动隐藏底部批量操作栏，并重置选中状态
            if (typeof isBatchMode !== 'undefined' && isBatchMode) {
                toggleBatchMode(false);
            }

            activeChatId = null;
            chatMenuDropdown.classList.remove('show');
			// ==========================================
			// 【核心修复】强制关闭底部面板
			// ==========================================
			
			// 1. 关闭表情面板
			const emoPicker = document.getElementById('emoticon-picker-modal');
			if (emoPicker) emoPicker.classList.remove('show');

			// 2. 关闭功能面板 (+)
			const funcPanel = document.getElementById('function-panel-modal');
			if (funcPanel) funcPanel.classList.remove('show');
			
             // 退出时重置背景 (修改版：清理 Body 背景)
            const contentArea = document.getElementById('main-content-area');
            const chatPage = document.getElementById('chat-detail-page');

            // 1. 清除 Body 上的全屏背景
            document.body.style.backgroundImage = '';
            
            // 2. 恢复容器的默认背景 (移除 transparent)
            if (contentArea) {
                contentArea.style.background = ''; 
                contentArea.style.top = '0px'; // 保持原有的位置重置逻辑
            }
            if (chatPage) {
                chatPage.style.background = '';
            }

            // 3. 如果 StyleManager 存在，让它重新检查一次 (它会发现当前不是 chat page 而清理)
            if (typeof StyleManager !== 'undefined') {
                StyleManager.checkBg();
            }
            // 返回列表页
            switchPage('chat-page');
            switchTopBar('chat-top');
            
            // 【关键】恢复主导航，隐藏聊天输入栏
            // 注意：虽然 toggleBatchMode(false) 可能会把输入栏显示出来，
            // 但这里紧接着执行了 display = 'none'，所以视觉上不会有闪烁
            if (chatInputBar) chatInputBar.style.display = 'none';
            
            bottomNav.classList.remove('hidden');
            bottomNav.style.display = 'flex';
            contentArea.classList.remove('no-bottom-nav');
			
			// ============================================================
            // 【新增】退出时刷新列表
            // 确保刚才在聊天里的操作（编辑最后一条消息、删除消息等）能立即体现在列表卡片上
            // ============================================================
            renderChatList();
        }

        // 事件监听
        // 返回按钮
        document.getElementById('chat-back-btn').addEventListener('click', exitChat);

		

        // 右上角菜单按钮
        document.getElementById('chat-menu-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止冒泡
            chatMenuDropdown.classList.toggle('show');
        });

        // 点击页面其他地方关闭菜单
        document.addEventListener('click', (e) => {
            // 关闭聊天详情页菜单
            const btn = document.getElementById('chat-menu-btn');
            if (chatMenuDropdown.classList.contains('show') && e.target !== btn && !chatMenuDropdown.contains(e.target)) {
                chatMenuDropdown.classList.remove('show');
            }
            
            // 关闭主页 + 号下拉菜单
            const mainAddMenuDropdown = document.getElementById('main-add-menu-dropdown');
            const addChatBtn = document.getElementById('add-chat-btn');
            if (mainAddMenuDropdown && mainAddMenuDropdown.classList.contains('show')) {
                if ((!addChatBtn || !addChatBtn.contains(e.target)) && !mainAddMenuDropdown.contains(e.target)) {
                    mainAddMenuDropdown.classList.remove('show');
                }
            }
        });

        // ============================================================
		// 【底部输入栏事件绑定 (最终版)】
		// ============================================================

		// 【修改版】发送逻辑 (集成小红书分享检测)
		function handleSendMessage(event) {
			if (event) event.preventDefault();

			const input = document.querySelector('.chat-bar-input');
			const text = input.value.trim();
			if (!text) return;
			
			// 1. 保存并渲染用户发送的原始消息
			saveAndRenderMessage(text, 'sent');
			
			// 2. 清空输入框并【重置高度】
			input.value = '';
			input.style.height = '36px'; 
			updateChatBottomPadding();   
			setTimeout(() => scrollToBottom(), 50); 
			input.focus();

			// 3. 【修复逻辑】检测是否包含小红书链接 (精确匹配字符)
			const xhsRegex = /(https?:\/\/xhslink\.com\/[a-zA-Z0-9\/]+)/i;
			const xhsMatch = text.match(xhsRegex);
			
			if (xhsMatch) {
				const xhsUrl = xhsMatch[1];
				const char = characters.find(c => c.id == activeChatId);
				const isOnline = char && (typeof char.isOnline !== 'undefined' ? char.isOnline : true);
				
				if (isOnline) {
					console.log("[XHS] 提取到干净链接：", xhsUrl);
					processXhsShare(xhsUrl);
				} else {
					handleAiGenerate(); 
				}
			}
		}
		
		// ============================================================
		// 【核心修复】输入框自适应 & 键盘遮挡处理
		// ============================================================

		const chatTextarea = document.querySelector('.chat-bar-input');
		const chatInputBarContainer = document.getElementById('chat-input-bar');
		const mainContent = document.getElementById('main-content-area');

		// 1. 输入框高度自适应函数
		function autoResizeTextarea() {
			if (!chatTextarea) return;
			
			// 先重置高度，以便准确计算 scrollHeight (处理删除文字的情况)
			chatTextarea.style.height = 'auto'; 
			
			// 计算新高度，最大不超过 120px (CSS中定义的 max-height)
			let newHeight = chatTextarea.scrollHeight;
			if (newHeight < 36) newHeight = 36; // 最小高度
			
			chatTextarea.style.height = newHeight + 'px';
			
			// 关键：输入框变高了，聊天记录列表的底部 Padding 也要变大
			// 否则最新的消息会被变高的输入框挡住
			updateChatBottomPadding();
		}

		// 2. 更新内容区域的底部内边距 (根据输入框当前实际高度)
		function updateChatBottomPadding() {
			if (!chatInputBarContainer || !mainContent) return;
			
			// 获取输入框容器的总高度
			const inputBarHeight = chatInputBarContainer.offsetHeight;
			
			// 给内容区域设置 padding-bottom，额外多留 10px 呼吸感
			// 注意：如果是 iPhone X 以上，safari 会自动处理 safe-area，这里通常只需要处理高度
			mainContent.style.paddingBottom = (inputBarHeight + 10) + 'px';
		}

		// 3. 绑定监听事件
		// 【修改后】的代码
		if (chatTextarea) {
			// 监听输入内容变化
			chatTextarea.addEventListener('input', () => {
				// 关键：在调整高度之前，先判断当前是否在底部
				const wasAtBottom = isScrolledToBottom();

				// 调整输入框高度
				autoResizeTextarea();

				// 只有当之前就在底部时，才在输入时自动滚动
				if (wasAtBottom) {
					scrollToBottom();
				}
			});

			// 监听获得焦点 (键盘弹出)
			chatTextarea.addEventListener('focus', () => {
				// 延时一下等待键盘完全弹出
				setTimeout(() => {
					scrollToBottom();
				}, 300);
			});
		}


		/**
		 * 【新增】检查滚动条是否接近底部的辅助函数
		 */
		function isScrolledToBottom() {
			if (!mainContent) return true; // 如果找不到容器，默认在底部以执行滚动

			const threshold = 50; // 容错阈值，50像素以内都算作底部
			// scrollTop: 滚动条距离顶部的距离
			// clientHeight: 容器可视区域的高度
			// scrollHeight: 容器内部内容的总高度
			// 当 (滚动距离 + 可视高度) >= (总高度 - 阈值) 时，说明就在底部
			return mainContent.scrollHeight - mainContent.scrollTop - mainContent.clientHeight < threshold;
		}

		// 【新增】监听 Visual Viewport 变化 (专门解决键盘弹出/收起时的位移)
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', () => {
				// 当视口大小改变（键盘弹起/收回）时
				const isChatPage = document.getElementById('chat-detail-page').classList.contains('active');
				
				// 【关键修复】只有当“底部输入框”确实处于聚焦状态时，才执行滚动
				// 这样能防止编辑历史消息（弹窗关闭导致键盘收起）时触发滚动
				const activeEl = document.activeElement;
				const isMainInputFocused = activeEl && activeEl.classList.contains('chat-bar-input');

				if (isChatPage && isMainInputFocused) {
					updateChatBottomPadding(); // 重新计算遮挡关系
					scrollToBottom();     // 滚到底部
				}
			});
		}
		// ============================================================
		// 【V6 结构修正版】小红书解析 (修复评论抓取 + 指纹去重 + 无限多图)
		// ============================================================
		async function processXhsShare(xhsUrl) {
			if (!activeChatId) return;
			const charId = activeChatId;
			const char = characters.find(c => c.id == charId);
			if (!char) return;

			updateChatStatus(charId, "正在越过高墙读取小红书...");
			console.log("[XHS] 开始解析小红书链接:", xhsUrl);

			try {
				// 1. 多重代理轮询机制
				const proxies =[
					`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(xhsUrl)}`,
					`https://api.allorigins.win/raw?url=${encodeURIComponent(xhsUrl)}`,
					`https://corsproxy.io/?${encodeURIComponent(xhsUrl)}`
				];

				let htmlString = "";
				for (let proxy of proxies) {
					try {
						console.log("[XHS] 尝试代理请求:", proxy);
						const response = await fetch(proxy);
						if (response.ok) {
							htmlString = await response.text();
							// 只要获取到的内容包含DOCTYPE或html标签，就认为成功
							if (htmlString && htmlString.length > 500) {
								console.log("[XHS] 代理请求成功，源码长度:", htmlString.length);
								break;
							}
						}
					} catch(e) {
						console.warn("[XHS] 当前代理失败，尝试下一个...");
					}
				}

				if (!htmlString || htmlString.length < 500) {
					throw new Error("所有代理服务器均被小红书拦截");
				}

				const parser = new DOMParser();
				const doc = parser.parseFromString(htmlString, "text/html");

				let noteText = "";
				let imgDesc = "";
				let commentsText = "暂无评论";

				// ==========================================
				// --- A. 提取正文 ---
				// ==========================================
				updateChatStatus(charId, "正在提取笔记正文...");
				const descNode = doc.querySelector('#detail-desc .note-text') || doc.querySelector('.note-text');
				if (descNode) {
					const cloneNode = descNode.cloneNode(true);
					cloneNode.querySelectorAll('.note-content-emoji, .tag').forEach(el => el.remove());
					noteText = cloneNode.textContent.trim();
				} 
				
				if (!noteText || noteText.length < 5) {
					const metaTitle = doc.querySelector('meta[property="og:title"]')?.content || doc.querySelector('title')?.textContent || "";
					const metaDesc = doc.querySelector('meta[name="description"]')?.content || doc.querySelector('meta[property="og:description"]')?.content || "";
					noteText = `${metaTitle}\n${metaDesc}`.trim();
				}

				if (!noteText || noteText.length < 5) {
					const jsonMatch = htmlString.match(/"desc":\s*"([^"]+)"/);
					if (jsonMatch && jsonMatch[1]) noteText = jsonMatch[1].replace(/\\n/g, '\n');
				}

				if (!noteText) noteText = "内容可能被作者隐藏或包含敏感词";


				// ==========================================
				// --- B. 提取图片 (指纹去重) ---
				// ==========================================
				updateChatStatus(charId, "正在搜索并过滤重复图片...");
				let rawImgUrls =[];

				doc.querySelectorAll('.note-slider-img img').forEach(img => {
					if (img.src) rawImgUrls.push(img.src);
				});

				if (rawImgUrls.length === 0) {
					const imgRegex = /https?:\/\/sns-[a-zA-Z0-9-]+\.xhscdn\.com\/[^"'\s\\]+/g;
					const imgMatches = htmlString.match(imgRegex);
					if (imgMatches) {
						imgMatches.forEach(url => rawImgUrls.push(url.replace(/\\u002F/g, '/')));
					}
				}

				if (rawImgUrls.length === 0) {
					const metaImg = doc.querySelector('meta[property="og:image"]')?.content;
					if (metaImg) rawImgUrls.push(metaImg);
				}

				let finalImgUrls =[];
				let seenHashes = new Set();

				rawImgUrls.forEach(url => {
					if (url.endsWith('.js') || url.endsWith('.css') || url.includes('/avatar/')) return;
					const hashMatch = url.match(/\/([a-zA-Z0-9]{20,})!/);
					const hash = hashMatch ? hashMatch[1] : url; 
					if (!seenHashes.has(hash)) {
						seenHashes.add(hash);
						finalImgUrls.push(url);
					}
				});

				if (finalImgUrls.length > 0) {
					console.log(`[XHS] 成功锁定 ${finalImgUrls.length} 张【不重复】图片:`, finalImgUrls);
					for (let i = 0; i < finalImgUrls.length; i++) {
						updateChatStatus(charId, `正在通过AI解析图片 (${i + 1}/${finalImgUrls.length})...`);
						try {
							const imgProxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(finalImgUrls[i])}&output=jpg&w=800`;
							const imgRes = await fetch(imgProxyUrl);
							if (!imgRes.ok) throw new Error("图像代理返回错误");
							
							const imgBlob = await imgRes.blob();
							if (imgBlob && imgBlob.size > 1000) { 
								const base64 = await new Promise((resolve) => {
									const reader = new FileReader();
									reader.onloadend = () => resolve(reader.result);
									reader.readAsDataURL(imgBlob);
								});
								
								const compressedImg = await compressImage(base64); 
								const singleImgDesc = await analyzeImage(compressedImg);
								imgDesc += `【图${i + 1}】: ${singleImgDesc}\n`;
								console.log(`[XHS] 图${i + 1} 识别成功`);
							}
						} catch (imgErr) {
							console.warn(`[XHS] 图${i + 1} 识别失败:`, imgErr);
							imgDesc += `【图${i + 1}】: 图片跨域下载失败\n`;
						}
					}
				} else {
					imgDesc = "未在页面源码中挖到有效的图片链接";
				}

				// ==========================================
				// --- C. 提取评论区 (DOM精准解析 + 源码暴破版) ---
				// ==========================================
				updateChatStatus(charId, "正在抓取评论区...");
				const commentsArr =[];
				
				// 方案1：基于真实 DOM 提取 (精准适配你提供的最新 HTML 结构)
				const commentCards = doc.querySelectorAll('.comment-item');

				if (commentCards.length > 0) {
					commentCards.forEach(card => {
						if (commentsArr.length >= 5) return; 

						// 1. 提取用户名
						const nameEl = card.querySelector('.author .name') || card.querySelector('.name');
						const name = nameEl ? nameEl.textContent.trim() : "匿名用户";

						// 2. 提取评论正文 (精准锁定 .note-text，完美避开外层的"回复"标签)
						const contentEl = card.querySelector('.content .note-text') || card.querySelector('.content');
						let content = "";

						if (contentEl) {
							const clone = contentEl.cloneNode(true);
							// 移除小红书内置表情包图片
							clone.querySelectorAll('.note-content-emoji').forEach(el => el.remove());
							content = clone.textContent.trim();
						}

						// 双重保险：去除残留的 " : " 或者 "回复："
						content = content.replace(/^[:：\s]+/, '').trim();
						content = content.replace(/^回复\s+.*?\s*[:：]/, '').trim();

						// 过滤掉系统自带的无用文本
						if (name && content && content.length > 1 && !content.includes("显示更多评论")) {
							const textStr = `${name}：${content}`;
							if (!commentsArr.includes(textStr)) {
								commentsArr.push(textStr);
							}
						}
					});
				} 
				
				// 方案2：如果代理返回的是未渲染的原始源码，启动底层 JSON 状态暴破提取
				if (commentsArr.length === 0) {
					console.log("[XHS] DOM 中未发现评论，尝试从底层数据中暴破提取...");
					try {
						// 1. 强制解码所有的 Unicode 中文字符 (\uXXXX) 并抹平换行符
						let decodedHtml = htmlString;
						try {
							decodedHtml = decodedHtml.replace(/\\u([0-9a-fA-F]{4})/g, (m, p1) => String.fromCharCode(parseInt(p1, 16)));
							decodedHtml = decodedHtml.replace(/\\n/g, ' '); 
						} catch(e) {}
						
						// 2. 匹配所有的 "content":"xxxxx" (放宽匹配长度到 500 字符，应对超长评论)
						const contentRegex = /"(?:content|text)"\s*:\s*"([^"]{2,500}?)"/g;
						let match;
						const blackList =['小红书', '显示更多', '回复', '相关推荐', '笔记', '发现', '登录', '关注'];
						
						while ((match = contentRegex.exec(decodedHtml)) !== null) {
							let content = match[1].replace(/\[.*?\]/g, '').trim();
							
							// 过滤无效文本
							if (content.length < 2 || blackList.includes(content)) continue;
							if (noteText && noteText.includes(content)) continue; // 排除正文本体

							// 3. 在 content 出现的位置【之前】300个字符内，寻找最近的一个 "nickname"
							const beforeStr = decodedHtml.substring(Math.max(0, match.index - 300), match.index);
							const nameMatches =[...beforeStr.matchAll(/"(?:nickname|name|userName)"\s*:\s*"([^"]{1,20}?)"/g)];
							
							let name = "网友";
							if (nameMatches.length > 0) {
								name = nameMatches[nameMatches.length - 1][1].trim(); // 取最近的一个
							}

							if (name && content) {
								const str = `${name}：${content}`;
								if (!commentsArr.includes(str)) commentsArr.push(str);
							}
							
							if (commentsArr.length >= 5) break;
						}
					} catch(e) {
						console.warn("[XHS] JSON 暴破提取失败", e);
					}
				}

				if (commentsArr.length > 0) {
					commentsText = commentsArr.slice(0, 5).join('\n');
					console.log("[XHS] 最终抓取到评论:", commentsArr);
				} else {
					console.warn("[XHS] 代理获取的源码中彻底不存在评论数据。原因：小红书使用了异步API加载评论。");
					commentsText = "暂无评论";
				}


				// ==========================================
				// --- D. 构建指令并注入后台 ---
				// ==========================================
				updateChatStatus(charId, "正在呼叫 AI...");
				
				const sysInstruction = `[系统动作：用户刚刚和你分享了一个小红书笔记。以下是你点开链接后看到的内容：

【笔记图片】(共${finalImgUrls.length}张):
${imgDesc}
【笔记正文】:
${noteText}
【精选评论区】:
${commentsText}

【特别行动指令与格式警告】
1. 请结合你的人设上下文，对用户分享的这篇笔记做出自然的反应（可吐槽正文、锐评图片或讨论评论区）。
2. ⚠️ 严禁警告：以上内容仅供你阅读参考。你在回复时，绝对禁止使用 "[REF:...]" 格式去引用上述系统动作里的任何原始文本！直接用自然聊天的语气给出你的看法即可。]`;

				const sysMsg = {
					text: sysInstruction,
					type: 'system',
					isHidden: true,
					isRead: true,
					timestamp: Date.now() + 10 
				};
				
				if (!char.chatHistory) char.chatHistory =[];
				char.chatHistory.push(sysMsg);
				saveCharactersToLocal();

				// --- E. 触发回复 ---
				updateChatStatus(charId, false); 
				handleAiGenerate(); 

			} catch (error) {
				console.error("[XHS 致命错误]:", error);
				updateChatStatus(charId, false);
				
				const failSysMsg = {
					text: `[系统动作：用户分享了一个小红书链接，但由于网络和反爬虫限制，你这边打不开。请告诉用户你打不开链接。⚠️ 严禁使用 [REF:...] 引用本条提示文本。]`,
					type: 'system',
					isHidden: true,
					isRead: true,
					timestamp: Date.now() + 10
				};
				char.chatHistory.push(failSysMsg);
				saveCharactersToLocal();
				handleAiGenerate();
			}
		}
		// ============================================================
		// 【最终调整版】处理 AI 生成 (支持后台传入角色ID)
		// ============================================================
		async function handleAiGenerate(targetCharId = null) {
			// 【修复1】防止点击事件的 Event 对象被误认为 targetCharId
			if (targetCharId instanceof Event) {
				targetCharId = null;
			}
			// 【修改】如果有传入 targetCharId，代表是后台主动触发；否则走普通点击
			const currentChatId = targetCharId || activeChatId;
			if (!currentChatId) { alert("请先进入一个对话"); return; }
			
			const char = characters.find(c => c.id == currentChatId);
			if (!char) return;
			
			// ============================================================
			// 【阶段一：识图预处理 (全量回溯)】
			// ============================================================
			if (char.chatHistory && char.chatHistory.length > 0) {
				const pendingImages = [];
				let i = char.chatHistory.length - 1;
				while (i >= 0) {
					const msg = char.chatHistory[i];
					if (msg.type === 'received') break;
					// 1. 判断是否是表情包 (表情包的文本固定格式为 [表情包：...])
					let isEmoticon = msg.text && msg.text.startsWith('[表情包：');
					if (!isEmoticon && msg.image && typeof emoticonList !== 'undefined') {
						// 如果文本没对上，再兜底查一下 URL
						const isKnownEmoticon = emoticonList.some(e => e.url === msg.image);
						if (isKnownEmoticon) {
							isEmoticon = true;
						}
					}
					// 2. 判断是否是虚拟图片 (虽然虚拟图片通常没有 image 属性，但为了保险也加上)
					const isVirtual = msg.isVirtual;
					// 3. 修改判断条件：排除表情包、排除虚拟图片
					if (msg.type === 'sent' && msg.image && !msg.imageDescription && !msg.isWithdrawn && !isEmoticon && !isVirtual) {
						pendingImages.unshift(msg);
					}

					i--;
				}

				if (pendingImages.length > 0) {
					for (let j = 0; j < pendingImages.length; j++) {
						const targetMsg = pendingImages[j];
						// 使用新函数精确更新状态
						updateChatStatus(currentChatId, `识图中 (${j + 1}/${pendingImages.length})...`);
						try {
							const compressedImage = await compressImage(targetMsg.image);
							const description = await analyzeImage(compressedImage);
							targetMsg.imageDescription = description;
							saveCharactersToLocal();
						} catch (error) {
							updateChatStatus(currentChatId, false); // 识图失败恢复常驻状态
							alert(`🚫 图片识别失败: ${error.message}`);
							return; 
						}
					}
				}
			}

			// 1. 设置初始状态：消息传输中
			updateChatStatus(currentChatId, "消息传输中…");
			
			// ★★★ 新增：标记 AI 开始回复，如果在后台则开始保活 ★★★
			isGlobalAiReplying = true;
			if (document.hidden && isAudioUnlocked) {
				silentAudio.play().catch(e => {});
			}
			
			try {
				// ============================================================
				// 【修改：根据角色类型调用不同的消息构建器】
				// ============================================================
				let messages = [];
				if (char.type === 'group') {
					messages = prepareGroupMessagesForApi(char);
				} else {
					messages = prepareMessagesForApi(char);
				}
				// ============================================================
				// ============================================================
                // 【新增逻辑】主动消息触发器 (Active Message Trigger)
                // ============================================================
                // 1. 获取最后一条历史消息
                const lastHistoryMsg = char.chatHistory.length > 0 ? char.chatHistory[char.chatHistory.length - 1] : null;

                // 2. 判断条件：
                // 如果没有历史记录 (新对话直接让AI开口) 
                // 或者 最后一条消息是 AI 发送的 (received)，说明用户本轮未发言
                if (!lastHistoryMsg || lastHistoryMsg.type === 'received') {
                    // 获取当前格式化时间戳，例如 【2023/10/01 12:00:00】
                    const currentTimestampStr = formatFullTime(Date.now());
                    
                    // 3. 向请求体追加临时的 User 消息
                    // 注意：这条消息只会发给 API，不会保存到 chatHistory 显示在界面上
                    messages.push({
                        role: "user", 
                        content: `${currentTimestampStr} 系统消息：请感知时间流逝，结合上下文和记忆，发送一条主动消息。`
                    });
                    
                    console.log("[Active Message] 触发主动消息模式:", messages[messages.length - 1].content);
                }
				//--- 核心修改：决定使用哪套 API 配置 ---
                // 默认使用全局 chatApiSettings
                let settingsToUse = chatApiSettings; 

                // 如果角色有专属配置，且 URL 和 Key 都不为空，则覆盖全局
                if (char.apiSettings && char.apiSettings.baseUrl && char.apiSettings.apiKey) {
                    settingsToUse = {
                        baseUrl: char.apiSettings.baseUrl,
                        apiKey: char.apiSettings.apiKey,
                        model: char.apiSettings.model || chatApiSettings.model, // 如果角色没选模型，回退全局模型
                        temperature: char.apiSettings.temperature || chatApiSettings.temperature
                    };
                    console.log("使用角色专属 API 配置");
                }
				// 将确定好的配置传入 callOpenAiApi (记得 callOpenAiApi 要支持第二个参数)
				let aiResponseText = await callOpenAiApi(messages, settingsToUse);
				// 【修复 5】收到文本后，第一时间全局提取礼物更新指令，防止被心声面板吞掉
				const updateGiftRegex = /\[UPDATE_GIFT:(.*?)\|(.*?)\]/g;
				let giftMatch;
				while ((giftMatch = updateGiftRegex.exec(aiResponseText)) !== null) {
					const targetGiftId = giftMatch[1].trim();
					const newStatus = giftMatch[2].trim();
					if (char.giftList) {
						const targetGift = char.giftList.find(g => g.id === targetGiftId);
						if (targetGift) {
							targetGift.status = newStatus;
							saveCharactersToLocal();
							console.log(`[AI 自动更新礼物] ${targetGift.name} 变更为: ${newStatus}`);
						}
					}
				}
				// 将指令从文本中彻底剔除，保证后续 JSON 解析和屏幕显示干净
				aiResponseText = aiResponseText.replace(/\[UPDATE_GIFT:.*?\|.*?\]/g, '').trim();
				const currentRoundId = 'round_' + Date.now(); 

				// ============================================
				// 【新增/修复】群聊消息解析逻辑 (防时间戳截断与指令误判)
				// ============================================
				if (char.type === 'group') {
					const isGroupOnline = (typeof char.isOnline !== 'undefined') ? char.isOnline : true;
					
					// 1. 分割消息 (支持 ### 或 换行+名字)
					// 直接使用最原始的 aiResponseText，在循环内部逐个击破！
					let bubbles = aiResponseText.split(/###|\n(?=.+[:：])/);

					let lastSpeakerName = '系统/旁白';
					let lastSpeakerAvatar = '';
					let globalMsgCounter = 0; 
					const baseTime = Date.now();
					for (let rawBubble of bubbles) {
						rawBubble = rawBubble.trim();
						if (!rawBubble) continue;

						// 先去除可能误输出的时间戳
						rawBubble = removeTimestamp(rawBubble).trim();
						if (!rawBubble) continue;

						// ==========================================
						// 【核心防御】单气泡内独立拦截并保存人生档案
						// ==========================================
						if (rawBubble.includes('NN_LIFE_EVENT')) {
							const lifeEventRegex = /NN_LIFE_EVENT[:：\s]*(\{[\s\S]*?\})/;
							const matchLife = rawBubble.match(lifeEventRegex);
							if (matchLife) {
								try {
									const lifeEventData = JSON.parse(matchLife[1].trim());
									if (lifeEventData && lifeEventData.event) {
										const now = new Date();
										const yy = now.getFullYear().toString().slice(-2);
										const mm = (now.getMonth() + 1).toString().padStart(2, '0');
										const dd = now.getDate().toString().padStart(2, '0');
										const formattedDate = `${yy}/${mm}/${dd}`;

										if (!char.lifeEvents) char.lifeEvents =[];
										// 防止重复记录（简单查重）
										const isDup = char.lifeEvents.some(e => e.event === lifeEventData.event);
										if (!isDup) {
											char.lifeEvents.push({ date: formattedDate, event: lifeEventData.event });
											saveCharactersToLocal();
											console.log(`[Group Life Event] 记录成功: ${lifeEventData.event}`);
										}
									}
								} catch (e) {
									console.error("解析气泡内人生档案失败", e);
								}
							}
							// 物理抹除：将该指令及其后所有的内容从本气泡中彻底删除！
							rawBubble = rawBubble.replace(/NN_LIFE_EVENT[\s\S]*/, '').trim();
						}

						// 如果群聊中混入了私聊特有的内心状态，也一并切掉防止乱码
						if (rawBubble.includes('NN_INNER_STATUS')) {
							rawBubble = rawBubble.replace(/NN_INNER_STATUS[\s\S]*/, '').trim();
						}

						// 抹除后如果气泡空了（说明这整条消息纯粹是后台指令），直接跳过！
						if (!rawBubble) continue; 
						// ==========================================

						// 2. 尝试分离名字和内容
						let speakerName = lastSpeakerName;
						let speakerAvatar = lastSpeakerAvatar;
						let content = rawBubble;

						const nameMatch = rawBubble.match(/^([^\[\]:：\n]{1,30})[:：]([\s\S]*)/);
						
						if (nameMatch) {
							speakerName = nameMatch[1].trim();
							content = nameMatch[2].trim(); 
                            
                            // 【终极防呆】如果提取出来的名字还是奇奇怪怪的系统词，强制抛弃
                            if (speakerName.includes('NN_') || speakerName.includes('EVENT') || speakerName.includes('STATUS')) {
                                continue;
                            }

							// 3. 查找头像
							const existingMember = char.members.find(m => m.type === 'existing' && characters.find(c => c.id === m.id)?.name === speakerName);
							if (existingMember) {
								const realChar = characters.find(c => c.id === existingMember.id);
								if(realChar) speakerAvatar = realChar.avatar;
							} else {
								const npcMember = char.members.find(m => m.type === 'npc' && m.data.name === speakerName);
								if(npcMember) speakerAvatar = npcMember.data.avatar;
							}

							// 更新历史说话人
							lastSpeakerName = speakerName;
							lastSpeakerAvatar = speakerAvatar;
						}

						// --------------------------------------------
						// 【解析】群聊特殊指令解析 (转账/图片/语音/撤回)
						// 注意：所有的指令解析都必须在内容(content)里进行
						// --------------------------------------------

						// A. 解析：AI 主动发送红包/转账
						const sendPayRegex = /\[(SEND_TRANSFER|SEND_REDPACKET)[:：](.*?)\|(.*?)\]/g;
						let sendMatch;
						while ((sendMatch = sendPayRegex.exec(content)) !== null) {
							const pType = sendMatch[1] === 'SEND_TRANSFER' ? 'transfer' : 'redpacket';
							const pAmount = parseFloat(sendMatch[2]);
							const pDesc = sendMatch[3].trim();
							if (!isNaN(pAmount)) {
								// 增加一点发送延迟，看起来更真实，同时保证 timestamp 唯一
								await new Promise(resolve => setTimeout(resolve, 800));
								const msgTs = baseTime + (globalMsgCounter++); 
								// 【核心修复】不调用全局单聊函数，手动构建群聊专属的红包消息对象
								const paymentMsg = {
									text: `[${pType === 'transfer' ? '转账' : '红包'}：${pAmount}元]`,
									type: 'received',
									timestamp:  msgTs,
									groupId: 'pay_' + msgTs,
									isRead: activeChatId === char.id,
									isGroupMsg: true,              // 标记为群消息
									senderName: speakerName,       // 【关键】附带当前说话人的名字
									senderAvatar: speakerAvatar,   // 【关键】附带当前说话人的头像
									isPayment: true,
									paymentType: pType,
									amount: pAmount,
									paymentDesc: pDesc,
									paymentState: 'pending', 
									paymentId: 'pay_' + Date.now() + Math.random().toString(36).substr(2, 5)
								};
								
								// 存入历史记录并渲染
								char.chatHistory.push(paymentMsg);
								saveCharactersToLocal();
								
								if (activeChatId === char.id) {
									renderMessageToScreen(paymentMsg);
									scrollToBottom();
								}
							}
						}
						// 剥离指令，防止将指令本身当成文本发出来
						content = content.replace(/\[(SEND_TRANSFER|SEND_REDPACKET)[:：].*?\|.*?\]/g, '').trim();
						
						// B. 解析：AI 接收/拒绝用户的红包
						const actionPayRegex = /\[(ACCEPT_PAY|REJECT_PAY)[:：](.*?)\]/g;
						let actionMatch;
						while ((actionMatch = actionPayRegex.exec(content)) !== null) {
							const actionType = actionMatch[1];
							const payId = actionMatch[2].trim();
							window.processAiPaymentAction(currentChatId, payId, actionType);
						}
						// 【新增】处理 AI 更新礼物状态的指令
						const updateGiftRegex = /\[UPDATE_GIFT:(.*?)\|(.*?)\]/g;
						let giftMatch;
						while ((giftMatch = updateGiftRegex.exec(content)) !== null) {
							const targetGiftId = giftMatch[1].trim();
							const newStatus = giftMatch[2].trim();
							
							const targetGift = char.giftList.find(g => g.id === targetGiftId);
							if (targetGift) {
								targetGift.status = newStatus;
								saveCharactersToLocal();
								console.log(`[AI 自动更新礼物] ${targetGift.name} 状态变更为: ${newStatus}`);
							}
						}
						// 从发送给用户的文本中剥离该后台指令
						content = content.replace(/\[UPDATE_GIFT:.*?\|.*?\]/g, '').trim();
						// 剥离指令
						content = content.replace(/\[(ACCEPT_PAY|REJECT_PAY)[:：].*?\]/g, '').trim();

						// 【核心防呆】如果所有内容(比如指令)都被正则匹配剥离光了，不再生成空文本气泡！
						if (!content) continue;
						
						// C. 解析：引用(REF)、撤回
						let isWithdrawn = false;
						let aiQuoteData = null; 

						// 提前提取引用内容
						const refMatch = content.match(/^\[REF:(.*?)\]\s*(.*)/s);
						if (refMatch) {
							const quotedText = refMatch[1].trim();
							let quotedName = "原消息"; // 默认兜底
							let quotedMsgId = null; // 【新增】

							// 反向遍历历史记录，精准匹配这句话是谁说的
							if (char.chatHistory && char.chatHistory.length > 0) {
								// 从最新消息往上找，找到最近的包含这段文本的消息
								for (let k = char.chatHistory.length - 1; k >= 0; k--) {
									const hMsg = char.chatHistory[k];
									if (hMsg.text && hMsg.text.includes(quotedText)) {
										quotedMsgId = hMsg.timestamp; // 【新增】反向找出原消息的 ID
										if (hMsg.type === 'sent') {
											// 如果是用户发的，提取用户专用名或全局名
											quotedName = (char.userName && char.userName.trim()) ? char.userName.trim() : (userInfo.name || "用户");
										} else {
											// 如果是群员发的，提取具体的发送者名字
											quotedName = hMsg.senderName || "某群成员";
										}
										break;
									}
								}
							}

							aiQuoteData = {
								name: quotedName, 
								text: quotedText,
								originalMsgId: quotedMsgId // 【新增】
							};
							content = refMatch[2].trim();
						}

						// 提取撤回标记
						if (content.startsWith('[WITHDRAW]')) {
							isWithdrawn = true;
							content = content.replace(/^\[WITHDRAW\]\s*/, '').trim();
						}
						
						// D. 拦截群聊暂不支持的视频请求
						if (content.includes('[VIDEO_CALL_REQUEST]') || content.includes('[VOICE_CALL_REQUEST]')) {
							continue;
						}

						// 【核心修复】：引入 tokenRegex，支持群聊内的气泡切分（表情包、图片、文字混排分离）
						const tokenRegex = /(\[(?:表情包|图片|文件)：[\s\S]*?\])/g;
						const parts = content.split(tokenRegex);

						for (let j = 0; j < parts.length; j++) {
							let partText = parts[j].trim();
							if (!partText) continue;

							let isVirtual = false;
							let isVoice = false;
							let voiceDuration = 0;
							let finalImageUrl = null;

							// 1. 拦截解析：真实表情包
							const emoMatch = partText.match(/^\[表情包：([\s\S]*?)\]$/);
							if (emoMatch) {
								const desc = emoMatch[1];
								if (typeof emoticonList !== 'undefined') {
									const found = emoticonList.slice().reverse().find(e => e.description === desc);
									if (found) finalImageUrl = found.url;
								}
							}

							// 2. 拦截解析：虚拟图片
							const imgMatch = partText.match(/^\[图片：([\s\S]*?)\]$/);
							if (imgMatch) {
								partText = imgMatch[1];
								isVirtual = true;
							}

							// 3. 拦截解析：语音
							const voiceMatch = partText.match(/^\[语音：(.*?)\]$/);
							if (voiceMatch) {
								partText = voiceMatch[1];
								isVoice = true;
								voiceDuration = Math.max(2, Math.min(60, Math.ceil(partText.length / 3)));
							}

							// 4. 将切分后的子气泡存入渲染
							const uniqueTs = baseTime + (globalMsgCounter++); 
							const newMsg = {
								text: partText,
								type: 'received',
								timestamp:  uniqueTs, 
								groupId: currentRoundId,
								isRead: activeChatId === char.id,
								isGroupMsg: true,
								senderName: speakerName,
								senderAvatar: speakerAvatar,
								isVirtual: isVirtual,
								isVoice: isVoice,
								voiceDuration: voiceDuration,
								image: finalImageUrl,
								// 引用只附着在切分出的第一个气泡上
								quote: j === 0 ? aiQuoteData : null, 
								isWithdrawn: false 
							};
							
							char.chatHistory.push(newMsg);
							saveCharactersToLocal();

							if (activeChatId === char.id) {
								renderMessageToScreen(newMsg);
								scrollToBottom();
							}

							// 如果该条大消息带有撤回标记，所有拆分出来的子气泡都延迟撤回
							if (isWithdrawn) {
								const regretDelay = 500 + Math.random() * 1500;
								setTimeout(() => {
									performAiWithdrawalAction(char.id, newMsg.timestamp);
								}, regretDelay);
							}
						}
					}			
					
					// 结束群聊逻辑，退出函数
					characterTypingStatus[currentChatId] = false;
					const statusEl = document.getElementById('chat-detail-status');
					if (statusEl && activeChatId === currentChatId) {
						statusEl.textContent = getChatPermanentStatus(char); // 恢复常驻状态
					}
					// 【核心修复1】将群聊的对话计入记忆积压，并触发总结判定
					if (!char.msgCountSinceSummary) char.msgCountSinceSummary = 0;
					char.msgCountSinceSummary += 1;
					saveCharactersToLocal();
					triggerLongTermMemoryUpdate(char);
					return;
				}
					
			
				// ============================================
				// 【核心修复】智能解析多层级数据 (心声 + 人生档案)
				// ============================================
				// 【提前解析拉黑指令，防止被截断】
				let willBlockUser = false;
				let willUnblockUser = false;

				if (aiResponseText.includes('[BLOCK_USER]')) {
					willBlockUser = true;
					aiResponseText = aiResponseText.replace(/\[BLOCK_USER\]/g, '').trim();
				}
				if (aiResponseText.includes('[UNBLOCK_USER]')) {
					willUnblockUser = true;
					aiResponseText = aiResponseText.replace(/\[UNBLOCK_USER\]/g, '').trim();
				}

				let cleanResponse = aiResponseText;
				
				// 定义标记
				const statusPrefix = 'NN_INNER_STATUS::';
				const lifeEventPrefix = 'NN_LIFE_EVENT::';

				// 1. 在原始文本中查找位置
				const statusIndex = aiResponseText.lastIndexOf(statusPrefix);
				const lifeEventIndex = aiResponseText.lastIndexOf(lifeEventPrefix);

				// 用于确定截断位置的索引（取出现的第一个标记的位置）
				let cutOffIndex = aiResponseText.length;

				// --- A. 解析心声面板 ---
				if (statusIndex !== -1) {
					// 标记截断位置
					if (statusIndex < cutOffIndex) cutOffIndex = statusIndex;

					// 提取 JSON (从标记开始，直到遇到换行或下一个标记或文本结束)
					// 这里我们简单的截取到行尾或下一个标记前
					let jsonString = aiResponseText.substring(statusIndex + statusPrefix.length);
					
					// 如果后面还有 Life Event，说明心声 JSON 在中间，需要截断
					if (lifeEventIndex > statusIndex) {
						jsonString = aiResponseText.substring(statusIndex + statusPrefix.length, lifeEventIndex).trim();
					}

					try {
						const innerStatus = JSON.parse(jsonString);
						if (innerStatus) {
							char.lastKnownStatus = innerStatus; 
							saveCharactersToLocal();
						}
					} catch (e) {
						console.error("解析内心状态JSON失败, 尝试宽松解析:", e);
						// 容错：有时候 AI 会在 JSON 后加换行，简单的 parse 可能会挂，这里通常不需要太复杂的处理，因为 trim() 解决了大部分问题
					}
				}

				// --- B. 解析人生档案 ---
				if (lifeEventIndex !== -1) {
					// 标记截断位置 (如果 Life Event 竟然跑到了 Status 前面，也需要截断)
					if (lifeEventIndex < cutOffIndex) cutOffIndex = lifeEventIndex;

					const jsonString = aiResponseText.substring(lifeEventIndex + lifeEventPrefix.length).trim();
					try {
						const lifeEventData = JSON.parse(jsonString);
						if (lifeEventData && lifeEventData.event) {
							// 获取日期逻辑...
							const now = new Date();
							const yy = now.getFullYear().toString().slice(-2);
							const mm = (now.getMonth() + 1).toString().padStart(2, '0');
							const dd = now.getDate().toString().padStart(2, '0');
							const formattedDate = `${yy}/${mm}/${dd}`;

							if (!char.lifeEvents) char.lifeEvents = [];
							char.lifeEvents.push({
								date: formattedDate,
								event: lifeEventData.event
							});
							saveCharactersToLocal();
							console.log(`[Life Event] 自动记录: ${formattedDate} - ${lifeEventData.event}`);
						}
					} catch (e) {
						console.error("解析人生档案JSON失败:", e);
					}
				}

				// --- C. 生成最终展示给用户的文本 ---
				// 截取掉所有指令部分
				cleanResponse = aiResponseText.substring(0, cutOffIndex).trim();
				
				// ============================================
				// 解析结束
				// ============================================
                
				const isCurrentOnline = (typeof char.isOnline !== 'undefined') ? char.isOnline : true;
				let rawText = cleanResponse;
				
				if (isCurrentOnline) {
					// ============================================
					// A. 线上模式
					// ============================================
					updateChatStatus(currentChatId, "对方正在输入中…");
					const enableDelay = (typeof char.enableTypingDelay !== 'undefined') ? char.enableTypingDelay : true;
					const bubbles = rawText.split('###');
					
					for (let i = 0; i < bubbles.length; i++) {
						let rawBubbleText = bubbles[i].trim();
						if (!rawBubbleText) continue; 

						// 【修正点 1】变量声明移到循环开头，且仅声明一次
						let isThisBubbleWithdrawn = false;
						if (rawBubbleText.startsWith('[WITHDRAW]')) {
							isThisBubbleWithdrawn = true;
							rawBubbleText = rawBubbleText.replace(/^\[WITHDRAW\]\s*/, '').trim();
						}

						const tokenRegex = /(\[(?:表情包|图片|文件)：[\s\S]*?\])/g;
						const parts = rawBubbleText.split(tokenRegex);

						for (let j = 0; j < parts.length; j++) {
							let partText = parts[j];
							if (!partText) continue;

							// --- 情况 A：表情包 ---
							const emoMatch = partText.match(/^\[表情包：([\s\S]*?)\]$/);
							if (emoMatch) {
								const desc = emoMatch[1];
								const foundEmoticon = emoticonList.slice().reverse().find(e => e.description === desc);
								if (foundEmoticon) {
									if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1000));
									const msgTimestamp = saveAiMessageInternal(partText, currentChatId, currentRoundId, null, false, foundEmoticon.url, false);
									if (isThisBubbleWithdrawn) {
										const regretDelay = 500 + Math.random() * 1500;
										if (enableDelay) await new Promise(resolve => setTimeout(resolve, regretDelay));
										performAiWithdrawalAction(currentChatId, msgTimestamp);
									}
									continue;
								}
							}
							// ============================================================
							// 【新增】情况 A-2：语音条
							// ============================================================
							const voiceMatch = partText.match(/^\[语音：(.*?)\]$/);
							if (voiceMatch) {
								const voiceContent = voiceMatch[1];
								
								// 简单模拟时长：每3个字1秒，最少2秒，最多60秒
								let duration = Math.ceil(voiceContent.length / 3);
								if (duration < 2) duration = 2;
								if (duration > 60) duration = 60;

								// 模拟录音延迟
								if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1500));
								
								// 保存语音消息 (注意参数：最后两个是 isVoice=true, duration)
								const msgTimestamp = saveAiMessageInternal(voiceContent, currentChatId, currentRoundId, null, false, null, false, true, duration);
								
								// 处理撤回逻辑
								if (isThisBubbleWithdrawn) {
									const regretDelay = 500 + Math.random() * 1500;
									if (enableDelay) await new Promise(resolve => setTimeout(resolve, regretDelay));
									performAiWithdrawalAction(currentChatId, msgTimestamp);
								}
								continue;
							}
							 // 【新增】处理 AI 主动发转账/红包
							const sendPayMatch = partText.match(/^\[(SEND_TRANSFER|SEND_REDPACKET)[:：](.*?)\|(.*?)\]$/);
							if (sendPayMatch) {
								const pType = sendPayMatch[1] === 'SEND_TRANSFER' ? 'transfer' : 'redpacket';
								const pAmount = parseFloat(sendPayMatch[2]);
								const pDesc = sendPayMatch[3];
								if (!isNaN(pAmount)) {
									if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1000));
									savePaymentMessage(pAmount, pDesc, pType, 'received', currentChatId);
								}
								continue;
							}
							// 【新增】处理 AI 接收/拒绝转账
							const actionPayMatch = partText.match(/^\[(ACCEPT_PAY|REJECT_PAY)[:：](.*?)\]$/);
							if (actionPayMatch) {
								const actionType = actionPayMatch[1];
								const payId = actionPayMatch[2];
								window.processAiPaymentAction(currentChatId, payId, actionType);
								continue; // 这个指令是隐式的，不需要在屏幕上单独生成一条文字消息
							}
							// 【修复版】处理 AI 主动发转账/红包 (支持与普通文本混排)
							const sendPayRegex = /\[(SEND_TRANSFER|SEND_REDPACKET)[:：](.*?)\|(.*?)\]/g;
							let sendMatch;
							while ((sendMatch = sendPayRegex.exec(partText)) !== null) {
								const pType = sendMatch[1] === 'SEND_TRANSFER' ? 'transfer' : 'redpacket';
								const pAmount = parseFloat(sendMatch[2]);
								const pDesc = sendMatch[3].trim();
								if (!isNaN(pAmount)) {
									if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1000));
									savePaymentMessage(pAmount, pDesc, pType, 'received', currentChatId);
								}
							}
							// 从文本中剥离发送指令
							partText = partText.replace(/\[(SEND_TRANSFER|SEND_REDPACKET)[:：].*?\|.*?\]/g, '').trim();
							// 【修复版】处理 AI 接收/拒绝转账 (支持与普通文本混排)
							const actionPayRegex = /\[(ACCEPT_PAY|REJECT_PAY)[:：](.*?)\]/g;
							let actionMatch;
							while ((actionMatch = actionPayRegex.exec(partText)) !== null) {
								const actionType = actionMatch[1];
								const payId = actionMatch[2].trim();
								window.processAiPaymentAction(currentChatId, payId, actionType);
							}
							// 从文本中剥离接收/拒绝指令
							partText = partText.replace(/\[(ACCEPT_PAY|REJECT_PAY)[:：].*?\]/g, '').trim();

							// 如果剥离完各种指令后，这段文本变成了空的，就直接跳过，不再生成空气泡
							if (!partText) continue; 
							// 【新增】处理 AI 主动赠送礼物
							const sendGiftRegex = /\[SEND_GIFT:(.*?)\|(.*?)\|(.*?)\]/g;
							let giftMatch;
							while ((giftMatch = sendGiftRegex.exec(partText)) !== null) {
								const gName = giftMatch[1].trim();
								const gDesc = giftMatch[2].trim();
								const gPrice = parseFloat(giftMatch[3]) || 0;
								if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1000));
								
								// 生成唯一ID仅用于关联 UI 卡片，不做其他用途
								const uniqueGiftId = 'gift_ai_' + Date.now() + Math.random().toString(36).substr(2,5);

								const giftMsg = {
									type: 'received',
									timestamp: Date.now(),
									isRead: true,
									isOrderCard: true,
									orderType: 'gift',
									title: gName,
									price: gPrice,
									desc: gDesc,
									status: '已赠送',
									relatedGiftId: uniqueGiftId 
								};
								char.chatHistory.push(giftMsg);
								
								// 【插入隐藏后台消息】告诉AI礼物送出去了，作为上下文记忆
								char.chatHistory.push({
									text: `[系统动作：你刚刚花费了 ${gPrice} 元，为用户购买并送出了礼物：“${gName}”。]`,
									type: 'system',
									isHidden: true,
									isRead: true,
									timestamp: Date.now() + 10,
									relatedGiftId: uniqueGiftId
								});

								if (activeChatId === currentChatId) {
									renderMessageToScreen(giftMsg);
									scrollToBottom(); 
								}
							}
							partText = partText.replace(/\[SEND_GIFT:.*?\|.*?\|.*?\]/g, '').trim();

							// 【新增】处理 AI 主动点外卖
							const sendDeliveryRegex = /\[SEND_DELIVERY:(.*?)\|(.*?)\|(.*?)(?:\|(.*?))?\]/g;
							let deliveryMatch;
							while ((deliveryMatch = sendDeliveryRegex.exec(partText)) !== null) {
								const dName = deliveryMatch[1].trim();
								const dDesc = deliveryMatch[2].trim();
								const dPrice = parseFloat(deliveryMatch[3]) || 0;
								
								// 解析AI传来的分钟数，如果格式错误或没传，则随机生成兜底
								let dMinutes = parseInt(deliveryMatch[4]);
								if (isNaN(dMinutes) || dMinutes <= 0) {
									dMinutes = Math.floor(Math.random() * (40 - 10 + 1) + 10);
								}
								
								if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1000));
								
								const deliveryId = 'del_ai_' + Date.now() + Math.random().toString(36).substr(2,5);
								const orderTime = Date.now();
								
								// 按照AI控制的分钟数计算外卖送达时间
								const etaDuration = dMinutes * 60 * 1000;
								
								if (!char.activeDeliveries) char.activeDeliveries =[];
								char.activeDeliveries.push({
									id: deliveryId,
									name: dName,
									orderTime: orderTime,
									etaTime: orderTime + etaDuration,
									actualDeliveryTime: orderTime + etaDuration,
									direction: 'to_user' 
								});

								const deliveryMsg = {
									type: 'received',
									timestamp: Date.now(),
									isRead: true,
									isOrderCard: true,
									orderType: 'delivery',
									title: dName,
									price: dPrice,
									desc: dDesc,
									status: '等待送达',
									relatedDeliveryId: deliveryId 
								};
								char.chatHistory.push(deliveryMsg);
								
								// 【修复3关键：插入隐藏后台消息告知AI外卖已发出，使用统一的时间】
								char.chatHistory.push({
									text: `[系统动作：你刚刚为用户点了一份外卖：“${dName}”（价值 ${dPrice} 元）。订单已生效，正在配送中，预计 ${dMinutes} 分钟后送达。]`,
									type: 'system',
									isHidden: true,
									isRead: true,
									timestamp: Date.now() + 10,
									relatedDeliveryId: deliveryId
								});

								if (activeChatId === currentChatId) {
									renderMessageToScreen(deliveryMsg);
									scrollToBottom(); 
								}
							}
							
							// 更加健壮的正则，将生成指令从最终文本中隐去
							partText = partText.replace(/\[SEND_DELIVERY:[^\]]+\]/g, '').trim();

							// 【新增】处理 AI 使用钞能力加速外卖 (精准按 ID 匹配)
							const speedUpRegex = /\[SPEED_UP_DELIVERY:(.*?)\]/g;
							let speedMatch;
							while ((speedMatch = speedUpRegex.exec(partText)) !== null) {
								const targetId = speedMatch[1].trim();
								if (char.activeDeliveries) {
									// 寻找匹配 ID 且是 AI 送给用户的外卖
									const targetDelivery = char.activeDeliveries.find(d => d.id === targetId && d.direction === 'to_user');
									if (targetDelivery) {
										const now = Date.now();
										// 如果外卖还没送到才加速，避免把已送达的外卖时间给重置了
										if (now < targetDelivery.actualDeliveryTime) {
											const threeMinutes = 3 * 60 * 1000;
											targetDelivery.etaTime = now + threeMinutes;
											targetDelivery.actualDeliveryTime = now + threeMinutes; // 重置为3分钟后送达
											
											// 强制微小延迟确保时间戳绝对唯一，防止UI卡片串线
											if (enableDelay) await new Promise(resolve => setTimeout(resolve, 10)); 
											
											// UI：发送一条醒目的系统提示
											const sysMsg = {
												text: `对方使用钞能力加速了外卖[${targetDelivery.name}]。`,
												type: 'system',
												timestamp: Date.now(),
												isRead: true,
												isSystemMsg: true,												
												relatedDeliveryId: targetDelivery.id, // 【修复】绑定同一ID，抹除时一并带走
												subEventType: 'speed_up'
											};
											char.chatHistory.push(sysMsg);
											
											// 更新聊天记录中对应外卖卡片的文字状态
											const orderMsg = char.chatHistory.find(m => m.isOrderCard && m.relatedDeliveryId === targetDelivery.id);
											if (orderMsg) orderMsg.status = '⚡ 极速配送中';
											
											if (activeChatId === currentChatId) {
												renderMessageToScreen(sysMsg);
												scrollToBottom(); // 【修复】触发滚动
												if (orderMsg) {
													const row = document.getElementById(`row-${orderMsg.timestamp}`);
													if (row) row.outerHTML = generateMessageHTML(orderMsg, false);
												}
											}
										}
									}
								}
							}
							partText = partText.replace(/\[SPEED_UP_DELIVERY:.*?\]/g, '').trim();

							// --- 视频/语音通话请求 ---
							if (rawBubbleText.includes('[VIDEO_CALL_REQUEST]')) {
								console.log("[Video Call] 检测到 AI 发起视频请求");
								if (activeChatId === currentChatId) {
									setTimeout(() => { VideoCallSystem.triggerIncomingCall(char, 'video'); }, 1000);
								}
								continue; 
							}
							if (rawBubbleText.includes('[VOICE_CALL_REQUEST]')) {
								console.log("[Voice Call] 检测到 AI 发起语音请求");
								if (activeChatId === currentChatId) {
									setTimeout(() => { VideoCallSystem.triggerIncomingCall(char, 'voice'); }, 1000);
								}
								continue; 
							}
							// --- 情况 B：虚拟图片 ---
							const imgMatch = partText.match(/^\[图片：([\s\S]*?)\]$/);
							if (imgMatch) {
								const imgDesc = imgMatch[1];
								if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1500));
								const msgTimestamp = saveAiMessageInternal(imgDesc, currentChatId, currentRoundId, null, false, null, true);
								if (isThisBubbleWithdrawn) {
									const regretDelay = 500 + Math.random() * 1500;
									if (enableDelay) await new Promise(resolve => setTimeout(resolve, regretDelay));
									performAiWithdrawalAction(currentChatId, msgTimestamp);
								}
								continue;
							}
							// --- 情况 B-2：模拟文件 ---
							const fileGenMatch = partText.match(/^\[文件：([\s\S]*?)\|([\s\S]*?)\]$/);
							if (fileGenMatch) {
								if (enableDelay) await new Promise(resolve => setTimeout(resolve, 1500)); // 模拟传文件延迟
								const msgTimestamp = saveAiMessageInternal(partText, currentChatId, currentRoundId, null, false);
								if (isThisBubbleWithdrawn) {
									const regretDelay = 500 + Math.random() * 1500;
									if (enableDelay) await new Promise(resolve => setTimeout(resolve, regretDelay));
									performAiWithdrawalAction(currentChatId, msgTimestamp);
								}
								continue;
							}
							// --- 情况 C：普通文本 ---					
							let cleanText = removeTimestamp(partText).trim(); 
							
							let aiQuoteData = null;
							const refMatch = cleanText.match(/^\[REF:(.*?)\]\s*(.*)/s);
							if (refMatch) {
								// 1. 获取当前场景下的正确用户名 (面具优先 > 专用 > 全局)
								let targetUserName = userInfo.name;
								if (char.userMaskId) {
									const boundMask = userMasks.find(m => m.id === char.userMaskId);
									if (boundMask && boundMask.name) targetUserName = boundMask.name;
								} else if (char.userName && char.userName.trim()) {
									targetUserName = char.userName.trim();
								}

								// 【新增】反向查找原消息的ID
								let targetMsgId = null;
								if (char.chatHistory && char.chatHistory.length > 0) {
									for (let k = char.chatHistory.length - 1; k >= 0; k--) {
										const hMsg = char.chatHistory[k];
										if (hMsg.text && hMsg.text.includes(refMatch[1].trim())) {
											targetMsgId = hMsg.timestamp;
											break;
										}
									}
								}

								// 2. 构建引用数据
								aiQuoteData = { 
									name: targetUserName, // ✅ 使用正确的面具名称
									text: refMatch[1].trim(),
									originalMsgId: targetMsgId // 【新增】
								};
								cleanText = refMatch[2].trim();
							}

							// 【修正点 2】删除此处多余的、导致错误的重复声明
							// let isThisBubbleWithdrawn = false; // <--- REMOVE THIS LINE
							// The check is also removed because it's already done outside this loop.

							if (!cleanText) continue;

							// 【核心修复】：判断是否包含 HTML 交互卡片
							const hasHTML = /<\/?(div|span|button|a|p|b|i|strong|em|details|summary|table|ul|li|input|select|textarea|img|br|hr)[^>]*>/i.test(cleanText);

							if (hasHTML) {
								// 如果是 HTML 界面/卡片，给一个固定的短暂加载延迟（1~1.5秒）
								const typingDelay = 1000 + Math.floor(Math.random() * 500);
								await new Promise(resolve => setTimeout(resolve, enableDelay ? typingDelay : 400)); // ⬅️ 核心：关闭延时也保底等400毫秒
							} else {
								// 纯文本：完全保留你原版的字数延时算法，不做任何上限干涉
								const charCount = cleanText.length;
								if (charCount > 0) {
									const typingDelay = Math.floor(charCount * (200 + Math.floor(500 * Math.pow(Math.random(), 0.25))));
									await new Promise(resolve => setTimeout(resolve, enableDelay ? typingDelay : 400)); // ⬅️ 核心：关闭延时也保底等400毫秒
								}
							}

							const msgTimestamp = saveAiMessageInternal(cleanText, currentChatId, currentRoundId, aiQuoteData, false);
							if(navigator.vibrate) navigator.vibrate(10);
							
							if (isThisBubbleWithdrawn) {
								const regretDelay = 200 + Math.random() * 1300;
								if (enableDelay) await new Promise(resolve => setTimeout(resolve, regretDelay));
								performAiWithdrawalAction(currentChatId, msgTimestamp);
							}
						} 
					} 									
				} else {
					// ============================================
					// B. 线下模式 (无延迟，保持原样)
					// ============================================
					let cleanText = removeTimestamp(rawText);
					cleanText = cleanText.replace(/\[REF:.*?\]/g, "").trim(); 
					cleanText = cleanText.replace(/\[WITHDRAW\]/g, "").trim();
					cleanText = cleanText.replace(/###/g, "\n"); 

					if (cleanText) {
						saveAiMessageInternal(cleanText, currentChatId, currentRoundId, null, false);
					}
				}
				// 【新增】将拉黑动作统一移动到所有模式之后执行，确保遗言/场景渲染完毕
				if (willBlockUser) {
					char.isBlockedByAi = true;
					
					const sysMsg = {
						text: "对方已将您拉黑，请去线下真实TA吧。",
						type: 'received',
						timestamp: Date.now() + 100, // 确保时间戳比刚发的消息晚
						isRead: true,
						isAiBlockMsg: true,
						groupId: currentRoundId
					};
					
					char.chatHistory.push(sysMsg);
					saveCharactersToLocal();

					if (activeChatId === currentChatId) {
						renderMessageToScreen(sysMsg); 
						scrollToBottom();
						updateChatInputState(); // 关键：立刻触发输入框锁定！
						document.getElementById('chat-detail-status').textContent = getChatPermanentStatus(char); // 【新增】立即变为离线
					}
					renderChatList(); 
				}
				// ============================================
				// 【执行解除拉黑逻辑】
				// ============================================
				if (willUnblockUser) {
					if (char.isBlockedByAi) {
						char.isBlockedByAi = false;
						saveCharactersToLocal();
						
						const sysMsg = {
							text: "对方已将您移出黑名单，线上通讯已恢复。",
							type: 'received',
							timestamp: Date.now() + 10,
							isRead: true,
							isCallRecord: true 
						};
						char.chatHistory.push(sysMsg);
						
						if (activeChatId === char.id) {
							renderMessageToScreen(sysMsg);
							scrollToBottom();
							updateChatInputState(); // 立即触发输入框状态重置
							document.getElementById('chat-detail-status').textContent = getChatPermanentStatus(char); // 【新增】立即恢复在线
						}
					}
				}				
				if (!char.msgCountSinceSummary) char.msgCountSinceSummary = 0;
				char.msgCountSinceSummary += 1;
				saveCharactersToLocal();
				triggerLongTermMemoryUpdate(char); 

			} catch (error) {
				console.error("AI Error", error);
				if (activeChatId === currentChatId) alert("AI 回复出错: " + error.message);
			} finally {
				// 调用统一函数清除状态，恢复为“在线/离线/人数”
				updateChatStatus(currentChatId, false);
				// ★★★ 新增：标记回复结束，关闭保活，并弹窗通知 ★★★
				isGlobalAiReplying = false;
				silentAudio.pause(); 
				
				// 如果此时应用在后台，触发本地通知
				if (document.hidden) {
				showLocalNotification(char.name, "给你发来了一条新消息");}
			}
		}

		// 重新绑定
		const sendBtn = document.querySelector('.send-btn');
		const aiBtn = document.querySelector('.ai-btn');
		const inputField = document.querySelector('.chat-bar-input');

		// 【核心修复】
		// 1. 在 mousedown 阶段阻止按钮的默认行为（即获得焦点）
		//    这是防止键盘关闭的关键。
		sendBtn.addEventListener('mousedown', function(event) {
			event.preventDefault();
		});

		// 2. 在 click 阶段执行发送逻辑。
		//    因为 mousedown 阻止了焦点转移，此时键盘仍然是打开的。
		sendBtn.addEventListener('click', handleSendMessage);
		
		// 【修复2】用箭头函数隔离事件对象，并且加入防呆处理
		aiBtn.onclick = (e) => {
			if (e) e.preventDefault();
			handleAiGenerate();
		};

		inputField.addEventListener('keypress', function(e) {
			if (e.key === 'Enter') {
				// 回车键也需要阻止默认的换行/提交行为
				e.preventDefault(); 
				handleSendMessage();
			}
		});
		
		// 修改参数列表，添加 imageUrl = null
		// 【修改】内部保存 AI 消息函数 (增加了 isVirtual 参数)
		function saveAiMessageInternal(text, charId, groupId, quoteData, isWithdrawn, imageUrl = null, isVirtual = false,  isVoice = false, voiceDuration = 0) {
			const charIndex = characters.findIndex(c => c.id == charId);
			if (charIndex === -1) return null;

			const isCurrentlyViewed = (activeChatId === charId);
			const timestamp = Date.now();

			// 自动匹配表情包 URL 逻辑 (保持不变)
			let finalImageUrl = imageUrl;
			if (!finalImageUrl && text.startsWith('[表情包：') && text.endsWith(']')) {
				if (typeof emoticonList !== 'undefined') {
					const desc = text.substring(5, text.length - 1);
					const found = emoticonList.find(e => e.description === desc);
					if (found) finalImageUrl = found.url;
				}
			}

			const newMsg = {
				text: text,
				type: 'received',
				timestamp: timestamp, 
				groupId: groupId,
				isRead: isCurrentlyViewed, 
				isWithdrawn: isWithdrawn,
				withdrawBy: isWithdrawn ? 'assistant' : undefined,
				withdrawTimestamp: isWithdrawn ? Date.now() : undefined,
				quote: quoteData,
				image: finalImageUrl,
				isVirtual: isVirtual, // <--- 【新增】保存虚拟图片标记
				isVoice: isVoice,
				voiceDuration: voiceDuration
			};

			if (!characters[charIndex].chatHistory) characters[charIndex].chatHistory = [];
			characters[charIndex].chatHistory.push(newMsg);
			saveCharactersToLocal();

			if (activeChatId === charId) {
				const wasAtBottom = isScrolledToBottom();
				renderMessageToScreen(newMsg);
				if (wasAtBottom) {
					scrollToBottom();
				}
			}
			renderChatList();
			
			return timestamp;
		}
		
		// ============================================================
        // 【新增】AI 执行撤回动作 (数据更新 + UI 瞬间替换)
        // ============================================================
        function performAiWithdrawalAction(charId, msgTimestamp) {
            const char = characters.find(c => c.id == charId);
            if (!char || !char.chatHistory) return;

            // 1. 更新数据
            const msg = char.chatHistory.find(m => m.timestamp == msgTimestamp);
            if (msg) {
                msg.isWithdrawn = true;
                msg.withdrawBy = 'assistant'; // 标记为AI撤回
                msg.withdrawTimestamp = Date.now();
                saveCharactersToLocal();
            }

            // 2. 更新 UI (只有当用户还在当前窗口时)
            if (activeChatId === charId) {
                const rowEl = document.getElementById(`row-${msgTimestamp}`);
                if (rowEl) {
                    // 重新生成该消息的 HTML，这次它是撤回状态
                    // 注意：msg 对象已经在上面被修改为 isWithdrawn=true 了
                    // generateMessageHTML 会自动根据 withdrawBy='assistant' 生成“你撤回了消息”的系统提示
                    const newHtml = generateMessageHTML(msg, false);
                    
                    // 替换 DOM
                    rowEl.outerHTML = newHtml;
                }
            }
            // 3. 刷新列表预览 (显示“撤回了一条消息”)
            renderChatList();
        }
		
		// ============================================================
		// 【新增】气泡菜单交互逻辑
		// ============================================================

		// 1. 切换菜单显示 (互斥逻辑：点开一个，关闭其他的)
		function toggleBubbleMenu(msgId, bubbleEl) {
			// 阻止冒泡，防止触发全局关闭点击
			event.stopPropagation(); 

			const targetMenu = document.getElementById(`menu-${msgId}`);
			const isCurrentlyShown = targetMenu.classList.contains('show');

			// 先关闭所有已打开的菜单
			closeAllBubbleMenus();

			// 如果刚才没打开，现在就打开它
			if (!isCurrentlyShown) {
				targetMenu.classList.add('show');
				
				// 顺便显示下方的小时间 (可选)
				const wrapper = bubbleEl.parentElement;
				const timeDiv = wrapper.querySelector('.msg-detail-time');
				if(timeDiv) timeDiv.classList.add('show');
			}
		}

		// 2. 关闭所有菜单
		function closeAllBubbleMenus() {
			document.querySelectorAll('.bubble-menu').forEach(el => el.classList.remove('show'));
			document.querySelectorAll('.msg-detail-time').forEach(el => el.classList.remove('show'));
		}

		// ============================================================
		// 【交互逻辑升级】菜单操作与编辑
		// ============================================================

		// ============================================================
		// 【修复版】菜单操作分发函数 (完整逻辑)
		// ============================================================
		function handleMenuAction(action, msgId) {
			if (event) event.stopPropagation(); // 防止冒泡
			
			// 1. 获取当前对话的角色对象
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.chatHistory) { closeAllBubbleMenus(); return; }

			// 2. 获取当前操作的消息对象
			const msgObj = char.chatHistory.find(m => m.timestamp == msgId);
			if (!msgObj) { closeAllBubbleMenus(); return; }
			
			// 3. 智能判断编辑时的回显文本
			let rawText = msgObj.text; 
			if (msgObj.isVoice) {
				// 语音条编辑回显文本
				rawText = msgObj.text;
			} else if (msgObj.isVirtual) {
				// 虚拟图片
				rawText = `${msgObj.text}`;
			} else if (msgObj.image) {
				// 真实图片或表情包
				if (msgObj.text && msgObj.text.startsWith('[表情包：')) {
					rawText = msgObj.text;
				} else if (msgObj.imageDescription) {
					rawText = `${msgObj.imageDescription}`;
				} else {
					rawText = '[图片]';
				}
			}

			// ============================================================
			// 动作分发
			// ============================================================

			// --- 1. 引用回复 (语音修复版) ---
			if (action === 'reply') {
				let senderName = '';
				if (msgObj.type === 'sent') {
                    // 【核心修复】提取真正的用户面具名称
					senderName = userInfo.name; // 兜底全局名
					if (char.userMaskId) {
						const boundMask = userMasks.find(m => m.id === char.userMaskId);
						if (boundMask && boundMask.name) senderName = boundMask.name;
					} else if (char.userName && char.userName.trim()) {
						senderName = char.userName.trim();
					}
				} else {
                    // 如果是接收到的消息
                    if (msgObj.isGroupMsg && msgObj.senderName) {
                        senderName = msgObj.senderName;
                    } else {
                        senderName = char.name; 
                    }
				}

				// 准备引用内容 
				const isImageContent = msgObj.isVirtual || msgObj.image;
				const imgDesc = (isImageContent && msgObj.imageDescription) ? msgObj.imageDescription : null;
				
				// 【关键】决定存储的数据 (发给AI看的)
				let storedText = msgObj.text;
				if (msgObj.isVoice) {
					storedText = `[语音条:${msgObj.text}]`;
				} else if (isImageContent) {
					storedText = imgDesc ? `[图片：${imgDesc}]` : `[图片]`;
				}

				// 记录引用对象
				currentQuoteData = { 
					name: senderName, 
					text: storedText, 
					isImage: isImageContent,
					isVoice: msgObj.isVoice,
					description: imgDesc,
					originalMsgId: msgId // 【新增】保存引用的原消息 ID
				};

				// 显示预览 (界面显示的)
				showReplyPreview(senderName, msgObj.text, isImageContent, imgDesc, msgObj.isVoice);
				
				closeAllBubbleMenus();
			}

			// --- 2. 查看撤回内容 ---
			else if (action === 'view_secret') {
				const secretBubble = document.getElementById(`secret-${msgId}`);
				if (secretBubble) secretBubble.classList.toggle('show');
			}

			// --- 3. 撤回消息 ---
			else if (action === 'withdraw') {
				if(confirm('确定要撤回这条消息吗？')) performWithdraw(msgId);
			}

			// --- 4. 删除消息 ---
			else if (action === 'delete') {
				if(confirm('删除这条记录？')) {
					deleteMessageData(msgId); 
					const row = document.getElementById(`row-${msgId}`);
					if(row) {
						// 清理多余的时间戳
						const prevSibling = row.previousElementSibling;
						if (prevSibling && prevSibling.classList.contains('system-time-stamp')) {
							let hasNextMessage = false;
							let nextSibling = row.nextElementSibling;
							while (nextSibling) {
								if (!nextSibling.classList.contains('system-time-stamp')) {
									hasNextMessage = true;
									break;
								}
								nextSibling = nextSibling.nextElementSibling;
							}
							if (!hasNextMessage) prevSibling.remove();
						}
						row.remove();
					}
				}
			}

			// --- 5. 编辑消息 ---
			else if (action === 'edit') {
				openEditModal(msgId, rawText);
				closeAllBubbleMenus();
			}
			
			// --- 6. 重 Roll ---
			else if (action === 'reroll') {
				const targetGroupId = msgObj.groupId;
				let msgsToDelete = [];
				
				if (targetGroupId) {
					msgsToDelete = char.chatHistory.filter(m => m.groupId === targetGroupId);
				} else {
					msgsToDelete = [msgObj];
				}

				// UI 删除
				msgsToDelete.forEach(m => {
					const row = document.getElementById(`row-${m.timestamp}`);
					if (row) {
						const prev = row.previousElementSibling;
						if(prev && prev.classList.contains('system-time-stamp')) prev.remove();
						row.remove();
					}
					if (m.isAiBlockMsg) {
						char.isBlockedByAi = false;
						updateChatInputState();
					}
				});

				// 数据删除
				if (targetGroupId) {
					char.chatHistory = char.chatHistory.filter(m => m.groupId !== targetGroupId);
				} else {
					char.chatHistory = char.chatHistory.filter(m => m.timestamp != msgId);
				}

				saveCharactersToLocal();
				renderChatList(); 
				handleAiGenerate(); 
			}

			// --- 7. 收藏 ---
			else if (action === 'fav') {
				// 1. 获取基础信息
				let senderName = '';
				let senderAvatar = '';
				
				if (msgObj.type === 'sent') {
					senderName = userInfo.name;
					senderAvatar = userInfo.avatar; // 全局用户头像
					// 如果有聊天专用头像，这里可以尝试获取，稍微复杂点，暂用全局
				} else {
					senderName = char.name;
					senderAvatar = char.avatar;
				}

				// 2. 这里的 Voice ID 获取逻辑：
				// 只有当消息是 AI 发的 (received) 且角色配置了 voiceId 时才记录
				let voiceIdToSave = null;
				if (msgObj.type === 'received' && char.voice && char.voice.id) {
					voiceIdToSave = char.voice.id;
				}

				// 3. 构建收藏对象
				const favItem = {
					id: `fav_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // 唯一ID
					originalTimestamp: msgObj.timestamp,
					charId: char.id, // 关联角色ID
					name: senderName,
					avatar: senderAvatar,
					text: msgObj.text, // 文本内容 (如果是语音，则是转文字内容)
					image: msgObj.image, // 图片URL (如果有)
					isVirtual: msgObj.isVirtual,
					isVoice: msgObj.isVoice, // 是否语音
					voiceDuration: msgObj.voiceDuration, // 语音时长
					voiceId: voiceIdToSave, // 保存当时的语音角色ID，防止角色被删后无法播放
					timestamp: Date.now() // 收藏的时间
				};

				// 4. 保存
				favoriteMessages.unshift(favItem); // 加到最前面
				saveFavoritesToLocal();

				alert('已添加到收藏');
				closeAllBubbleMenus();
			}

			// --- 8. 还原撤回 ---
			else if (action === 'restore') {
				restoreWithdrawnMessage(msgId);
			}
		}
		// 【新增】还原已撤回的消息
		function restoreWithdrawnMessage(timestamp) {
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.chatHistory) return;

			// 1. 找到该消息
			const msg = char.chatHistory.find(m => m.timestamp == timestamp);
			if (msg) {
				// 2. 修改状态：取消撤回标记
				// 注意：我们在撤回时保留了原始 text 和 quote 等数据，所以直接设为 false 即可复原
				msg.isWithdrawn = false;
				
				// 3. 保存数据
				saveCharactersToLocal();

				// 4. 重新渲染 (最简单的办法是重新进入聊天，或者局部刷新)
				// 这里为了保证时间戳排序和显示正确，重新加载当前历史记录页是一个稳妥办法
				// 或者直接简单粗暴地重绘当前页面：
				const row = document.getElementById(`row-${timestamp}`);
				if (row) {
					// 使用 outerHTML 替换整行 (利用 generateMessageHTML 重新生成普通气泡 HTML)
					// 注意：这里假设该消息不需要显示顶部时间(showTime)，
					// 如果很严谨需要判断时间间隔，但在局部刷新中通常忽略即可，或者获取上一条的时间
					const newHtml = generateMessageHTML(msg, false); 
					row.outerHTML = newHtml;
					
					// 绑定新生成的菜单事件 (如果有必要，但在 innerHTML 替换中 onclick 属性会自动生效)
				}
				
				// 更新列表预览（防止列表还显示"撤回了一条消息"）
				renderChatList();
			}
		}
		//新增转账红包和收拒记录绑定
		// ============================================================
		window.handlePaymentDeletion = function(msg, char) {
			if (!msg.isPayment) return;
			const payId = msg.paymentId;

			// 1. 从钱包删除关联流水并回退余额
			if (walletData && walletData.transactions) {
				const relatedTrans = walletData.transactions.filter(t => t.paymentId === payId);
				relatedTrans.forEach(t => {
					// 逆向回退金额（原来扣的加回来，原来加的扣回去）
					if (walletData.balance !== undefined) {
						walletData.balance -= t.amount; 
					}
				});
				walletData.transactions = walletData.transactions.filter(t => t.paymentId !== payId);
				saveWalletToLocal();
			}

			// 2. 从聊天记录中删除相关的隐藏系统提示
			if (char && char.chatHistory) {
				char.chatHistory = char.chatHistory.filter(m => !(m.isHidden && m.relatedPayId === payId));
			}
		};
		// ============================================================
		// 【核心逻辑】处理消息删除的副作用 (退款、删外卖浮窗、删后台消息)
		// 供“单删”和“批量删”共用
		// ============================================================
		function processDeletionSideEffects(msg, char) {
			if (!msg || !char) return;

			// 1. 处理普通转账/红包的联动删除 (钱包回退)
			if (msg.isPayment) {
				if (typeof window.handlePaymentDeletion === 'function') {
					window.handlePaymentDeletion(msg, char);
				}
			}

			// 2. 处理外卖/礼物卡片的删除
			if (msg.isOrderCard) {
				// A. 执行退款 (【修复2】只有 type === 'sent' 即用户自己花钱买的，删除时才执行钱包退款)
				if (msg.price && msg.type === 'sent') {
					const refundAmount = parseFloat(msg.price);
					const typeName = msg.orderType === 'delivery' ? '外卖' : '礼物';
					window.addTransaction(refundAmount, `${typeName}退款: ${msg.title}`);
					console.log(`[System] 已执行退款: ${refundAmount}`);
				}

				// B. 如果是外卖，还需要删除浮窗和后台消息
				if (msg.orderType === 'delivery') {
					let targetId = msg.relatedDeliveryId;

					// 兼容旧数据：没有ID则尝试通过名称匹配
					if (!targetId && char.activeDeliveries) {
						const match = char.activeDeliveries.find(d => d.name === msg.title);
						if (match) targetId = match.id;
					}

					if (targetId) {
						// (1) 删除悬浮窗数据
						if (char.activeDeliveries) {
							char.activeDeliveries = char.activeDeliveries.filter(d => d.id !== targetId);
						}												
					}
				}
				// C. 【核心新增】如果是礼物，从礼物清单中删除
				if (msg.orderType === 'gift') {
					const targetGiftId = msg.relatedGiftId;
					
					if (targetGiftId && char.giftList) {
						// 根据 ID 精确删除
						const initialLength = char.giftList.length;
						char.giftList = char.giftList.filter(g => g.id !== targetGiftId);
						
						if (char.giftList.length < initialLength) {
							console.log(`[System] 已同步删除礼物清单项 ID: ${targetGiftId}`);
						}
					} 
				}	
			}

			// 3. 处理拉黑解除
			if (msg.isAiBlockMsg) {
				char.isBlockedByAi = false;
				if (activeChatId === char.id) updateChatInputState();
			}
		}
		// ============================================================
		// 【终极修复版】单条数据删除函数 (精确区分主订单与子事件，拒绝株连)
		// ============================================================
		function deleteMessageData(timestamp) {
			const char = characters.find(c => c.id == activeChatId);
			if (char && char.chatHistory) {
				const msgToDelete = char.chatHistory.find(m => m.timestamp == timestamp);
				
				if (msgToDelete) {
					// 1. 调用通用处理函数 (退款、删浮窗数据、删礼物清单)
					processDeletionSideEffects(msgToDelete, char);

					const targetDelId = msgToDelete.relatedDeliveryId;
					const targetGiftId = msgToDelete.relatedGiftId;

					if (targetDelId || targetGiftId) {
						if (msgToDelete.isOrderCard) {
							// 【情况A：删除的是主订单】-> 株连九族，彻底抹除这单外卖所有的提示和隐藏消息
							const relatedMsgs = char.chatHistory.filter(m => 
								(targetDelId && m.relatedDeliveryId === targetDelId) || 
								(targetGiftId && m.relatedGiftId === targetGiftId)
							);
							
							relatedMsgs.forEach(m => {
								const row = document.getElementById(`row-${m.timestamp}`);
								if (row) {
									const prev = row.previousElementSibling;
									if (prev && prev.classList.contains('system-time-stamp')) prev.remove();
									row.remove();
								}
							});

							char.chatHistory = char.chatHistory.filter(m => 
								!(targetDelId && m.relatedDeliveryId === targetDelId) && 
								!(targetGiftId && m.relatedGiftId === targetGiftId)
							);
						} else if (msgToDelete.subEventType) {
							// 【情况B：删除的是子事件（如闪送/取消）】-> 仅删除可见提示+对应的后台隐藏消息
							const subType = msgToDelete.subEventType;
							const relatedSubMsgs = char.chatHistory.filter(m => 
								m.relatedDeliveryId === targetDelId && m.subEventType === subType
							);

							relatedSubMsgs.forEach(m => {
								const row = document.getElementById(`row-${m.timestamp}`);
								if (row) {
									const prev = row.previousElementSibling;
									if (prev && prev.classList.contains('system-time-stamp')) prev.remove();
									row.remove();
								}
							});

							char.chatHistory = char.chatHistory.filter(m => 
								!(m.relatedDeliveryId === targetDelId && m.subEventType === subType)
							);
						}
					}
				}

				// 常规文本或其他消息兜底删除
				char.chatHistory = char.chatHistory.filter(m => m.timestamp != timestamp);
				
				saveCharactersToLocal();
				renderDeliveryCards(); // 刷新外卖浮窗 UI
			}
		}

		// 3. 打开编辑弹窗
		const editMsgModal = document.getElementById('edit-msg-modal');
		const editMsgInput = document.getElementById('edit-msg-input');

		function openEditModal(msgId, text) {
			currentEditingMsgId = msgId; // 记录当前正在编辑哪条
			editMsgInput.value = text;   // 填入旧内容
			editMsgModal.classList.add('show');
			editMsgInput.focus();
		}

		// 4. 绑定弹窗按钮事件
		document.getElementById('cancel-edit-msg-btn').addEventListener('click', () => {
			editMsgModal.classList.remove('show');
			currentEditingMsgId = null;
		});

		// ============================================================
		// 【重构】确认编辑按钮事件 (完整版)
		// ============================================================
		const confirmEditBtn = document.getElementById('confirm-edit-msg-btn');
		if (confirmEditBtn) {
			// 移除旧监听 (防止重复) - 使用 cloneNode 方法
			const newBtn = confirmEditBtn.cloneNode(true);
			confirmEditBtn.parentNode.replaceChild(newBtn, confirmEditBtn);

			newBtn.addEventListener('click', () => {
				if (!currentEditingMsgId) return;
				
				const newText = editMsgInput.value.trim();
				if (!newText) {
					alert("消息内容不能为空");
					return;
				}

				const char = characters.find(c => c.id == activeChatId);
				if (char && char.chatHistory) {
					const msg = char.chatHistory.find(m => m.timestamp == currentEditingMsgId);
					if (msg) {
						// --- 核心逻辑分发 ---
						
						if (msg.isVoice) {
							// --- 情况 0: 语音条 ---
							msg.text = newText;
							// 重新计算时长算法 (每3个字1秒，限 1-60s)
							let newDuration = Math.ceil(newText.length / 3);
							if (newDuration < 1) newDuration = 1;
							if (newDuration > 60) newDuration = 60;
							msg.voiceDuration = newDuration;
							
							alert('语音内容已修改，时长已自动更新。');
							
							// 重新渲染该行
							const row = document.getElementById(`row-${currentEditingMsgId}`);
							if (row) {
								row.outerHTML = generateMessageHTML(msg, false);
							}

						} else if (msg.image && !msg.isVirtual) {
							// --- 情况 1: 真实图片 ---
							msg.imageDescription = newText;
							alert('图片的上下文描述已更新！');

						} else {
							// --- 情况 2: 虚拟图片 或 纯文本 ---
							msg.text = newText;
							const row = document.getElementById(`row-${currentEditingMsgId}`);
							if (row) {
								row.outerHTML = generateMessageHTML(msg, false);
							}
						}

						// 统一保存数据
						saveCharactersToLocal();
						renderChatList(); 
					}
				}

				// 关闭弹窗并重置
				editMsgModal.classList.remove('show');
				currentEditingMsgId = null;
			});
		}

		// 4. 全局点击监听：点击页面空白处，关闭所有气泡菜单
		document.addEventListener('click', (e) => {
			// 如果点击的不是菜单内部，也不是气泡本身，就关闭所有菜单
			if (!e.target.closest('.bubble-menu') && !e.target.closest('.msg-bubble')) {
				closeAllBubbleMenus();
			}
			
			// 【修复层级遮挡】全局点击时，恢复所有视频通话气泡的层级，并关闭其菜单
			if (!e.target.closest('.v-bubble-menu') && !e.target.closest('.call-bubble')) {
				document.querySelectorAll('.call-bubble').forEach(el => el.style.zIndex = '');
				document.querySelectorAll('.v-bubble-menu').forEach(el => el.remove());
			}
		});
		
		// ============================================================
		// 【修改版】渲染 LTM 编辑页面的全部内容
		// 启用了手动总结按钮
		// ============================================================
		function renderLongTermMemoryPage() {
			// === 自动修复 HTML 结构嵌套错误的“救援代码” ===
			const contentArea = document.getElementById('main-content-area');
			const ltmPage = document.getElementById('long-term-memory-page');
			
			if (contentArea && ltmPage && ltmPage.parentElement !== contentArea) {
				contentArea.appendChild(ltmPage);
			}
			
			const char = characters.find(c => c.id == activeChatId);
			if (!char) return;

			// 定位到页面的主内容容器
			const pageContentContainer = document.getElementById('ltm-page-content');
			if (!pageContentContainer) return;

			// 彻底清空，确保每次都是重新构建
			pageContentContainer.innerHTML = ''; 

			// 确保角色有 memories 数组
			if (!char.longTermMemories) char.longTermMemories = [];

			// --- 1. 创建并添加“手动总结”按钮 (已激活) ---
			const manualButton = document.createElement('button');
			manualButton.className = 'save-preset-btn';
			manualButton.id = 'manual-summary-btn'; // 给个ID方便控制
			manualButton.style.marginBottom = '15px';
			manualButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; //以此区分保存按钮
			
			// 显示当前积压了多少条未总结
			const pendingCount = char.msgCountSinceSummary || 0;
			manualButton.innerHTML = `<i class="fas fa-magic"></i> 手动总结当前积压消息 (${pendingCount}条)`;
			
			if (pendingCount === 0) {
				manualButton.disabled = true;
				manualButton.style.opacity = '0.6';
				manualButton.textContent = '暂无新消息可总结';
			} else {
				manualButton.onclick = () => handleManualSummary(char.id);
			}

			pageContentContainer.appendChild(manualButton);

			// --- 2. 创建并添加记忆编辑区的外层容器 ---
			const editorContainer = document.createElement('div');
			editorContainer.id = 'ltm-editor-container';
			pageContentContainer.appendChild(editorContainer);

			// --- 3. 创建并添加计数器 ---
			const counter = document.createElement('div');
			counter.className = 'ltm-counter';
			const maxMemories = memorySettings.ltmMax || 5;
			counter.textContent = `当前记忆: ${char.longTermMemories.length} / ${maxMemories}`;
			editorContainer.appendChild(counter);

			// --- 4. 循环生成每个记忆条目 ---
			if (char.longTermMemories.length > 0) {
				// 倒序显示，最新的在最上面，方便查看
				// (注意：这里仅仅是显示倒序，为了不破坏索引，我们还是用原始顺序遍历，但在 flex 布局或插入时处理，
				//  或者简单点，直接按顺序显示即可。通常记忆是按时间顺序存的，下面代码保持原样)
				char.longTermMemories.forEach((memoryText, index) => {
					const itemDiv = document.createElement('div');
					itemDiv.className = 'ltm-item';
					itemDiv.innerHTML = `
						<textarea>${memoryText}</textarea>
						<div class="ltm-item-actions">
							<button class="ltm-action-btn delete" data-action="delete" data-index="${index}"><i class="fas fa-trash"></i></button>
							<button class="ltm-action-btn insert" data-action="insert" data-index="${index}"><i class="fas fa-plus"></i></button>
						</div>
					`;
					editorContainer.appendChild(itemDiv);
				});
			} else {
				 editorContainer.insertAdjacentHTML('beforeend', '<p style="text-align:center; color:#999; margin-top: 15px;">暂无长期记忆</p>');
			}
		}
		// ============================================================
		// 【补全丢失函数】初始化 LTM 页面事件监听
		// ============================================================
		function initializeLtmEventListeners() {
			// A. 从聊天菜单进入LTM编辑页
			const ltmMenuBtn = document.getElementById('menu-ltm-btn');
			if (ltmMenuBtn) {
				ltmMenuBtn.addEventListener('click', () => {
					document.getElementById('chat-menu-dropdown').classList.remove('show');
					// 先切换页面，再渲染内容
					switchPage('long-term-memory-page');
					switchTopBar('ltm-top');
					renderLongTermMemoryPage(); 
				});
			}

			// --- B. LTM页面返回按钮 (修复滚动) ---
			const ltmBackBtn = document.querySelector('#ltm-top .top-bar-back');
			if (ltmBackBtn) {
				ltmBackBtn.addEventListener('click', () => {
					// 如果是在 LTM 页面
					if (document.getElementById('long-term-memory-page').classList.contains('active')) {
						// 提示逻辑保持不变...
						if (confirm('您有未保存的更改，确定要返回吗？')) {
							switchPage('chat-detail-page');
							switchTopBar('chat-detail-top');
							
							// 【新增】切换回聊天页后，强制滚到底部
							scrollToBottom();
						}
					}
				});
			}

			// --- C. LTM页面保存按钮 (修复逻辑：从DOM获取值) ---
			const ltmSaveBtn = document.getElementById('ltm-save-btn');
			if (ltmSaveBtn) {
				ltmSaveBtn.addEventListener('click', () => {
					const char = characters.find(c => c.id == activeChatId);
					if (!char) return;

					// ============================================================
					// 【核心修复】获取编辑区内容并更新数据
					// ============================================================
					const newMemories = [];
					// 获取编辑器容器内的所有 textarea
					const textareas = document.querySelectorAll('#ltm-editor-container textarea');
					
					textareas.forEach(ta => {
						const val = ta.value.trim();
						// 只有内容不为空才保存 (如果想允许空行占位，可以去掉这个if)
						if (val) {
							newMemories.push(val);
						}
					});

					// 更新角色的长期记忆数组
					char.longTermMemories = newMemories;
					// ============================================================

					saveCharactersToLocal();

					alert('长期记忆已保存！');
					switchPage('chat-detail-page');
					switchTopBar('chat-detail-top');
					
					// 保存并返回后，强制滚到底部
					scrollToBottom();
				});
			}

			// D. 使用事件委托，处理删除和插入按钮（绑定在父容器上）
			const pageContentContainer = document.getElementById('ltm-page-content');
			if(pageContentContainer) {
				pageContentContainer.addEventListener('click', (e) => {
					// 1. 查找是否点击了操作按钮（删除/插入）
					const button = e.target.closest('.ltm-action-btn');
					if (button) {
						const action = button.dataset.action;
						const index = parseInt(button.dataset.index);
						const char = characters.find(c => c.id == activeChatId);
						
						if (char && !isNaN(index)) {
							if (action === 'delete') {
								if(confirm('确定删除这条记忆吗？')) {
									char.longTermMemories.splice(index, 1);
									renderLongTermMemoryPage(); 
								}
							} else if (action === 'insert') {
								char.longTermMemories.splice(index + 1, 0, ''); // 插入空行
								renderLongTermMemoryPage(); 
							}
						}
					}
				});
			}
		}
		// ============================================================
		// 【新增】群聊页面逻辑控制
		// ============================================================

		// 1. 初始化群聊页面
		function initNewGroupPage() {
			const gNameInput = document.getElementById('group-name-input');
			if (gNameInput) gNameInput.value = '';
			const gCtxInput = document.getElementById('group-context-input');
			if (gCtxInput) gCtxInput.value = '';
			const gAvUploader = document.getElementById('group-avatar-uploader');
			if (gAvUploader) gAvUploader.innerHTML = '<i class="fas fa-users" style="font-size: 24px;"></i>';
			
			// 【新增】清空群聊用户专用设定
			const ngUserName = document.getElementById('new-group-user-name');
			if (ngUserName) ngUserName.value = '';
			const ngUserVoice = document.getElementById('new-group-user-voice-id');
			if (ngUserVoice) ngUserVoice.value = '';
			
			// 【修复】完全和私聊一致：直接调用渲染函数，清空并加载预设面具
			renderUserMaskSelectOptions('new-group-user-mask-select', '');
			
			const ngUserAvUploader = document.getElementById('new-group-user-avatar-uploader');
			if (ngUserAvUploader) ngUserAvUploader.innerHTML = '<i class="fas fa-camera" style="font-size: 20px;"></i>';
			tempNewGroupUserAvatar = '';

			tempGroupAvatar = '';
			tempNpcList = []; 
			document.getElementById('group-bg-url').value = '';
			document.getElementById('group-time-awareness').checked = false;
			document.getElementById('group-memory-sync').checked = true; // 默认开启互通
			renderGroupMemberSelect();
			// 【新增】清空/渲染新建群聊世界书选择列表
			const newGrpWbContainer = document.getElementById('new-group-worldbook-container');
			if (newGrpWbContainer) renderWorldbookSelection(newGrpWbContainer,[]);
		}
		// 【新增】群聊相关专用面具头像上传绑定
		const newGrpUserAvatarUploader = document.getElementById('new-group-user-avatar-uploader');
		const newGrpUserAvatarInput = document.getElementById('new-group-user-avatar-input');
		if (newGrpUserAvatarUploader) {
			newGrpUserAvatarUploader.addEventListener('click', () => newGrpUserAvatarInput.click());
			newGrpUserAvatarInput.addEventListener('change', async function(e) {
				const file = e.target.files[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = async (evt) => {
					tempNewGroupUserAvatar = await compressImage(evt.target.result, 120, 0.8);
					newGrpUserAvatarUploader.innerHTML = `<img src="${tempNewGroupUserAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
				};
				reader.readAsDataURL(file);
				this.value = '';
			});
		}
		const setGrpUserAvatarUploader = document.getElementById('setting-group-user-avatar-uploader');
		const setGrpUserAvatarInput = document.getElementById('setting-group-user-avatar-input');
		if (setGrpUserAvatarUploader) {
			setGrpUserAvatarUploader.addEventListener('click', () => setGrpUserAvatarInput.click());
			setGrpUserAvatarInput.addEventListener('change', async function(e) {
				const file = e.target.files[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = async (evt) => {
					tempSettingGroupUserAvatar = await compressImage(evt.target.result, 120, 0.8);
					setGrpUserAvatarUploader.innerHTML = `<img src="${tempSettingGroupUserAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
				};
				reader.readAsDataURL(file);
				this.value = '';
			});
		}

		
		// 2. 渲染成员选择 (已有角色 + NPC)
		function renderGroupMemberSelect() {
			const container = document.getElementById('group-members-container');
            
			// 【核心修复】：保存当前已勾选的状态，防止添加 NPC 时重置已有角色的选中状态
			const checkedValues = new Set();
			if (container.innerHTML.trim() !== '') {
				container.querySelectorAll('input:checked').forEach(box => checkedValues.add(box.value));
			}

			container.innerHTML = '';

			// A. 渲染已有角色
			if (characters.length > 0) {
				const validChars = characters.filter(c => c.type !== 'group'); // 排除群聊
				if (validChars.length > 0) {
					// 【核心修复】：使用 insertAdjacentHTML 替代 innerHTML +=，不破坏 DOM
					container.insertAdjacentHTML('beforeend', `<div style="font-size:12px;color:#999;background:#f9f9f9;padding:4px 10px;font-weight:bold;">通讯录角色</div>`);
					validChars.forEach(char => {
						const label = document.createElement('label');
						label.className = 'checkbox-item';
                        
						// 恢复勾选状态
						const val = `existing:${char.id}`;
						const isChecked = checkedValues.has(val) ? 'checked' : '';

						let avatarHtml = char.avatar 
							? `<img src="${char.avatar}" style="width:24px; height:24px; border-radius:4px; margin-right:8px; object-fit:cover;">` 
							: `<div style="width:24px; height:24px; border-radius:4px; margin-right:8px; background:#eee; display:flex; align-items:center; justify-content:center; color:#999;"><i class="fas fa-user" style="font-size:12px;"></i></div>`;
						
						label.innerHTML = `
							<input type="checkbox" value="${val}" ${isChecked}>
							<span class="custom-check-circle"></span>
							<div style="display:flex;align-items:center;">
								${avatarHtml}
								<span>${char.name}</span>
							</div>
						`;
						container.appendChild(label);
					});
				}
			}

			// B. 渲染临时 NPC
			if (tempNpcList.length > 0) {
				container.insertAdjacentHTML('beforeend', `<div style="font-size:12px;color:#999;background:#f9f9f9;padding:4px 10px;font-weight:bold;margin-top:5px;">临时 NPC</div>`);
				tempNpcList.forEach((npc, index) => {
					const label = document.createElement('label');
					label.className = 'checkbox-item';
                    
					// NPC 新添加时默认勾选
					label.innerHTML = `
						<input type="checkbox" value="npc:${index}" checked>
						<span class="custom-check-circle"></span>
						<div style="display:flex;align-items:center;">
							<img src="${npc.avatar || ''}" style="width:24px;height:24px;border-radius:4px;margin-right:8px;object-fit:cover;background:#eee;">
							<span>${npc.name} <span class="npc-tag">NPC</span></span>
						</div>
					`;
					container.appendChild(label);
				});
			}
		}

		// 3. 绑定菜单点击事件 (在 main-add-menu-dropdown 逻辑附近)
		// 注意：如果你之前已经绑定过，请替换
		const menuNewGroupBtnReal = document.getElementById('menu-new-group-btn');
		if (menuNewGroupBtnReal) {
			const newBtn = menuNewGroupBtnReal.cloneNode(true);
			menuNewGroupBtnReal.parentNode.replaceChild(newBtn, menuNewGroupBtnReal);
			newBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				document.getElementById('main-add-menu-dropdown').classList.remove('show');
				initNewGroupPage();
				renderUserMaskSelectOptions('new-group-user-mask-select', ''); // 【新增】
				switchPage('new-group-page');
				switchTopBar('new-group-top');
			});
		}

		// 4. 群头像上传
		document.getElementById('group-avatar-uploader').addEventListener('click', () => document.getElementById('group-avatar-input').click());
		document.getElementById('group-avatar-input').addEventListener('change', async function(e) {
			const file = e.target.files[0];
			if(!file) return;
			const reader = new FileReader();
			reader.onload = async (event) => {
				tempGroupAvatar = await compressImage(event.target.result, 150, 0.8);
				document.getElementById('group-avatar-uploader').innerHTML = `<img src="${tempGroupAvatar}" style="width:100%;height:100%;object-fit:cover;">`;
			};
			reader.readAsDataURL(file);
		});

		// 5. NPC 管理 (修复版：支持新建页和设置页双重入口)
		const npcModal = document.getElementById('npc-add-modal');
		let currentNpcAddMode = 'new'; // 'new' (新建群) 或 'setting' (设置群)
		let tempSettingNpcs = []; // 专门用于设置页面临时存储新增的 NPC

		// 通用打开 NPC 弹窗函数
		function openNpcModal(mode) {
			currentNpcAddMode = mode;
			document.getElementById('npc-name-input').value = '';
			document.getElementById('npc-persona-input').value = '';
			document.getElementById('npc-avatar-uploader').innerHTML = '<i class="fas fa-user-secret"></i>';
			tempNpcAvatar = '';
			npcModal.classList.add('show');
		}

		// A. 绑定“新建群聊”页面的添加按钮
		const addNpcBtnNew = document.getElementById('add-npc-btn');
		if (addNpcBtnNew) {
			// 防止重复绑定
			const newBtn = addNpcBtnNew.cloneNode(true);
			addNpcBtnNew.parentNode.replaceChild(newBtn, addNpcBtnNew);
			newBtn.addEventListener('click', () => openNpcModal('new'));
		}

		// B. 【修复点】绑定“群聊设置”页面的添加按钮
		const addNpcBtnSetting = document.getElementById('setting-add-npc-btn');
		if (addNpcBtnSetting) {
			// 防止重复绑定
			const newBtn = addNpcBtnSetting.cloneNode(true);
			addNpcBtnSetting.parentNode.replaceChild(newBtn, addNpcBtnSetting);
			newBtn.addEventListener('click', () => openNpcModal('setting'));
		}

		document.getElementById('cancel-npc-btn').addEventListener('click', () => npcModal.classList.remove('show'));
		document.getElementById('npc-avatar-uploader').addEventListener('click', () => document.getElementById('npc-avatar-input').click());
		
		document.getElementById('npc-avatar-input').addEventListener('change', async function(e) {
			const file = e.target.files[0];
			if(!file) return;
			const reader = new FileReader();
			reader.onload = async (event) => {
				tempNpcAvatar = await compressImage(event.target.result, 100, 0.8);
				document.getElementById('npc-avatar-uploader').innerHTML = `<img src="${tempNpcAvatar}" style="width:100%;height:100%;object-fit:cover;">`;
			};
			reader.readAsDataURL(file);
		});

		// 确认添加 NPC
		document.getElementById('confirm-npc-btn').addEventListener('click', () => {
			const name = document.getElementById('npc-name-input').value.trim();
			const persona = document.getElementById('npc-persona-input').value.trim();
			if(!name) { alert('NPC名字不能为空'); return; }
			
			const newNpcData = { id: 'npc_'+Date.now(), name, persona, avatar: tempNpcAvatar };

			if (currentNpcAddMode === 'new') {
				// 模式1：新建群聊
				tempNpcList.push(newNpcData);
				renderGroupMemberSelect(); // 刷新新建页列表
			} else {
				// 模式2：群聊设置 (核心修复)
				// 将新NPC存入临时数组
				const tempIdx = tempSettingNpcs.length;
				tempSettingNpcs.push(newNpcData);

				// 直接向设置页的列表中追加一个勾选状态的项
				const container = document.getElementById('setting-group-members-container');
				if (container) {
					const label = document.createElement('label');
					label.className = 'checkbox-item';
					// 注意：这里 value 的格式是 "temp_npc:索引"
					label.innerHTML = `
						<input type="checkbox" value="temp_npc:${tempIdx}" checked>
						<span class="custom-check-circle"></span>
						<div style="display:flex;align-items:center;">
							<img src="${tempNpcAvatar || ''}" style="width:24px;height:24px;border-radius:4px;margin-right:8px;object-fit:cover;background:#eee;">
							<span>${name} <span class="npc-tag" style="background:#07c160;">New</span></span>
						</div>
					`;
					container.appendChild(label);
				}
			}
			npcModal.classList.remove('show');
		});
		// 新建群聊页：拉取模型
		const newGrpFetchBtn = document.getElementById('new-group-fetch-models-btn');
		if (newGrpFetchBtn) {
			newGrpFetchBtn.addEventListener('click', () => {
				const url = document.getElementById('new-group-api-url');
				const key = document.getElementById('new-group-api-key');
				const sel = document.getElementById('new-group-model-select');
				fetchModelsForApi(url, key, sel, newGrpFetchBtn, {});
			});
		}
		// 6. 保存群聊
		document.getElementById('new-group-save-btn').addEventListener('click', () => {
			const name = document.getElementById('group-name-input')?.value.trim() || '';
			const context = document.getElementById('group-context-input')?.value.trim() || '';
			if(!name || !context) { alert('请填写群名称和群背景'); return; }

			const members =[];
			document.querySelectorAll('#group-members-container input:checked').forEach(box => {
				const [type, id] = box.value.split(':');
				if(type === 'existing') members.push({ type: 'existing', id: id });
				else if(type === 'npc') members.push({ type: 'npc', data: tempNpcList[parseInt(id)] });
			});

			if(members.length < 1) { alert('群聊至少需要1名成员'); return; }
			// 【新增】获取选中的世界书
			const selectedWbs =[];
			const wbContainer = document.getElementById('new-group-worldbook-container');
			if (wbContainer) {
				wbContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(box => {
					selectedWbs.push(box.value);
				});
			}
			
			// 安全获取面具ID
			const userMaskEl = document.getElementById('new-group-user-mask-select') || document.getElementById('new-group-user-mask');
			
			// 兜底获取 API 设置，防止旧版 HTML 缺失对应输入框报错
			const apiUrlEl = document.getElementById('new-group-api-url');
			const apiKeyEl = document.getElementById('new-group-api-key');
			const modelSelEl = document.getElementById('new-group-model-select');
			const tempEl = document.getElementById('new-group-api-temp');

			const newGroup = {
				id: 'group_' + Date.now(),
				type: 'group', // 关键标记
				name: name,
				avatar: tempGroupAvatar,
				persona: context,
				members: members,
				worldBookIds: selectedWbs,
				timeAware: document.getElementById('group-time-awareness')?.checked || false,
				syncHistory: document.getElementById('group-memory-sync')?.checked || true, // 默认互通
				backgroundImage: document.getElementById('group-bg-url')?.value.trim() || '',
				
				// 【新增】保存群聊的专属用户设定
				userAvatar: tempNewGroupUserAvatar,
				userName: document.getElementById('new-group-user-name')?.value.trim() || '',
				userMaskId: userMaskEl ? userMaskEl.value : '',
				
				chatHistory:[],
				isOnline: true,
				createdAt: Date.now(),
				apiSettings: {
					baseUrl: apiUrlEl ? apiUrlEl.value.trim() : '',
					apiKey: apiKeyEl ? apiKeyEl.value.trim() : '',
					model: modelSelEl ? modelSelEl.value : '',
					temperature: tempEl ? tempEl.value : ''
				}
			};

			characters.unshift(newGroup);
			saveCharactersToLocal();
			switchPage('chat-page');
			switchTopBar('chat-top');
			renderChatList();
		});

		// 返回按钮
		document.querySelector('#new-group-top .top-bar-back').addEventListener('click', () => {
			switchPage('chat-page');
			switchTopBar('chat-top');
		});
      // ============================================================
		// 【8. 页面初始化区 - 终极防崩溃版】
		// ============================================================
		window.addEventListener('load', async () => {
			console.log("🚀 App 开始启动...");

			// 1. 尝试迁移旧数据 (加上 try-catch 防止中断)
			try {
				await migrateOldData();
			} catch (e) {
				console.error("❌ 迁移旧数据失败:", e);
			}

			// 2. 从数据库加载所有数据 (极其容易在 iOS 微信/无痕模式下崩溃)
			try {
				await loadAllData();
			} catch (e) {
				console.error("❌ 数据库读取致命错误:", e);
				alert("系统数据读取失败（可能是iOS无痕模式或微信存储限制）。\n详细报错：" + e.message);
				// 即使失败，内存变量里也有 default 默认值，不至于完全白屏
			}

			// 3. 【核心】：无论数据加载成功还是失败，都必须强制渲染 UI！
			try {
				initUserInfoDisplay();
				initChatApiSettingsDisplay();
				populatePresetDropdown();
				renderChatList();
				updateNavChatUnreadBadge();
				initializeLtmEventListeners();             
				updateMomentsUnreadBadge();
			} catch (e) {
				console.error("❌ UI 渲染致命错误:", e);
				alert("界面渲染失败：" + e.message);
			}

			// 4. 延迟加载非核心功能
			setTimeout(() => {
				try {
					if (typeof window.checkAndClearFortuneData === 'function') window.checkAndClearFortuneData(); // <--- 【新增】：刚打开网页时检查是否隔日
					if (typeof fetchQWeatherData === 'function') fetchQWeatherData(false); 
					if (typeof checkAutoTheirDayRefresh === 'function') checkAutoTheirDayRefresh(); 
				} catch (e) {
					console.error("后台服务启动失败", e);
				}
			}, 5000);
		});
		
		// --- 识图 API 设置页逻辑 (V2 - 适配下拉框) ---
		const visionApiSettingBtn = document.getElementById('vision-api-setting-btn');
		const visionApiSaveBtn = document.getElementById('vision-api-save-btn');
		const visionApiBackBtn = document.querySelector('#vision-api-setting-top .top-bar-back');

		const visionUrlInput = document.getElementById('vision-api-url-input');
		const visionKeyInput = document.getElementById('vision-api-key-input');
		// 注意：这里获取的是 select 元素
		const visionModelSelect = document.getElementById('vision-model-select');
		const visionPromptInput = document.getElementById('vision-prompt-input');

		// 进入设置页
		if (visionApiSettingBtn) {
			visionApiSettingBtn.addEventListener('click', () => {
				// 回显数据
				visionUrlInput.value = visionApiSettings.baseUrl || '';
				visionKeyInput.value = visionApiSettings.apiKey || '';
				visionPromptInput.value = visionApiSettings.prompt || '';
                
                // 【核心修改】回显模型到 select
                if (visionApiSettings.model) {
                    visionModelSelect.innerHTML = `<option value="${visionApiSettings.model}" selected>${visionApiSettings.model}</option>`;
                } else {
                    visionModelSelect.innerHTML = `<option value="">请先拉取模型</option>`;
                }
				populatePresetDropdown();
				switchPage('vision-api-setting-page');
				switchTopBar('vision-api-setting-top');
			});
		}

		// 返回
		if (visionApiBackBtn) {
			visionApiBackBtn.addEventListener('click', () => {
				switchPage('contact-page');
				switchTopBar('contact-top');
			});
		}

		// 保存
		if (visionApiSaveBtn) {
			visionApiSaveBtn.addEventListener('click', () => {
				visionApiSettings.baseUrl = visionUrlInput.value.trim();
				visionApiSettings.apiKey = visionKeyInput.value.trim();
				// 【核心修改】从 select 获取模型值
				visionApiSettings.model = visionModelSelect.value;
				visionApiSettings.prompt = visionPromptInput.value.trim() || defaultVisionApiSettings.prompt;
				
				saveVisionApiSettingsToLocal();
				alert('识图 API 设置已保存！');
				visionApiBackBtn.click();
			});
		}
		// ============================================================
		// 【9. 执行撤回】- 已添加撤回方标识+删除冗余代码
		// ============================================================
		function performWithdraw(timestamp) {
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.chatHistory) return;
			
			// 找到对应时间戳的消息
			const msgIndex = char.chatHistory.findIndex(m => m.timestamp == timestamp);
			if (msgIndex > -1) {
				// 核心：标记【用户撤回】的所有字段（一次性赋值，无冗余）
				const targetMsg = char.chatHistory[msgIndex];
				targetMsg.isWithdrawn = true;
				targetMsg.withdrawBy = 'user'; // 关键：标记是用户撤回的
				targetMsg.withdrawTimestamp = Date.now(); // 撤回时间戳

				// 只保存一次即可，无需重复调用
				saveCharactersToLocal();

				// 更新 UI：找到该行，替换为系统提示 HTML
				const rowEl = document.getElementById(`row-${timestamp}`);
				if (rowEl) {
					const newHtml = generateMessageHTML(char.chatHistory[msgIndex], false);
					const tempDiv = document.createElement('div');
					tempDiv.innerHTML = newHtml;
					rowEl.insertAdjacentHTML('afterend', newHtml);
					rowEl.remove();
				}
			}
		}	
		
		// ============================================================
		// 【新增】批量删除功能逻辑 (完整版)
		// ============================================================

		let isBatchMode = false; // 是否处于批量模式
		let batchSelectedIds = new Set(); // 存储被选中的消息ID
		
		/**
		 * 【修改版】语音条三段式点击交互 + 智能播放逻辑 (支持用户语音)
		 * 状态1 (默认): 只显示语音条
		 * 状态2 (点击1): 显示语音条 + 转文字卡片 + 【触发播放】
		 * 状态3 (点击2): 显示语音条 + 转文字卡片 + 菜单
		 * 状态4 (点击3): 返回状态1
		 */
		function handleVoiceCycleClick(event, msgId, bubbleEl) {
			event.stopPropagation(); // 阻止冒泡
			if (event) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
			}

			// 1. 获取所有相关元素
			const trans = document.getElementById(`trans-${msgId}`);
			const menu = document.getElementById(`menu-${msgId}`);
			
			if (!trans || !menu) return; 

			// 2. 判断当前状态
			const isTransVisible = trans.classList.contains('show');
			const isMenuVisible = menu.classList.contains('show');

			// 3. 根据状态执行下一步操作
			if (!isTransVisible && !isMenuVisible) {
				// ============================================
				// 【状态1 -> 状态2】: 显示转文字 + 请求播放
				// ============================================
				trans.classList.add('show');

				// --- 核心播放逻辑 ---
				const char = characters.find(c => c.id == activeChatId);
				// 查找当前点击的消息对象
				const msgObj = char ? char.chatHistory.find(m => m.timestamp == msgId) : null;

				// 【核心修改】支持 AI 和 用户的语音播放
				if (char && msgObj && msgObj.text) {
					let voiceIdToUse = null;

					// A. 如果是 AI 发出的 ('received')，使用配置给AI的语音ID
				if (msgObj.type === 'received') {
					if (msgObj.isGroupMsg && msgObj.senderName) {
						// 【核心修复：群聊模式下，反向查找对应的通讯录角色提取声音】
						const realChar = characters.find(c => c.name === msgObj.senderName && c.type !== 'group');
						if (realChar && realChar.voice && realChar.voice.id) {
							voiceIdToUse = realChar.voice.id;
						}
					} else if (char.voice && char.voice.id) {
						// 单聊模式，直接取当前角色声音
						voiceIdToUse = char.voice.id;
					}
				}
					// B. 如果是用户自己发出的 ('sent')
					else if (msgObj.type === 'sent') {
						// 逻辑：优先取 [聊天专属用户声线]，没有则取 [全局通用用户声线]
						// 注意：voiceApiSettings 是全局变量，确保已定义
						voiceIdToUse = char.userVoiceId || (typeof voiceApiSettings !== 'undefined' ? voiceApiSettings.userVoiceId : null);
					}

					// 如果找到了有效的声音 ID，调用底层请求播放
					if (voiceIdToUse && voiceIdToUse.trim() !== '') {
						playMinimaxTTS(msgObj.text, voiceIdToUse);
					} else {
						console.warn("未找到对应的语音ID，仅显示文本。MsgType:", msgObj.type);
					}
				}
				// ------------------

			} else if (isTransVisible && !isMenuVisible) {
				// ============================================
				// 【状态2 -> 状态3】: 显示菜单
				// ============================================
				// 调用通用的菜单函数
				toggleBubbleMenu(msgId, bubbleEl); 

			} else { // (isTransVisible && isMenuVisible)
				// ============================================
				// 【状态3 -> 状态1】: 全部隐藏 + 停止播放
				// ============================================
				trans.classList.remove('show');
				menu.classList.remove('show');
				
				// 当收起语音条时，如果正在播放，建议停止，体验更好
				if (typeof currentAudioPlayer !== 'undefined' && currentAudioPlayer) {
					currentAudioPlayer.pause();
					currentAudioPlayer = null;
				}
			}
		}

		// ============================================================
		// 【终极修复版】点击气泡的处理逻辑 (精准放行气泡内的 HTML 交互)
		// ============================================================
		function handleBubbleClickWithMode(event, msgId, bubbleEl) {
			// 【核心修复】：拦截气泡内部的 HTML 交互标签，放行点击事件
			if (event && event.target) {
				// 查找鼠标点击位置最近的交互元素
				const interactiveEl = event.target.closest('button, input, select, a, textarea, details, summary, label, [onclick]');
				
				// 关键判断：确保这个交互元素是气泡【内部生成的子元素】，而不能是气泡容器本身！
				if (interactiveEl && interactiveEl !== bubbleEl && bubbleEl.contains(interactiveEl)) {
					event.stopPropagation(); // 阻止冒泡，防止闪烁
					return; // 直接退出，不弹出气泡菜单，让 HTML 标签自己处理点击效果
				}
			}

			// 1. 【优先判断】检查心声面板是否打开
			const statusModal = document.getElementById('inner-status-modal');
			if (statusModal && statusModal.classList.contains('show')) {
				statusModal.classList.remove('show');
				if (event) event.stopPropagation();
				return;
			}
			
			// 1.5 优先判断是否为语音条
			if (bubbleEl.classList.contains('is-voice')) {
				handleVoiceCycleClick(event, msgId, bubbleEl);
				return; 
			}

			// 2. 批量模式处理
			if (isBatchMode) {
				if (event) event.stopPropagation(); // 阻止冒泡
				handleBatchRowClick(msgId);
			} else {
				// 3. 普通模式，显示气泡菜单
				toggleBubbleMenu(msgId, bubbleEl);
			}
		}

		// 2. 点击整行的逻辑 (仅在批量模式下生效)
		function handleBatchRowClick(msgId) {
			if (!isBatchMode) return;

			const checkbox = document.getElementById(`check-${msgId}`);
			if (!checkbox) return;

			if (batchSelectedIds.has(msgId)) {
				// 取消选中
				batchSelectedIds.delete(msgId);
				checkbox.classList.remove('checked');
			} else {
				// 选中
				batchSelectedIds.add(msgId);
				checkbox.classList.add('checked');
			}

			// 更新底部栏状态
			updateBatchBar();
		}

		// 3. 切换批量模式开关
		function toggleBatchMode(enable) {
			isBatchMode = enable;
			const chatPage = document.getElementById('chat-detail-page');
			const inputBar = document.getElementById('chat-input-bar');
			const batchBar = document.getElementById('batch-action-bar');
			const dropdown = document.getElementById('chat-menu-dropdown');

			// 关闭菜单
			dropdown.classList.remove('show');
			closeAllBubbleMenus(); // 关闭所有气泡小菜单

			if (enable) {
				// 开启：添加CSS类，隐藏输入框，显示操作栏
				chatPage.classList.add('batch-mode-active');
				inputBar.style.display = 'none';
				batchBar.classList.add('show');
				batchSelectedIds.clear(); // 清空旧选择
				updateBatchBar();
			} else {
				// 关闭：移除CSS类，显示输入框，隐藏操作栏
				chatPage.classList.remove('batch-mode-active');
				inputBar.style.display = 'flex';
				batchBar.classList.remove('show');
				// 清除所有视觉选中状态
				document.querySelectorAll('.batch-circle.checked').forEach(el => el.classList.remove('checked'));
			}
		}

		// 4. 更新底部栏文字和按钮状态
		function updateBatchBar() {
			const count = batchSelectedIds.size;
			document.getElementById('batch-count').innerText = count;
			
			const delBtn = document.getElementById('batch-confirm-btn');
			if (count > 0) {
				delBtn.disabled = false;
				delBtn.style.color = '#ff3b30';
			} else {
				delBtn.disabled = true;
				delBtn.style.color = '#ccc';
			}
		}

		// ============================================================
		// 【终极修复版】执行批量删除 (精确区分主订单与子事件，拒绝株连)
		// ============================================================
		function executeBatchDelete() {
			if (batchSelectedIds.size === 0) return;
			
			if (confirm(`确定要删除选中的 ${batchSelectedIds.size} 条消息吗？`)) {
				const char = characters.find(c => c.id == activeChatId);
				if (char && char.chatHistory) {
					
					// 1. 声明集合：区分【主卡片】和【子事件】
					let mainDeliveryIdsToDelete = new Set();
					let mainGiftIdsToDelete = new Set(); 
					let subEventsToDelete = new Set(); // 格式: deliveryId_subType

					// 2. 遍历选中的消息，执行副作用（退款/删清单）并分类收集要连带删除的 ID
					char.chatHistory.forEach(m => {
						if (batchSelectedIds.has(String(m.timestamp))) {
							// 调用通用处理函数 
							processDeletionSideEffects(m, char);

							if (m.isOrderCard) {
								// 情况A：勾选了主卡片，记录主ID，后续连锅端
								if (m.orderType === 'delivery' && m.relatedDeliveryId) {
									mainDeliveryIdsToDelete.add(m.relatedDeliveryId);
								}
								if (m.orderType === 'gift' && m.relatedGiftId) {
									mainGiftIdsToDelete.add(m.relatedGiftId);
								}
							} else if (m.subEventType && m.relatedDeliveryId) {
								// 情况B：勾选了子事件（比如加速提示），只连带删除对应的后台隐藏消息
								subEventsToDelete.add(`${m.relatedDeliveryId}_${m.subEventType}`);
							}
						}
					});
					
					// 3. 过滤聊天记录 (精准拔除)
					char.chatHistory = char.chatHistory.filter(m => {
						// A. 是否是被直接勾选的消息
						const isSelected = batchSelectedIds.has(String(m.timestamp));
						
						// B. 是否是被删外卖主事件的产物 (主卡片没了，相关的提示和后台消息全删)
						const isLinkedToDeletedMainDelivery = m.relatedDeliveryId && mainDeliveryIdsToDelete.has(m.relatedDeliveryId);
						
						// C. 是否是被删礼物主事件的产物
						const isLinkedToDeletedMainGift = m.relatedGiftId && mainGiftIdsToDelete.has(m.relatedGiftId);
						
						// D. 是否是被删子事件的同党 (比如勾选了加速可见提示，就只带走加速的隐藏后台消息，不动主卡片)
						const isLinkedToDeletedSubEvent = m.subEventType && m.relatedDeliveryId && subEventsToDelete.has(`${m.relatedDeliveryId}_${m.subEventType}`);
						
						// 只有上面四个条件全为 false 的消息，才能存活
						return !isSelected && !isLinkedToDeletedMainDelivery && !isLinkedToDeletedMainGift && !isLinkedToDeletedSubEvent;
					});

					saveCharactersToLocal();
					
					// 4. 退出模式并刷新
					toggleBatchMode(false);
					enterChat(activeChatId);
					updateChatInputState();
					renderDeliveryCards(); // 刷新浮窗 UI
				}
			}
		}

		// --- 事件绑定 ---

		// 1. 右上角菜单 -> 开启批量模式
		document.getElementById('menu-batch-delete-btn').addEventListener('click', () => {
			toggleBatchMode(true);
		});

		// 2. 底部栏 -> 取消
		document.getElementById('batch-cancel-btn').addEventListener('click', () => {
			toggleBatchMode(false);
		});

		// 3. 底部栏 -> 确认删除
		document.getElementById('batch-confirm-btn').addEventListener('click', executeBatchDelete);
        // ============================================================
		// 【新增】用户主动拉黑对方逻辑 & 后台动作
		// ============================================================
		const blockUserBtn = document.getElementById('menu-block-user-btn');
		if (blockUserBtn) {
			blockUserBtn.addEventListener('click', () => {
				const chatMenuDropdown = document.getElementById('chat-menu-dropdown');
				if (chatMenuDropdown) chatMenuDropdown.classList.remove('show');

				if (!activeChatId) return;
				const char = characters.find(c => c.id == activeChatId);
				if (!char) return;

				if (char.isBlockedByUser) {
					// --- 解除拉黑 ---
					char.isBlockedByUser = false;
					document.getElementById('block-btn-text').textContent = '拉黑对方';
					// 【核心新增】生成解除拉黑的系统消息
					const sysMsg = {
						text: "你已将对方移出黑名单，可继续线上通讯。",
						type: 'received',
						timestamp: Date.now(),
						isRead: true,
						isSystemMsg: true 
					};
					if (!char.chatHistory) char.chatHistory =[];
					char.chatHistory.push(sysMsg);
					saveCharactersToLocal();
					updateChatInputState();
					document.getElementById('chat-detail-status').textContent = getChatPermanentStatus(char); // 【新增】刷新状态栏为在线
					alert("已解除拉黑。");
					// 立即渲染并滚动到底部
					renderMessageToScreen(sysMsg);
					scrollToBottom();
				} else {
					// --- 执行拉黑 ---
					if (!confirm("确定要拉黑对方吗？\n拉黑后将自动转为线下模式，线上无法再发送消息。")) return;
					
					char.isBlockedByUser = true;
					char.isOnline = false; // 自动切为线下
					document.getElementById('block-btn-text').textContent = '解除拉黑';
					
					// 更新 UI 开关
					const modeCheckbox = document.getElementById('mode-checkbox');
					if (modeCheckbox) modeCheckbox.checked = false;
					updateModeUI(false);
					// 【核心新增】生成拉黑的红色警告系统消息
					const sysMsg = {
						text: "你已将对方拉黑，线上通讯中断。已为您自动切换为线下模式以继续剧情。",
						type: 'received',
						timestamp: Date.now(),
						isRead: true,
						isUserBlockMsg: true  // 特殊标记，用于渲染红色样式
					};
					if (!char.chatHistory) char.chatHistory = [];
					char.chatHistory.push(sysMsg);
					
					saveCharactersToLocal();
					updateChatInputState();
					document.getElementById('chat-detail-status').textContent = getChatPermanentStatus(char); // 【新增】刷新状态栏为线下模式
					// 立即渲染并滚动到底部
					renderMessageToScreen(sysMsg);
					scrollToBottom();
					// 触发后台隐式发送
					triggerAiReactionToBeingBlocked(char.id);
				}
			});
		}

		// 专门用于拉黑的后台反应生成器
		async function triggerAiReactionToBeingBlocked(charId) {
			const char = characters.find(c => c.id == charId);
			if (!char) return;

			// 伪造线下模式提示词
			const messages = prepareMessagesForApi(char);
			
			const targetUserName = (char.userName && char.userName.trim()) ? char.userName.trim() : userInfo.name;
			const pov = char.offlinePov || 'first';
			const povStr = pov === 'third' ? '第三人称(他/她)' : '第一人称(我)';

			messages.push({
				role: "user",
				content: `(系统上帝视角强制触发：用户 "${targetUserName}" 刚刚在手机通讯软件上将你无情拉黑了！红色感叹号出现在了你的屏幕上。现在是线下沉浸式叙事模式，请使用**${povStr}**，结合你的人设、所处环境以及刚才的对话上下文，生动地描写出你发现自己被拉黑这一瞬间的动作、神态和强烈的心理活动以及后续在线下场景中的行为，并设法在线下与用户取得联系。)`
			});

			// 显示状态
			updateChatStatus(charId, "正在生成反应…");
			
			try {
				const settingsToUse = (char.apiSettings && char.apiSettings.baseUrl) ? char.apiSettings : chatApiSettings;
				const responseText = await callOpenAiApi(messages, settingsToUse);

				// 清理并保存结果 (按线下模式规则)
				let cleanText = removeTimestamp(responseText).trim();
				cleanText = cleanText.replace(/\[REF:.*?\]/g, "").trim(); 
				cleanText = cleanText.replace(/\[WITHDRAW\]/g, "").trim();
				cleanText = cleanText.replace(/###/g, "\n");
				// 如果有心声面板数据，可以复用之前 handleAiGenerate 的解析逻辑，这里从简，直接提取纯文本
				if (cleanText.includes('NN_INNER_STATUS::')) {
					cleanText = cleanText.substring(0, cleanText.lastIndexOf('NN_INNER_STATUS::')).trim();
				}

				saveAiMessageInternal(cleanText, charId, 'round_' + Date.now(), null, false);
			} catch(e) {
				console.error("生成被拉黑反应失败:", e);
			} finally {
				updateChatStatus(charId, false);
			}
		}
		// ============================================================
		// 【新增】快速重roll功能逻辑
		// ============================================================
		const quickRerollBtn = document.getElementById('menu-quick-reroll-btn');

		if (quickRerollBtn) {
			quickRerollBtn.addEventListener('click', () => {
				// 1. 关闭下拉菜单
				const chatMenuDropdown = document.getElementById('chat-menu-dropdown');
				if (chatMenuDropdown) chatMenuDropdown.classList.remove('show');

				// 2. 基础检查
				if (!activeChatId) return;
				const char = characters.find(c => c.id == activeChatId);
				if (!char || !char.chatHistory || char.chatHistory.length === 0) {
					alert('当前没有对话记录，无法重roll');
					return;
				}

				// 3. 获取最后一条消息
				const lastMsg = char.chatHistory[char.chatHistory.length - 1];

				// 4. 只能重roll AI 的消息 (type === 'received')
				if (lastMsg.type !== 'received') {
					alert('只能重roll AI 的回复（最后一条消息必须是对方发送的）');
					return;
				}

				// 5. 执行删除逻辑 (复用 handleMenuAction 中的核心逻辑)
				// 5.1 确定要删除的消息组 (处理气泡拆分情况)
				const targetGroupId = lastMsg.groupId;
				let msgsToDelete = [];

				if (targetGroupId) {
					msgsToDelete = char.chatHistory.filter(m => m.groupId === targetGroupId);
				} else {
					msgsToDelete = [lastMsg];
				}

				// 5.2 UI 删除：从界面移除气泡和可能关联的时间戳
				msgsToDelete.forEach(m => {
					const row = document.getElementById(`row-${m.timestamp}`);
					if (row) {
						// 检查上方是否有时间戳，如果有且删除后变孤立，则移除时间戳
						const prevSibling = row.previousElementSibling;
						if (prevSibling && prevSibling.classList.contains('system-time-stamp')) {
							let nextSibling = row.nextElementSibling;
							// 如果下面没有元素了，或者下面也是一个时间戳（虽然不太可能），说明这个时间戳没用了
							if (!nextSibling || nextSibling.classList.contains('system-time-stamp')) {
								prevSibling.remove();
							}
						}
						row.remove();
					}
					if (m.isAiBlockMsg) {
						char.isBlockedByAi = false;
						updateChatInputState();
					}	
				});

				// 5.3 数据删除
				if (targetGroupId) {
					char.chatHistory = char.chatHistory.filter(m => m.groupId !== targetGroupId);
				} else {
					char.chatHistory = char.chatHistory.filter(m => m.timestamp !== lastMsg.timestamp);
				}

				// 6. 保存状态并重新生成
				saveCharactersToLocal();
				// 重新设置最后一条消息的时间戳，防止新生成的消息时间显示异常
				if (char.chatHistory.length > 0) {
					lastMessageTimestamp = char.chatHistory[char.chatHistory.length - 1].timestamp;
				} else {
					lastMessageTimestamp = 0;
				}
				
				renderChatList(); // 更新列表预览
				handleAiGenerate(); // 【核心】触发 AI 重新生成
			});
		}

		// ============================================================
		// 【新增核心功能】长期记忆自动生成系统
		// ============================================================

		/**
		 * 格式化日期为 YY/MM/DD HH:MM
		 */
		function formatLtmTime(timestamp) {
			const date = new Date(timestamp);
			const y = date.getFullYear().toString().slice(-2); // 取后两位
			const m = (date.getMonth() + 1).toString().padStart(2, '0');
			const d = date.getDate().toString().padStart(2, '0');
			const h = date.getHours().toString().padStart(2, '0');
			const min = date.getMinutes().toString().padStart(2, '0');
			return `${y}/${m}/${d} ${h}:${min}`;
		}


		/**
		 * 【修改版】构建记忆总结专用请求体 (加入人设防性别混淆，完美支持群聊群像)
		 */
		function prepareMessagesForMemorySummary(characterName, userName, messagesSlice, offlinePov = 'first', isGroup = false, charPersona = '', userMaskDesc = '') {
			if (!messagesSlice || messagesSlice.length === 0) return[];

			// 计算时间段
			const startTime = formatLtmTime(messagesSlice[0].timestamp);
			const endTime = formatLtmTime(messagesSlice[messagesSlice.length - 1].timestamp);
			const timeHeader = `【${startTime} - ${endTime.split(' ')[1]}】`;

			// 拼接对话内容
			let conversationText = "";
			messagesSlice.forEach(msg => {
				let role = '';
				if (msg.type === 'sent') {
					role = userName;
				} else {
					role = (msg.isGroupMsg && msg.senderName) ? msg.senderName : characterName;
				}
				const safeText = (msg.text || "").replace(/\n/g, " ");
				conversationText += `${role}: ${safeText}\n`;
			});

			// 获取 prompt
			let rawPrompt = "";
			if (isGroup) {
				if (memorySettings && memorySettings.groupLtmPrompt && memorySettings.groupLtmPrompt.trim() !== "") {
					rawPrompt = memorySettings.groupLtmPrompt;
				} else if (typeof DEFAULT_GROUP_LTM_PROMPT !== 'undefined') {
					rawPrompt = DEFAULT_GROUP_LTM_PROMPT;
				} else {
					rawPrompt = '请总结以下群聊对话，群名是{charName}，用户是{userName}。时间：{timeHeader}';
				}
			} else {
				if (memorySettings && memorySettings.ltmPrompt && memorySettings.ltmPrompt.trim() !== "") {
					rawPrompt = memorySettings.ltmPrompt;
				} else if (typeof DEFAULT_LTM_PROMPT !== 'undefined') {
					rawPrompt = DEFAULT_LTM_PROMPT;
				} else {
					rawPrompt = '请总结以下对话，角色是{charName}，用户是{userName}。时间：{timeHeader}';
				}
			}

			let systemContent = rawPrompt
				.split('{charName}').join(characterName)
				.split('{userName}').join(userName)
				.split('{timeHeader}').join(timeHeader);

			// ===============================================================================
            // 【核心强化】人设与性别防混淆补丁 (精准区分群聊与单聊)
			let clarification = "";
			if (isGroup) {
				clarification = `【群内角色设定参考】
群内各发言成员设定如下：
${charPersona || '无特定成员设定'}

【用户设定参考】
用户(${userName})设定：${userMaskDesc || '无'}

【阅读理解提示】
请注意理解以下对话记录中的人物代词与性别关系，避免张冠李戴：
- 发送者标为 "${userName}" 的内容是用户说的话，请参考上方用户设定正确使用性别代词。
- 记录中包含不同群成员的发言，请参考上方【群内角色设定参考】明确各成员的性别与身份。
请在总结时准确分辨各方的行为，以第三人称旁白视角客观记录。

请总结以下对话内容：\n\n${conversationText}`;
			} else {
				let povStr = offlinePov === 'third' ? '第三人称(他/她/名字)' : '第一人称(我)';
				clarification = `【背景设定参考】
你的设定：${charPersona || '无'}
用户(${userName})设定：${userMaskDesc || '无'}

【阅读理解提示】
请注意理解以下对话记录中的人物代词与性别关系，避免张冠李戴：
- 发送者标为 "${userName}" 的内容是用户说的话，请参考上方用户设定正确使用性别代词。
- 发送者标为 "${characterName}" 的内容是你(AI角色)说的话，请参考上方你的设定正确使用性别代词。
- 在这段记录中，你(AI角色)使用了**${povStr}**来描述自己的行为，并使用了“你”来指代用户。
请在总结时准确分辨双方的行为，并在必要时参考设定避免性别代词错误。

请总结以下对话内容：\n\n${conversationText}`;
			}
			// ===============================================================================

			return [
				{ role: "system", content: systemContent },
				{ role: "user", content: clarification }
			];
		}
		// ============================================================
		// 【修改后】手动触发总结逻辑 (调用共用函数)
		// ============================================================
		async function handleManualSummary(charId) {
			const char = characters.find(c => c.id == charId);
			if (!char) return;

			const btn = document.getElementById('manual-summary-btn');
			const originalText = btn.innerHTML;
			
			// 1. 基础检查
			const pendingCount = char.msgCountSinceSummary || 0;
			if (pendingCount <= 0) {
				alert("当前没有新的对话记录需要总结。");
				return;
			}

			// 2. 锁定按钮 UI
			btn.disabled = true;
			btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在读取记忆并生成总结...';

			try {
				// 3. 准备素材：精准回溯，完全去除上限
				let sliceIndex = 0;
				let roundsFound = 0;
				let lastGroupId = null;

				// 从最新消息往回找，数出真正的“AI回复轮数”
				for (let i = char.chatHistory.length - 1; i >= 0; i--) {
					const msg = char.chatHistory[i];
					
					// 通过 groupId 识别，确保 AI 拆分的多个气泡只算作 1 轮
					if (msg.type === 'received' && msg.groupId && msg.groupId !== lastGroupId) {
						roundsFound++;
						lastGroupId = msg.groupId;
					}
					
					// 当数到的轮数刚好等于积压的轮数(pendingCount)时，就是上次总结的分界线
					if (roundsFound === pendingCount) {
						// 在这个分界线的基础上，再额外往前多拿 5 条消息作为前情提要上下文
						sliceIndex = Math.max(0, i - 5);
						break;
					}
				}

			// 直接切出从分界线到最新的【所有消息】，没有任何 100 条的限制！
			const messagesToSummarize = char.chatHistory.slice(sliceIndex);
			if (messagesToSummarize.length === 0) {
				throw new Error("找不到聊天记录数据");
			}
				
				// ============================================================
				// 【修复】正确提取并固化预设面具的身份名字与设定
				// ============================================================
				let currentUserName = userInfo.name;
				let currentUserMask = userInfo.mask || "无特定设定";

				if (char.userMaskId) {
					const boundMask = userMasks.find(m => m.id === char.userMaskId);
					if (boundMask) {
						if (boundMask.name) currentUserName = boundMask.name;
						if (boundMask.mask) currentUserMask = boundMask.mask;
					}
				} else if (char.userName && char.userName.trim()) {
					currentUserName = char.userName.trim();
					if (char.userMask) currentUserMask = char.userMask;
				}

				// 【新增】智能区分群聊成员人设和单聊人设
				let charPersonaDesc = "";
				if (char.type === 'group') {
					let membersInfo = [];
					if (char.members && char.members.length > 0) {
						char.members.forEach(m => {
							if (m.type === 'existing') {
								const realChar = characters.find(c => c.id === m.id);
								if (realChar) membersInfo.push(`[${realChar.name}]: ${realChar.persona || '无设定'}`);
							} else if (m.type === 'npc') {
								membersInfo.push(`[${m.data.name}]: ${m.data.persona || '无设定'}`);
							}
						});
					}
					charPersonaDesc = membersInfo.length > 0 ? membersInfo.join('\n') : "无成员设定";
				} else {
					charPersonaDesc = char.persona || "无设定";
				}

				// 4. 【核心修改】调用共用的构建函数，传入人设等全量信息
				const summaryMessages = prepareMessagesForMemorySummary(
					char.name, 
					currentUserName, 
					messagesToSummarize, 
					char.offlinePov, 
					char.type === 'group',
					charPersonaDesc,   // 传入智能提取的群成员/单人人设
					currentUserMask    // 传入用户面具
				);

				// 5. 调用 API
				const useLtmSettings = (memorySettings.ltmApi && memorySettings.ltmApi.apiKey && memorySettings.ltmApi.baseUrl) 
									? memorySettings.ltmApi 
									: chatApiSettings;

				const summaryResult = await callOpenAiApi(summaryMessages, useLtmSettings);

				// 6. 保存结果
				if (summaryResult) {
					if (!char.longTermMemories) char.longTermMemories =[];
					char.longTermMemories.push(summaryResult);
					
					const maxMem = parseInt(memorySettings.ltmMax) || 5;
					while (char.longTermMemories.length > maxMem) {
						char.longTermMemories.shift();
					}

					char.msgCountSinceSummary = 0;
					saveCharactersToLocal();

					// 7. 刷新当前页面
					renderLongTermMemoryPage();
					alert("总结生成成功！");
				}

			} catch (error) {
				console.error("手动总结失败:", error);
				alert("总结失败: " + error.message);
			} finally {
				// 恢复按钮状态
				btn.disabled = false;
				btn.innerHTML = originalText;
			}
		}
		
		/**
		 * 触发长期记忆生成 (后台静默运行) - 修正版
		 * @param {Object} character 角色对象
		 */
		async function triggerLongTermMemoryUpdate(character) {
			// 1. 基础开关与配置检查
			if (!memorySettings.ltmEnabled) return;
			
			const interval = parseInt(memorySettings.ltmInterval) || 10;
			if (interval <= 0) return;

			// 初始化计数器（如果不存在）
			if (typeof character.msgCountSinceSummary === 'undefined') {
				character.msgCountSinceSummary = 0;
			}
			
			// 调试日志：查看当前进度
			console.log(`[LTM Check] 当前计数: ${character.msgCountSinceSummary} / 目标: ${interval}`);

			// 如果未达到触发阈值，直接返回
			if (character.msgCountSinceSummary < interval) return;

			// 调试日志：触发记忆总结
			console.log(`[LTM] 🚀 触发自动总结请求：角色 ${character.name}`);

			// 2. 准备素材 (取最近 N 条消息)
			// 策略：获取比间隔数稍多一点的消息(例如2倍)，确保总结时有足够的上下文，但最少取10条
			const sliceCount = Math.max(10, interval * 2);
			const messagesToSummarize = character.chatHistory.slice(-sliceCount);
			
			if (messagesToSummarize.length === 0) return;
			// ============================================================
			// 【修复点】正确获取面具设定的名字与设定，传给人设防混淆
			// ============================================================
			let currentUserName = userInfo.name;
			let currentUserMask = userInfo.mask || "无特定设定";

			if (character.userMaskId) {
				const boundMask = userMasks.find(m => m.id === character.userMaskId);
				if (boundMask) {
					if (boundMask.name) currentUserName = boundMask.name;
					if (boundMask.mask) currentUserMask = boundMask.mask;
				}
			} else if (character.userName && character.userName.trim()) {
				currentUserName = character.userName.trim();
				if (character.userMask) currentUserMask = character.userMask;
			}

			// 【新增】智能区分群聊成员人设和单聊人设
			let charPersonaDesc = "";
			if (character.type === 'group') {
				let membersInfo = [];
				if (character.members && character.members.length > 0) {
					character.members.forEach(m => {
						if (m.type === 'existing') {
							const realChar = characters.find(c => c.id === m.id);
							if (realChar) membersInfo.push(`[${realChar.name}]: ${realChar.persona || '无设定'}`);
						} else if (m.type === 'npc') {
							membersInfo.push(`[${m.data.name}]: ${m.data.persona || '无设定'}`);
						}
					});
				}
				charPersonaDesc = membersInfo.length > 0 ? membersInfo.join('\n') : "无成员设定";
			} else {
				charPersonaDesc = character.persona || "无设定";
			}

			// 3. 【核心修改】调用专门的总结 Prompt 构建函数，传入群聊判断与人设信息
			const summaryMessages = prepareMessagesForMemorySummary(
				character.name, 
				currentUserName, 
				messagesToSummarize, 
				character.offlinePov, 
				character.type === 'group',
				charPersonaDesc,   // 传入智能提取的群成员/单人人设
				currentUserMask    // 传入用户面具
			);

			// 4. 后台静默执行 API 请求
			try {
				// 智能选择 API 配置：如果有 LTM 专用配置且有效，则优先使用；否则回退到主聊天配置
				const useLtmSettings = (memorySettings.ltmApi && memorySettings.ltmApi.apiKey && memorySettings.ltmApi.baseUrl) 
									? memorySettings.ltmApi 
									: chatApiSettings;

				//调试台显示
				console.log("[LTM] 正在发送 API 请求...");
				
				const summaryResult = await callOpenAiApi(summaryMessages, useLtmSettings);
				
				if (summaryResult) {
					console.log(`[LTM] ✅ 总结成功: ${summaryResult}`);

					// --- 数据保存逻辑 ---
					
					// 确保数组存在
					if (!character.longTermMemories) character.longTermMemories =[];

					// 存入新生成的记忆
					character.longTermMemories.push(summaryResult);

					// 处理最大条数限制 (FIFO: 超过限制删除最早的)
					const maxMem = parseInt(memorySettings.ltmMax) || 5;
					while (character.longTermMemories.length > maxMem) {
						character.longTermMemories.shift(); // 删除第一个（最早的）
					}

					// 【关键】重置计数器
					character.msgCountSinceSummary = 0;

					// 持久化保存
					saveCharactersToLocal();

				} else {
					console.warn("[LTM] API 返回内容为空");
				}
			} catch (error) {
				console.error("[LTM] ❌ 后台记忆总结失败:", error);
			}
		}
				
		// ============================================================
        // 【新增功能】聊天设置页面逻辑
        // ============================================================

        // 1. 获取 DOM 元素
        const menuChatSettingsBtn = document.getElementById('menu-chat-settings-btn');
        const chatSettingPage = document.getElementById('chat-setting-page');
        const chatSettingTop = document.getElementById('chat-setting-top');
        
        // 【修正点】改名为 chatSettingBackBtn 防止冲突
        const chatSettingBackBtn = document.querySelector('#chat-setting-top .top-bar-back'); 
        
        // 【修正点】改名为 chatSettingSaveBtn 保持风格统一
        const chatSettingSaveBtn = document.getElementById('chat-setting-save-btn');
        
        const settingDeleteBtn = document.getElementById('setting-delete-chat-btn');
		const coverChangeModal = document.getElementById('cover-change-modal');
		const coverUrlInput = document.getElementById('cover-url-input');
		const cancelChangeCoverBtn = document.getElementById('cancel-change-cover-btn');
		const confirmChangeCoverBtn = document.getElementById('confirm-change-cover-btn');
        // 表单元素
        const settingAvatarUploader = document.getElementById('setting-avatar-uploader');
        const settingNameInput = document.getElementById('setting-character-name');
        const settingPersonaInput = document.getElementById('setting-character-persona');
        const settingVoiceInput = document.getElementById('setting-character-voice');
        const settingTimeCheck = document.getElementById('setting-time-awareness');
        const settingWbContainer = document.getElementById('setting-worldbook-container');
		const settingBgUrlInput = document.getElementById('setting-character-bg-url');
		const settingUserAvatarUploader = document.getElementById('setting-user-avatar-uploader');
		const settingUserAvatarInput = document.getElementById('setting-user-avatar-input');
		const settingUserNameInput = document.getElementById('setting-user-name');
		
        // 临时变量，用于存储设置页面的头像（未保存前）
        let tempSettingAvatar = ''; 
		let tempSettingUserAvatar = '';

        // 2. 进入设置页面 (数据回显)
       // ============================================================
        // 【重构】聊天设置入口 (区分私聊/群聊)
        // ============================================================
        if (menuChatSettingsBtn) {
            // 移除旧监听 (防止重复)
            const newBtn = menuChatSettingsBtn.cloneNode(true);
            menuChatSettingsBtn.parentNode.replaceChild(newBtn, menuChatSettingsBtn);

            newBtn.addEventListener('click', () => {
                const dropdown = document.getElementById('chat-menu-dropdown');
                if (dropdown) dropdown.classList.remove('show');

                if (!activeChatId) return;
                const char = characters.find(c => c.id == activeChatId);
                if (!char) return;

                // --- 分支 A：群聊设置 ---
                if (char.type === 'group') {
                    // 1. 回显基础信息
					document.getElementById('setting-group-name').value = char.name;
					document.getElementById('setting-group-context').value = char.persona;
					document.getElementById('setting-group-bg-url').value = char.backgroundImage || '';
					document.getElementById('setting-group-time').checked = char.timeAware || false;
					document.getElementById('setting-group-sync').checked = char.syncHistory || false;

					// 【新增】回显群聊专属用户设定
					renderUserMaskSelectOptions('setting-group-user-mask-select', char.userMaskId || '');
					
					tempSettingGroupUserAvatar = char.userAvatar || '';
					const userUploader = document.getElementById('setting-group-user-avatar-uploader');
					if (userUploader) {
					    if (tempSettingGroupUserAvatar) {
						    userUploader.innerHTML = `<img src="${tempSettingGroupUserAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
					    } else {
						    userUploader.innerHTML = '<i class="fas fa-camera" style="font-size: 20px;"></i>';
					    }
                    }

                    // 2. 回显头像
                    tempSettingAvatar = char.avatar || ''; // 复用这个全局变量暂存头像
                    const uploader = document.getElementById('setting-group-avatar-uploader');
                    if (tempSettingAvatar) {
                        uploader.innerHTML = `<img src="${tempSettingAvatar}" style="width:100%;height:100%;object-fit:cover;">`;
                    } else {
                        uploader.innerHTML = '<i class="fas fa-users" style="font-size:24px;"></i>';
                    }

                     // 3. 回显成员
                    tempSettingNpcs = []; // 【关键】每次进入设置页，先清空临时NPC容器
                    renderGroupSettingsMembers(char);

                    // 4. 回显 API
                    const api = char.apiSettings || {};
                    document.getElementById('setting-group-api-url').value = api.baseUrl || '';
                    document.getElementById('setting-group-api-key').value = api.apiKey || '';
                    document.getElementById('setting-group-api-temp').value = api.temperature || '';
                    // 模型下拉框处理...
                    const grpModelSel = document.getElementById('setting-group-model-select');
                    if (api.model) {
                        grpModelSel.innerHTML = `<option value="${api.model}" selected>${api.model}</option>`;
                    } else {
                        grpModelSel.innerHTML = `<option value="">使用全局设置</option>`;
                    }
					// 【新增】回显群聊世界书
                    const settingGrpWbContainer = document.getElementById('setting-group-worldbook-container');
                    if (settingGrpWbContainer) {
                        renderWorldbookSelection(settingGrpWbContainer, char.worldBookIds ||[]);
                    }
                    switchPage('group-setting-page');
                    switchTopBar('group-setting-top');
                } 
                // --- 分支 B：私聊设置 (原逻辑) ---
                 else {
                    // --- A. 填充基础数据 ---
                    settingNameInput.value = char.name || '';
                    document.getElementById('setting-character-group').value = char.group || '';
                    settingPersonaInput.value = char.persona || '';
                    settingVoiceInput.value = (char.voice && char.voice.id) ? char.voice.id : '';
                    settingTimeCheck.checked = char.timeAware || false;
                    
                   const settingPovSelect = document.getElementById('setting-offline-pov');
					if (settingPovSelect) settingPovSelect.value = char.offlinePov || 'first';

					// 【修改】处理聊天专用用户面具回显 (改为下拉框)
					renderUserMaskSelectOptions('setting-user-mask-select', char.userMaskId || '');
                    
                    // --- B. 处理头像与背景回显 ---
                    tempSettingAvatar = char.avatar || '';
                    if (tempSettingAvatar) {
                        settingAvatarUploader.innerHTML = `<img src="${tempSettingAvatar}" style="width:100%; height:100%; object-fit:cover;">`;
                    } else {
                        settingAvatarUploader.innerHTML = '<i class="fas fa-camera"></i>';
                    }
                    
                    const bgUrlInput = document.getElementById('setting-character-bg-url');
                    if (bgUrlInput) {
                        bgUrlInput.value = char.backgroundImage || '';
                    }

                    // --- C. 处理世界书回显 ---
                    const settingWbContainer = document.getElementById('setting-worldbook-container');
                    renderWorldbookSelection(settingWbContainer, char.worldBookIds || []);

                    // --- D. 处理表情包回显 ---
                    const settingEmoContainer = document.getElementById('setting-emoticon-select-container');
                    renderEmoticonSelection(settingEmoContainer, char.emoticonCategories || []);
                    
                   
                    
                    // --- F. 专属聊天api设置回显 ---
                    const charApi = char.apiSettings || {};
                    document.getElementById('setting-api-url').value = charApi.baseUrl || '';
                    document.getElementById('setting-api-key').value = charApi.apiKey || '';
                    document.getElementById('setting-api-temp').value = charApi.temperature || '';
                    
                    const settingModelSelect = document.getElementById('setting-model-select');
                    if (charApi.model) {
                        settingModelSelect.innerHTML = `<option value="${charApi.model}" selected>${charApi.model}</option>`;
                    } else {
                        settingModelSelect.innerHTML = `<option value="">使用全局设置</option>`;
                    }

                    // --- G. 切换页面 ---
                    switchPage('chat-setting-page');
                    switchTopBar('chat-setting-top');
                }
            });
        }

        // --- 辅助：渲染群设置里的成员列表 ---
        function renderGroupSettingsMembers(groupChar) {
            const container = document.getElementById('setting-group-members-container');
            container.innerHTML = '';
            
            // 1. 列出所有通讯录角色
            if (characters.length > 0) {
                const validChars = characters.filter(c => c.type !== 'group');
                if (validChars.length > 0) {
                    container.innerHTML += `<div style="font-size:12px;color:#999;background:#f9f9f9;padding:4px 10px;font-weight:bold;">通讯录角色</div>`;
                    validChars.forEach(char => {
                        // 检查是否已经在群里
                        const isMember = groupChar.members.some(m => m.type === 'existing' && m.id === char.id);
                        
                        const label = document.createElement('label');
                        label.className = 'checkbox-item';
                        label.innerHTML = `
                            <input type="checkbox" value="existing:${char.id}" ${isMember ? 'checked' : ''}>
                            <span class="custom-check-circle"></span>
                            <div style="display:flex; align-items:center;">
                                <img src="${char.avatar || ''}" style="width:24px; height:24px; border-radius:4px; margin-right:8px; object-fit:cover; background:#eee;">
                                <span>${char.name}</span>
                            </div>
                        `;
                        container.appendChild(label);
                    });
                }
            }
            
            // 2. 列出群里现有的 NPC
            // 注意：因为 NPC 数据只存在于 groupChar.members 里，没有全局列表
            // 所以我们需要遍历 groupChar.members 里的 NPC 并显示出来，允许取消勾选（即删除）
            const npcMembers = groupChar.members.filter(m => m.type === 'npc');
            if (npcMembers.length > 0) {
                container.innerHTML += `<div style="font-size:12px;color:#999;background:#f9f9f9;padding:4px 10px;font-weight:bold;margin-top:5px;">当前 NPC</div>`;
                npcMembers.forEach((m, idx) => {
                    // value 格式：npc_data:索引 (我们需要把数据暂存或者直接用索引去原数组找)
                    // 为了简化，我们这里只负责展示。如果取消勾选，保存时会移除。
                    // 这里的 value 稍微特殊点，我们存 JSON 字符串，方便保存时读取
                    // 但 value 有长度限制，且含特殊字符。
                    // 更好的办法：把 NPC 临时存到一个全局变量 tempSettingsNPCs 中
                    
                    const label = document.createElement('label');
                    label.className = 'checkbox-item';
                    // 这里的 value 标记为 old_npc:索引
                    label.innerHTML = `
                        <input type="checkbox" value="old_npc:${idx}" checked>
                        <span class="custom-check-circle"></span>
                        <div style="display:flex; align-items:center;">
                            <img src="${m.data.avatar || ''}" style="width:24px; height:24px; border-radius:4px; margin-right:8px; object-fit:cover; background:#eee;">
                            <span>${m.data.name} <span class="npc-tag">NPC</span></span>
                        </div>
                    `;
                    container.appendChild(label);
                });
            }
        }

        // --- 群聊设置页：保存逻辑 (含成员变动通知 + 状态栏刷新) ---
        document.getElementById('group-setting-save-btn').addEventListener('click', () => {
            if (!activeChatId) return;
            const char = characters.find(c => c.id == activeChatId);
            if (!char || char.type !== 'group') return;

            // ==========================
            // A. 保存前的状态快照 (用于比对成员变动)
            //Map结构: ID -> Name
            const oldMemberMap = new Map();
            if (char.members) {
                char.members.forEach(m => {
                    const id = (m.type === 'existing') ? m.id : m.data.id;
                    let name = "未知成员";
                    if (m.type === 'existing') {
                        const existingChar = characters.find(c => c.id === m.id);
                        if (existingChar) name = existingChar.name;
                    } else {
                        name = m.data.name;
                    }
                    oldMemberMap.set(id, name);
                });
            }
            // ==========================

           // 1. 基础信息
			char.name = document.getElementById('setting-group-name').value.trim();
			char.persona = document.getElementById('setting-group-context').value.trim();
			char.backgroundImage = document.getElementById('setting-group-bg-url').value.trim();
			char.timeAware = document.getElementById('setting-group-time').checked;
			char.syncHistory = document.getElementById('setting-group-sync').checked;
			char.avatar = tempSettingAvatar;
			
			// 保存群聊世界书
			const selectedWbs =[];
			const wbContainer = document.getElementById('setting-group-worldbook-container');
			if (wbContainer) {
				wbContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(box => {
					selectedWbs.push(box.value);
				});
			}
			char.worldBookIds = selectedWbs;
			
			// 兼容带和不带 select 后缀的 ID
			const groupMaskSel = document.getElementById('setting-group-user-mask-select') || document.getElementById('setting-group-user-mask');
			if (groupMaskSel) {
				char.userMaskId = groupMaskSel.value;
			}

            // 2. API (防空保护)
			const sApiUrl = document.getElementById('setting-group-api-url');
			const sApiKey = document.getElementById('setting-group-api-key');
			const sModel = document.getElementById('setting-group-model-select');
			const sTemp = document.getElementById('setting-group-api-temp');

            char.apiSettings = {
                baseUrl: sApiUrl ? sApiUrl.value.trim() : '',
                apiKey: sApiKey ? sApiKey.value.trim() : '',
                model: sModel ? sModel.value : '',
                temperature: sTemp ? sTemp.value : ''
            };

            // 3. 成员重新构建 (构建新列表)
            const newMembers = [];
            const container = document.getElementById('setting-group-members-container');
            const checkboxes = container.querySelectorAll('input:checked');
            
            checkboxes.forEach(box => {
                const [type, val] = box.value.split(':');
                
                if (type === 'existing') {
                    newMembers.push({ type: 'existing', id: val });
                } else if (type === 'old_npc') {
                    const oldNpcs = char.members.filter(m => m.type === 'npc');
                    const idx = parseInt(val);
                    if (oldNpcs[idx]) {
                        newMembers.push(oldNpcs[idx]);
                    }
                } else if (type === 'temp_npc') {
                    const idx = parseInt(val);
                    if (tempSettingNpcs[idx]) {
                        newMembers.push({ type: 'npc', data: tempSettingNpcs[idx] });
                    }
                }
            });
            
            // 4. 比对差异并生成系统消息
            const newMemberIds = new Set();
            const changeLogs = [];

            newMembers.forEach(m => {
                const id = (m.type === 'existing') ? m.id : m.data.id;
                newMemberIds.add(id);
                
                // 如果旧列表里没有这个ID，说明是新加入的
                if (!oldMemberMap.has(id)) {
                    let name = "未知成员";
                    if (m.type === 'existing') {
                        const c = characters.find(x => x.id === m.id);
                        if (c) name = c.name;
                    } else {
                        name = m.data.name;
                    }
                    changeLogs.push({ type: 'join', name: name });
                }
            });

            // 检查谁退出了 (旧列表有，新列表没有)
            oldMemberMap.forEach((name, id) => {
                if (!newMemberIds.has(id)) {
                    changeLogs.push({ type: 'leave', name: name });
                }
            });

            // 写入系统消息到聊天记录 (支持批量删除)
            if (changeLogs.length > 0) {
                if (!char.chatHistory) char.chatHistory = [];
                const now = Date.now();
                
                changeLogs.forEach((log, index) => {
                    char.chatHistory.push({
                        text: log.type === 'join' ? `"${log.name}" 加入了群聊` : `"${log.name}" 退出了群聊`,
                        type: 'received', // 保持在左边或者作为系统消息
                        timestamp: now + index, // 确保时间戳微小差异
                        isRead: true,
                        isSystemMsg: true, // 【关键】使用这个标记，样式为灰色，且支持批量删除
                        isGroupMsg: true
                    });
                });
            }

            // 5. 应用更改并保存
            tempSettingNpcs = []; // 清空临时 NPC
            char.members = newMembers;

            saveCharactersToLocal();
            
            // 6. 界面刷新
            renderChatList();
            document.getElementById('chat-detail-title').textContent = char.name;
            
            // 返回聊天详情页
            switchPage('chat-detail-page');
            switchTopBar('chat-detail-top');

            // 【核心修复】立即渲染新插入的系统消息，并强制滚动到底部
            if (changeLogs.length > 0) {
                // 因为我们刚刚推入了新消息，这里只渲染最后 N 条
                const newMsgs = char.chatHistory.slice(-changeLogs.length);
                newMsgs.forEach(msg => renderMessageToScreen(msg));
                scrollToBottom();
            }

            // 【核心修复】立即刷新顶部状态栏的人数显示
            const statusEl = document.getElementById('chat-detail-status');
            if (statusEl) {
                statusEl.textContent = getChatPermanentStatus(char);
            }
        });

        // --- 群聊设置页：返回按钮 ---
        document.querySelector('#group-setting-top .top-bar-back').addEventListener('click', () => {
            switchPage('chat-detail-page');
            switchTopBar('chat-detail-top');
        });
        
        // --- 群聊设置页：解散群聊 ---
        document.getElementById('setting-delete-group-btn').addEventListener('click', () => {
            if (confirm("确定要解散群聊并删除所有记录吗？")) {
                const idx = characters.findIndex(c => c.id == activeChatId);
                if (idx > -1) {
                    characters.splice(idx, 1);
                    saveCharactersToLocal();
                    activeChatId = null;
                    renderChatList();
                    switchPage('chat-page');
                    switchTopBar('chat-top');
                    document.getElementById('chat-input-bar').style.display = 'none';
                    document.getElementById('main-bottom-nav').classList.remove('hidden');
                    document.getElementById('main-bottom-nav').style.display = 'flex';
                    document.getElementById('main-content-area').classList.remove('no-bottom-nav');
                }
            }
        });
        
        // --- 群聊设置页：头像上传绑定 ---
        const grpSetAvatarUploader = document.getElementById('setting-group-avatar-uploader');
        const grpSetAvatarInput = document.getElementById('setting-group-avatar-input');
        if (grpSetAvatarUploader) {
            grpSetAvatarUploader.addEventListener('click', () => grpSetAvatarInput.click());
            grpSetAvatarInput.addEventListener('change', async function(e) {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (evt) => {
                    tempSettingAvatar = await compressImage(evt.target.result, 150, 0.8);
                    grpSetAvatarUploader.innerHTML = `<img src="${tempSettingAvatar}" style="width:100%;height:100%;object-fit:cover;">`;
                };
                reader.readAsDataURL(file);
                this.value = '';
            });
        }
        
        // --- 群聊设置页：拉取模型 ---
        const grpFetchBtn = document.getElementById('setting-group-fetch-models-btn');
        if (grpFetchBtn) {
            grpFetchBtn.addEventListener('click', () => {
                const url = document.getElementById('setting-group-api-url');
                const key = document.getElementById('setting-group-api-key');
                const sel = document.getElementById('setting-group-model-select');
                fetchModelsForApi(url, key, sel, grpFetchBtn, {});
            });
        }

        // 3. 头像上传逻辑 (设置页专用) - 【修正版】
		const settingAvatarUploadInput = document.getElementById('setting-avatar-upload-input');
        if (settingAvatarUploader && settingAvatarUploadInput) {
            // 点击可见的头像区域
            settingAvatarUploader.addEventListener('click', () => {
                // 去触发隐藏的文件输入框
                settingAvatarUploadInput.click();
            });

            // 监听隐藏的文件输入框的 change 事件
            settingAvatarUploadInput.addEventListener('change', async function(e) { // 启用 async
                const file = e.target.files[0];
                if (!file || !file.type.startsWith('image/')) return;
                
                const reader = new FileReader();
                reader.onload = async (event) => { // 启用 async
                    try {
                        // 【方案】角色头像：压缩成 120px 小缩略图
                        tempSettingAvatar = await compressImage(event.target.result, 120, 0.8);
                        settingAvatarUploader.innerHTML = `<img src="${tempSettingAvatar}" style="width:100%; height:100%; object-fit:cover;">`;
                    } catch (error) {
                        alert('图片处理失败: ' + error.message);
                    }
                };
                reader.readAsDataURL(file);
                this.value = ''; // 清空 input 防止重复选择不触发 change
            });
        }

        // 4. 保存设置逻辑
        if (chatSettingSaveBtn) {
            chatSettingSaveBtn.addEventListener('click', () => {
                if (!activeChatId) return;
                const charIndex = characters.findIndex(c => c.id == activeChatId);
                if (charIndex === -1) return;
				// 验证必填项
                const newName = settingNameInput.value.trim();
                if (!newName) {
                    alert('角色名字不能为空！');
                    return;
				}	
					// 获取选中的世界书
                const selectedWbs = [];
                if (settingWbContainer) {
                    settingWbContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(box => {
                        selectedWbs.push(box.value);
                    });
                }
				// 【新增】获取设置页勾选的表情分类
				const selectedEmos = [];
				// 注意：这里的 ID 必须和 HTML 里的 <div id="setting-emoticon-select-container"> 一致
				const emoContainer = document.getElementById('setting-emoticon-select-container');
				if (emoContainer) {
					const checkedBoxes = emoContainer.querySelectorAll('input[type="checkbox"]:checked');
					checkedBoxes.forEach(box => {
						selectedEmos.push(box.value);
					});
				}
				

				// 更新角色对象
                const updatedChar = characters[charIndex];
                updatedChar.name = newName;
				updatedChar.group = document.getElementById('setting-character-group').value.trim(); 
                updatedChar.avatar = tempSettingAvatar; // 保存头像
                updatedChar.persona = settingPersonaInput.value.trim();
                updatedChar.voice = { provider: 'minimax', id: settingVoiceInput.value.trim() };
                updatedChar.timeAware = settingTimeCheck.checked;
				const settingPovSelect = document.getElementById('setting-offline-pov');
                if (settingPovSelect) {
                    updatedChar.offlinePov = settingPovSelect.value;
                }
                if (document.getElementById('setting-user-mask-select')) {
					updatedChar.userMaskId = document.getElementById('setting-user-mask-select').value;
				}
                updatedChar.worldBookIds = selectedWbs;
				updatedChar.emoticonCategories = selectedEmos;
				if (document.getElementById('setting-user-mask-select')) {
					updatedChar.userMaskId = document.getElementById('setting-user-mask-select').value;
				}

				// 2. (可选) 清理该角色身上残留的旧版专属数据，让数据更干净
				delete updatedChar.userName;
				delete updatedChar.userAvatar;
				delete updatedChar.userMask;
				
				const bgUrlInput = document.getElementById('setting-character-bg-url');
				if (bgUrlInput) {
					updatedChar.backgroundImage = bgUrlInput.value.trim();
				}
				updatedChar.apiSettings = {
                    baseUrl: document.getElementById('setting-api-url').value.trim(),
                    apiKey: document.getElementById('setting-api-key').value.trim(),
                    model: document.getElementById('setting-model-select').value,
                    temperature: document.getElementById('setting-api-temp').value
                };
				
				// 【核心修改】读取背景 URL 而不是上传文件
				if (settingBgUrlInput) {
					updatedChar.backgroundImage = settingBgUrlInput.value.trim();
				}

				// 应用背景图 (修改版：应用到 Body)
                if (typeof StyleManager !== 'undefined') {
                    StyleManager.checkBg(); // 让管理器去处理 body 和透明度
                } else {
                    // 降级处理
                    document.body.style.backgroundImage = updatedChar.backgroundImage ? `url('${updatedChar.backgroundImage}')` : '';
                    document.body.style.backgroundAttachment = 'fixed';
                    if (contentArea) contentArea.style.background = updatedChar.backgroundImage ? 'transparent' : '';
                }
				
               // --- 基于面具系统实时刷新用户头像 ---
				const rightAvatars = document.querySelectorAll('.chat-msg-row.right .msg-avatar');

				// 确定要渲染的头像：默认用全局头像
				let finalRenderAvatar = userInfo.avatar;

				// 如果绑定了预设面具，去 userMasks 里把面具头像挖出来覆盖
				if (updatedChar.userMaskId) {
					const boundMask = userMasks.find(m => m.id === updatedChar.userMaskId);
					if (boundMask && boundMask.avatar) {
						finalRenderAvatar = boundMask.avatar;
					}
				}

				// 批量更新屏幕上的头像
				rightAvatars.forEach(container => {
					if (finalRenderAvatar) {
						container.innerHTML = `<img src="${finalRenderAvatar}">`;
					} else {
						container.innerHTML = `<i class="${userInfo.avatarIcon || 'fas fa-user'}"></i>`;
					}
				});
				
                // 持久化保存
                saveCharactersToLocal();

                // ============================================================
                // 【核心修复】立即刷新当前聊天窗口的 UI
                // ============================================================
                
                // 1. 更新顶部栏标题
                const detailTitle = document.getElementById('chat-detail-title');
                if (detailTitle) detailTitle.textContent = newName;
                
                const targetNameEl = document.getElementById('chat-target-name');
                if (targetNameEl) targetNameEl.textContent = newName;

                // 2. 【新增】遍历当前屏幕上的消息气泡，实时更新头像
                // 获取所有左侧（对方）消息的头像容器
                const leftAvatars = document.querySelectorAll('.chat-msg-row.left .msg-avatar');
                leftAvatars.forEach(container => {
                    if (tempSettingAvatar) {
                        // 如果有新头像，替换为 img 标签
                        container.innerHTML = `<img src="${tempSettingAvatar}">`;
                    } else {
                        // 如果清除了头像，恢复为图标
                        container.innerHTML = `<i class="fas fa-user"></i>`;
                    }
                });

                // 3. 更新列表页预览
                renderChatList();

                alert('设置已保存！');

                // 返回聊天详情页
                switchPage('chat-detail-page');
                switchTopBar('chat-detail-top');
				scrollToBottom();
            });
        }

        // 5. 返回按钮逻辑
        // 【修正点】使用新的变量名
        if (chatSettingBackBtn) {
            chatSettingBackBtn.addEventListener('click', () => {
                switchPage('chat-detail-page');
                switchTopBar('chat-detail-top');
				scrollToBottom();
            });
        }
        
        // 6. 删除对话按钮逻辑 (从设置页删除)
        if (settingDeleteBtn) {
            settingDeleteBtn.addEventListener('click', () => {
                if (confirm('⚠️ 高能预警\n\n确定要彻底删除该角色及所有聊天记录吗？\n此操作【无法恢复】！')) {
                    const charIndex = characters.findIndex(c => c.id == activeChatId);
                    if (charIndex > -1) {
                        // 删除数据
                        characters.splice(charIndex, 1);
                        saveCharactersToLocal();
                        
                        // 退出并刷新
                        activeChatId = null;
                        renderChatList();
                        
                        // 跳转回主页
                        switchPage('chat-page');
                        switchTopBar('chat-top');
                        
                        // 恢复底部导航
                        const bNav = document.getElementById('main-bottom-nav');
                        if(bNav) {
                            bNav.classList.remove('hidden');
                            bNav.style.display = 'flex';
                        }
                        const cArea = document.getElementById('main-content-area');
                        if(cArea) cArea.classList.remove('no-bottom-nav');
                        
                        const inputBar = document.getElementById('chat-input-bar');
                        if(inputBar) inputBar.style.display = 'none';
                    }
                }
            });
        }
		// ============================================================
		// 【新增】角色导出导入逻辑
		// ============================================================
		const settingExportCharBtn = document.getElementById('setting-export-character-btn');
		const exportCharModal = document.getElementById('export-character-modal');
		const exportCharOnlyBtn = document.getElementById('export-char-only-btn');
		const exportCharFullBtn = document.getElementById('export-char-full-btn');
		const exportCharCancelBtn = document.getElementById('export-char-cancel-btn');

		const importCharBtn = document.getElementById('import-character-btn');
		const importCharFile = document.getElementById('import-character-file');

		// 1. 打开/关闭导出弹窗
		if (settingExportCharBtn) {
			settingExportCharBtn.addEventListener('click', () => {
				if (exportCharModal) exportCharModal.classList.add('show');
			});
		}

		if (exportCharCancelBtn) {
			exportCharCancelBtn.addEventListener('click', () => {
				if (exportCharModal) exportCharModal.classList.remove('show');
			});
		}

		// 2. 导出核心逻辑
		function doExportCharacter(includeHistory) {
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
			if (!char) return;

			// 深拷贝防止污染原数据
			const charToExport = JSON.parse(JSON.stringify(char));

			// 如果选择仅导出角色，清空记录相关字段
			if (!includeHistory) {
				// 清空聊天与记忆
				charToExport.chatHistory = [];
				charToExport.longTermMemories =[];
				charToExport.lifeEvents =[];
				charToExport.msgCountSinceSummary = 0;
				
				// 【核心新增】：清空查手机生成的庞大数据，但永久保留壁纸设置
				if (charToExport.phoneData) {
					const savedWallpaper = charToExport.phoneData.wallpaper || '';
					// 重新初始化为一个空壳，只带壁纸
					charToExport.phoneData = { wallpaper: savedWallpaper };
				}

				// 【核心新增】：清空外卖、礼物、日记等进度型互动数据
				charToExport.activeDeliveries =[];
				charToExport.giftList =[];
				charToExport.diaryData = null;
			}

			// 获取该角色关联的世界书
			let linkedWorldBooks =[];
			if (charToExport.worldBookIds && charToExport.worldBookIds.length > 0 && typeof worldBooks !== 'undefined') {
				linkedWorldBooks = worldBooks.filter(wb => charToExport.worldBookIds.includes(wb.id));
			}

			const exportData = {
				type: 'NN_PHONE_CHARACTER',
				version: 1.0,
				character: charToExport,
				worldBooks: linkedWorldBooks // 连同世界书数据一起打包
			};

			try {
				const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				
				const timeStr = new Date().toISOString().slice(0, 10);
				const suffix = includeHistory ? '完整' : '设定';
				a.download = `角色_${char.name}_${suffix}_${timeStr}.json`;
				
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				setTimeout(() => URL.revokeObjectURL(url), 1000);
				
				if (exportCharModal) exportCharModal.classList.remove('show');
			} catch (err) {
				alert("导出失败：" + err.message);
			}
		}

		// 绑定弹窗里的具体导出按钮
		if (exportCharOnlyBtn) {
			exportCharOnlyBtn.addEventListener('click', () => doExportCharacter(false));
		}

		if (exportCharFullBtn) {
			exportCharFullBtn.addEventListener('click', () => doExportCharacter(true));
		}

		// 3. 导入角色逻辑
		if (importCharBtn) {
			importCharBtn.addEventListener('click', () => {
				if (importCharFile) importCharFile.click();
			});
		}

		if (importCharFile) {
			importCharFile.addEventListener('change', function(e) {
				const file = e.target.files[0];
				if (!file) return;

				const reader = new FileReader();
				reader.onload = async (event) => {
					try {
						const data = JSON.parse(event.target.result);
						
						// 校验文件格式
						if (data.type !== 'NN_PHONE_CHARACTER' || !data.character) {
							throw new Error("不是有效的角色存档文件");
						}

						const charData = data.character;
						// 分配全新的唯一 ID，避免冲突
						const newCharId = 'char_' + Date.now().toString() + Math.random().toString(36).substr(2, 5);
						charData.id = newCharId;

						// 智能处理世界书导入
						if (data.worldBooks && Array.isArray(data.worldBooks)) {
							const newWbIds = [];
							data.worldBooks.forEach(wb => {
								// 查重：如果本地已经存在同名且同分类的世界书，就不重复导入，直接引用其ID
								const existing = worldBooks.find(w => w.title === wb.title && w.category === wb.category);
								if (existing) {
									newWbIds.push(existing.id);
								} else {
									const newWbId = 'wb_' + Date.now().toString() + Math.random().toString(36).substr(2, 5);
									worldBooks.push({ ...wb, id: newWbId });
									newWbIds.push(newWbId);
								}
							});
							charData.worldBookIds = newWbIds;
							await saveWorldBooksToLocal();
						}

						// 将新角色推入角色数组顶部
						characters.unshift(charData);
						await saveCharactersToLocal();
						
						alert("角色导入成功！");
						
						// 重置界面并跳转回主页
						clearNewChatForm();
						switchPage('chat-page');
						switchTopBar('chat-top');
						renderChatList();

					} catch (err) {
						alert("导入失败: " + err.message);
					} finally {
						// 清空 value 确保再次选择同名文件能触发 change 事件
						importCharFile.value = '';
					}
				};
				reader.readAsText(file);
			});
		}
		// ============================================================
		// 【新增】群聊的导出导入逻辑
		// ============================================================
		
        // 导出群聊 (完美复用私聊导出模态框与方法，因为 activeChatId 就是群聊ID)
		const settingExportGroupBtn = document.getElementById('setting-export-group-btn');
		if (settingExportGroupBtn) {
			settingExportGroupBtn.addEventListener('click', () => {
				if (exportCharModal) exportCharModal.classList.add('show');
			});
		}

        // 导入群聊
		const importGroupBtn = document.getElementById('import-group-btn');
		const importGroupFile = document.getElementById('import-group-file');

		if (importGroupBtn) {
			importGroupBtn.addEventListener('click', () => {
				if (importGroupFile) importGroupFile.click();
			});
		}

		if (importGroupFile) {
			importGroupFile.addEventListener('change', function(e) {
				const file = e.target.files[0];
				if (!file) return;

				const reader = new FileReader();
				reader.onload = async (event) => {
					try {
						const data = JSON.parse(event.target.result);
						
						if (data.type !== 'NN_PHONE_CHARACTER' || !data.character) {
							throw new Error("不是有效的角色存档文件");
						}

						const charData = data.character;

                        // 类型防呆判断
                        if (charData.type !== 'group') {
                            if(!confirm("您导入的似乎是一个私聊角色，系统将强制将其作为新群聊加载。是否继续？")) return;
                            charData.type = 'group'; // 强制修正类型
                        }

						const newCharId = 'group_' + Date.now().toString() + Math.random().toString(36).substr(2, 5);
						charData.id = newCharId;

						// 智能处理世界书导入
						if (data.worldBooks && Array.isArray(data.worldBooks)) {
							const newWbIds = [];
							data.worldBooks.forEach(wb => {
								const existing = worldBooks.find(w => w.title === wb.title && w.category === wb.category);
								if (existing) {
									newWbIds.push(existing.id);
								} else {
									const newWbId = 'wb_' + Date.now().toString() + Math.random().toString(36).substr(2, 5);
									worldBooks.push({ ...wb, id: newWbId });
									newWbIds.push(newWbId);
								}
							});
							charData.worldBookIds = newWbIds;
							await saveWorldBooksToLocal();
						}

						// 将新群聊推入数组顶部
						characters.unshift(charData);
						await saveCharactersToLocal();
						
						alert("群聊导入成功！");
						
						// 重置界面并跳转回主页
						initNewGroupPage();
						switchPage('chat-page');
						switchTopBar('chat-top');
						renderChatList();

					} catch (err) {
						alert("导入失败: " + err.message);
					} finally {
						importGroupFile.value = '';
					}
				};
				reader.readAsText(file);
			});
		}
		// ============================================================
		// 【修改后】新建角色页面的头像上传监听
		// ============================================================
		characterAvatarUploadInput.addEventListener('change', async function(e) { // 启用 async
			const file = e.target.files[0]; 
			if (!file || !file.type.startsWith('image/')) return;
			
			const reader = new FileReader(); 
			reader.onload = async (event) => { 
				try {
					// 【方案】角色头像：压缩成 120px 小缩略图
					tempCharacterAvatar = await compressImage(event.target.result, 120, 0.8);
					characterAvatarUploader.innerHTML = `<img src="${tempCharacterAvatar}" alt="avatar preview">`;
				} catch (error) {
					alert('图片处理失败: ' + error.message);
				}
			};
			reader.readAsDataURL(file); 
			this.value = '';
		});

		// ============================================================
        // 【新增】新建聊天页 - 专用用户头像上传与模型拉取逻辑
        // ============================================================
        const newChatUserAvatarUploader = document.getElementById('new-chat-user-avatar-uploader');
        const newChatUserAvatarInput = document.getElementById('new-chat-user-avatar-input');

        if (newChatUserAvatarUploader && newChatUserAvatarInput) {
            newChatUserAvatarUploader.addEventListener('click', () => {
                newChatUserAvatarInput.click();
            });

            newChatUserAvatarInput.addEventListener('change', async function(e) {
                const file = e.target.files[0];
                if (!file || !file.type.startsWith('image/')) return;
                
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        tempNewChatUserAvatar = await compressImage(event.target.result, 120, 0.8);
                        newChatUserAvatarUploader.innerHTML = `<img src="${tempNewChatUserAvatar}" style="width:100%; height:100%; object-fit:cover; border-radius: 8px;">`;
                    } catch (error) {
                        alert('图片处理失败: ' + error.message);
                    }
                };
                reader.readAsDataURL(file);
                this.value = ''; 
            });
        }

        // 新建页专属 API 拉取模型
        const newChatFetchModelsBtn = document.getElementById('new-chat-fetch-models-btn');
        if (newChatFetchModelsBtn) {
            newChatFetchModelsBtn.addEventListener('click', () => {
                const urlInput = document.getElementById('new-chat-api-url');
                const keyInput = document.getElementById('new-chat-api-key');
                const modelSel = document.getElementById('new-chat-model-select');
                fetchModelsForApi(urlInput, keyInput, modelSel, newChatFetchModelsBtn, {});
            });
        }
		// ============================================================
		// 【修改后】聊天设置页面的头像上传监听
		// ============================================================
		if (settingAvatarUploader) {
			settingAvatarUploader.addEventListener('change', function(e) {
				const file = e.target.files[0];
				if (!file || !file.type.startsWith('image/')) return;
				
				const reader = new FileReader();
				reader.onload = async (event) => { // 启用 async
					try {
						// 【方案】角色头像：压缩成 120px 小缩略图
						tempSettingAvatar = await compressImage(event.target.result, 120, 0.8);
						settingAvatarUploader.innerHTML = `<img src="${tempSettingAvatar}" style="width:100%; height:100%; object-fit:cover;">`;
					} catch (error) {
						alert('图片处理失败: ' + error.message);
					}
				};
				reader.readAsDataURL(file);
				this.value = '';
			});
		}
		
		// ============================================================
		// 【新增】角色心声面板控制逻辑 (V2.0)
		// ============================================================

		const statusModal = document.getElementById('inner-status-modal');
		const chatTitleBtn = document.getElementById('chat-detail-title-container'); // 聊天顶部的标题作为触发器

		// --- 1. 切换面板的显示/隐藏 ---
		function toggleInnerStatusModal() {
			if (!activeChatId) return;
			 
            const char = characters.find(c => c.id == activeChatId);
            if (char && char.type === 'group') return; 

			const isShown = statusModal.classList.contains('show');			
			if (isShown) {
				// 如果是显示的，就隐藏它
				statusModal.classList.remove('show');
			} else {
				// 如果是隐藏的，就填充数据并显示它
				const char = characters.find(c => c.id == activeChatId);
				if (!char) return;

				// 获取需要填充的DOM元素
				const emotionEl = document.getElementById('status-emotion');
				const conditionEl = document.getElementById('status-condition');
				const osEl = document.getElementById('status-os');
				const heartRateEl = document.getElementById('status-heart-rate');
				const jealousyFill = document.getElementById('jealousy-bar-fill');
				const jealousyText = document.getElementById('jealousy-bar-text');
				const favorabilityEl = document.getElementById('status-favorability');
				
				// 获取存储的状态数据
				const status = char.lastKnownStatus;

				if (status) {
					emotionEl.textContent = status.emotion || '--';
					conditionEl.textContent = status.condition || '--';
					osEl.textContent = status.os || '--';
					heartRateEl.textContent = `${status.heart_rate || '--'} bpm`;
					
					const jealousyValue = parseInt(status.jealousy) || 0;
					jealousyFill.style.width = `${jealousyValue}%`;
					jealousyText.textContent = `${jealousyValue}%`;
					const favStatus = status.favorability; // 获取 AI 输出的 "UP", "DOWN", "NONE"

					if (favStatus === 'UP') {
						favorabilityEl.innerHTML = '<span style="color: #ff4757; font-weight:bold;">↑</span>'; // 红色上升箭头
					} else if (favStatus === 'DOWN') {
						favorabilityEl.innerHTML = '<span style="color: #2ed573; font-weight:bold;">↓</span>'; // 绿色下降箭头
					} else if (favStatus === 'NONE' || favStatus === '无变化') {
						favorabilityEl.textContent = '无变化';
					} else {
						favorabilityEl.textContent = '无变化'; // 默认情况
					}
				} else {
					emotionEl.textContent = '暂无数据';
					conditionEl.textContent = '暂无数据';
					osEl.textContent = '请先与角色对话以获取内心状态。';
					heartRateEl.textContent = '-- bpm';
					jealousyFill.style.width = '0%';
					jealousyText.textContent = '0%';
					favorabilityEl.textContent = '暂无数据';
				}

				// 显示面板
				statusModal.classList.add('show');
			}
		}

		// --- 2. 绑定事件 ---
		if (chatTitleBtn) {
			chatTitleBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // 阻止事件冒泡到 document
				toggleInnerStatusModal();
			});
		}

		// --- 3. 添加全局点击事件，用于关闭面板 ---
		document.addEventListener('click', (e) => {
			// 检查面板是否是显示的，并且点击的目标不是面板自身或其子元素
			if (statusModal.classList.contains('show') && !statusModal.contains(e.target)) {
				statusModal.classList.remove('show');
			}
		});
		
		// ============================================================
		// 【世界书渲染逻辑 - 只显示标题 + 按分类分组】
		// ============================================================

		function renderWorldBooks() {
			const container = document.getElementById('worldbook-list-container');
			container.innerHTML = "";

			// 1. 如果没有数据
			if (!worldBooks || worldBooks.length === 0) {
				container.innerHTML = `
					<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:#999;">
						<i class="fas fa-book" style="font-size:40px; margin-bottom:15px; color:#ddd;"></i>
						<div style="font-size:14px;">暂无世界书设定</div>
						<div style="font-size:12px; margin-top:5px;">点击右上角 + 号添加</div>
					</div>
				`;
				return;
			}

			// 2. 按分类分组
			const groups = {};
			
			// 先排序（可选）：让未分类的排在最后，其他的按字母排
			worldBooks.sort((a, b) => {
				const catA = a.category || "zzz"; // 没分类的算 zzz 放到后面
				const catB = b.category || "zzz";
				return catA.localeCompare(catB, 'zh-CN');
			});

			worldBooks.forEach(book => {
				// 如果用户没填分类，就叫“默认分类”
				const cat = book.category ? book.category.trim() : "默认分类";
				if (!groups[cat]) groups[cat] = [];
				groups[cat].push(book);
			});

			// 3. 遍历渲染分组
			for (const cat in groups) {
				const groupEl = document.createElement('div');
				groupEl.className = 'wb-category-group';
				
				// --- 组标题 ---
				let html = `<div class="wb-category-name">${cat}</div>`;
				
				// --- 组内卡片 (只显示标题) ---
				groups[cat].forEach(book => {
					const safeTitle = book.title.replace(/</g, "&lt;"); // 防止XSS
					
					// 注意：这里删除了 content 的预览 div，只保留 title
					html += `
						<div class="wb-card" onclick="openWorldBookEdit('${book.id}')">
							<div class="wb-card-info">
								<div class="wb-card-title">${safeTitle}</div>
							</div>
							<div class="wb-card-arrow">
								<i class="fas fa-chevron-right"></i>
							</div>
						</div>
					`;
				});
				
				groupEl.innerHTML = html;
				container.appendChild(groupEl);
			}
		}

	// 编辑已有项目
	window.editWorldBook = function(id) {
		const book = worldBooks.find(b => b.id === id);
		if (!book) return;

		document.getElementById('worldbook-edit-title').innerText = "编辑世界书";
		document.getElementById('wb-edit-id').value = book.id;
		document.getElementById('wb-title-input').value = book.title;
		document.getElementById('wb-category-input').value = book.category;
		document.getElementById('wb-content-input').value = book.content;
		
		switchPage('worldbook-edit-page', 'worldbook-edit-top');
	};
	
	// 全局删除项目
	window.deleteWorldBook = async function(id) {
		if (confirm("确定要删除这条世界书吗？\n注意：删除后所有绑定此世界书的角色将失效。")) {
			worldBooks = worldBooks.filter(b => b.id !== id);
			await saveWorldBooksToLocal(); 
			
			// 联动清理废弃数据
			characters.forEach(char => {
				if (char.worldBookIds && char.worldBookIds.includes(id)) {
					char.worldBookIds = char.worldBookIds.filter(wId => wId !== id);
				}
			});
			await saveCharactersToLocal(true);
			
			renderWorldBooks();
		}
	};
	// ============================================================
		// 【新增】用户面具 (预设) 管理系统
		// ============================================================
		const userMaskManageEntryBtn = document.getElementById('user-mask-manage-entry-btn');
		const userMaskManageTopBack = document.querySelector('#user-mask-manage-top .top-bar-back');
		const addUserMaskBtn = document.getElementById('add-user-mask-btn');
		
		const userMaskEditTopBack = document.querySelector('#user-mask-edit-top .top-bar-back');
		const userMaskSaveBtn = document.getElementById('user-mask-save-btn');
		const userMaskDeleteBtn = document.getElementById('user-mask-delete-btn');
		
		let tempUserMaskAvatar = ''; // 暂存图片

		// 1. 进入管理页与返回/添加逻辑
		if (userMaskManageEntryBtn) {
			userMaskManageEntryBtn.addEventListener('click', () => {
				renderUserMaskList();
				switchPage('user-mask-manage-page');
				switchTopBar('user-mask-manage-top');
			});
		}

		// (从管理页返回【我的】主页)
		if (userMaskManageTopBack) {
			userMaskManageTopBack.addEventListener('click', () => {
				switchPage('me-page');
				switchTopBar('');
			});
		}

		// 【核心修复 1】：为管理页右上角的“+”号按钮绑定点击事件
		if (addUserMaskBtn) {
			addUserMaskBtn.addEventListener('click', () => {
				openUserMaskEdit(''); // 传入空字符串，触发新增模式
			});
		}

		// 【核心修复 2】：为编辑/新增页的返回按钮绑定点击事件
		if (userMaskEditTopBack) {
			userMaskEditTopBack.addEventListener('click', () => {
				renderUserMaskList(); // 确保返回时刷新最新数据
				switchPage('user-mask-manage-page');
				switchTopBar('user-mask-manage-top');
			});
		}

		// 2. 渲染面具列表
		function renderUserMaskList() {
			const container = document.getElementById('user-mask-list-container');
			container.innerHTML = '';
			
			if (userMasks.length === 0) {
				container.innerHTML = '<div style="text-align:center; padding:50px; color:#999;"><i class="fas fa-id-card" style="font-size:40px; margin-bottom:10px; color:#ddd;"></i><p>暂无面具预设</p><p style="font-size:12px;">点击右上角添加你的专属马甲</p></div>';
				return;
			}

			userMasks.forEach(mask => {
				const avatarHtml = mask.avatar ? `<img src="${mask.avatar}" style="width:40px;height:40px;border-radius:4px;object-fit:cover;">` : `<div style="width:40px;height:40px;background:#eee;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#999;"><i class="fas fa-user"></i></div>`;
				const safeDesc = mask.mask ? (mask.mask.length > 20 ? mask.mask.substring(0,20)+'...' : mask.mask) : '无设定';
				// 【新增】备注气泡展示
				const remarkHtml = mask.remark ? `<span style="font-size:12px; color:#fa9d3b; margin-left:8px; font-weight:normal; border:1px solid #fa9d3b; padding:0 4px; border-radius:4px;">${mask.remark}</span>` : '';

				container.innerHTML += `
					<div class="menu-btn" style="height:auto; padding: 10px 15px; margin-bottom: 10px;" onclick="openUserMaskEdit('${mask.id}')">
						<div class="menu-btn-left" style="align-items:flex-start;">
							${avatarHtml}
							<div style="margin-left: 10px; display:flex; flex-direction:column;">
								<span style="font-size:16px; color:#333; font-weight:bold;">${mask.name}${remarkHtml}</span>
								<span style="font-size:12px; color:#888; margin-top:4px;">${safeDesc}</span>
							</div>
						</div>
						<i class="fas fa-chevron-right menu-btn-arrow" style="align-self:center;"></i>
					</div>
				`;
			});
		}

		// 3. 打开编辑/新增页
		window.openUserMaskEdit = function(id) {
			const titleEl = document.getElementById('user-mask-edit-title');
			const idInput = document.getElementById('user-mask-id-input');
			const nameInput = document.getElementById('user-mask-name-input');
			const remarkInput = document.getElementById('user-mask-remark-input'); // 【新增】读取备注输入框
			const descInput = document.getElementById('user-mask-desc-input');
			const voiceInput = document.getElementById('user-mask-voice-input');
			const uploader = document.getElementById('user-mask-avatar-uploader');
			const delSection = document.getElementById('user-mask-delete-section');

			if (id) {
				// 编辑模式
				const mask = userMasks.find(m => m.id === id);
				titleEl.textContent = "编辑面具";
				idInput.value = mask.id;
				nameInput.value = mask.name;
				if(remarkInput) remarkInput.value = mask.remark || ''; // 【新增】回显备注
				descInput.value = mask.mask || '';
				voiceInput.value = mask.voiceId || '';
				tempUserMaskAvatar = mask.avatar || '';
				
				if (tempUserMaskAvatar) {
					uploader.innerHTML = `<img src="${tempUserMaskAvatar}" style="width:100%;height:100%;object-fit:cover;">`;
				} else {
					uploader.innerHTML = '<i class="fas fa-camera"></i>';
				}
				delSection.style.display = 'block';
			} else {
				// 新增模式
				titleEl.textContent = "新增面具";
				idInput.value = '';
				nameInput.value = '';
				if(remarkInput) remarkInput.value = ''; // 【新增】清空备注
				descInput.value = '';
				voiceInput.value = '';
				tempUserMaskAvatar = '';
				uploader.innerHTML = '<i class="fas fa-camera"></i>';
				delSection.style.display = 'none';
			}

			switchPage('user-mask-edit-page');
			switchTopBar('user-mask-edit-top');
		};

		// 4. 面具头像上传
		const maskAvatarUploader = document.getElementById('user-mask-avatar-uploader');
		const maskAvatarInput = document.getElementById('user-mask-avatar-input');
		if (maskAvatarUploader) {
			maskAvatarUploader.addEventListener('click', () => maskAvatarInput.click());
			maskAvatarInput.addEventListener('change', async function(e) {
				const file = e.target.files[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = async (evt) => {
					tempUserMaskAvatar = await compressImage(evt.target.result, 150, 0.8);
					maskAvatarUploader.innerHTML = `<img src="${tempUserMaskAvatar}" style="width:100%;height:100%;object-fit:cover;">`;
				};
				reader.readAsDataURL(file);
				this.value = '';
			});
		}

		// 5. 保存和删除
		if (userMaskSaveBtn) {
			userMaskSaveBtn.addEventListener('click', () => {
				const id = document.getElementById('user-mask-id-input').value;
				const name = document.getElementById('user-mask-name-input').value.trim();
				const remarkInput = document.getElementById('user-mask-remark-input'); // 【新增】
				const remark = remarkInput ? remarkInput.value.trim() : ''; // 【新增】
				const desc = document.getElementById('user-mask-desc-input').value.trim();
				const voice = document.getElementById('user-mask-voice-input').value.trim();

				if (!name) { alert("马甲名称不能为空！"); return; }

				if (id) {
					const idx = userMasks.findIndex(m => m.id === id);
					if (idx > -1) {
						// 【修改】加入 remark 字段
						userMasks[idx] = { id, name, remark, mask: desc, avatar: tempUserMaskAvatar, voiceId: voice };
					}
				} else {
					userMasks.unshift({
						id: 'mask_' + Date.now(),
						// 【修改】加入 remark 字段
						name, remark, mask: desc, avatar: tempUserMaskAvatar, voiceId: voice
					});
				}

				saveUserMasksToLocal();
				alert("保存成功！");
				userMaskEditTopBack.click();
				renderUserMaskList();
			});
		}

		if (userMaskDeleteBtn) {
			userMaskDeleteBtn.addEventListener('click', () => {
				if (confirm("确定要删除这个面具吗？绑定了此面具的对话将自动回退为全局默认状态。")) {
					const id = document.getElementById('user-mask-id-input').value;
					userMasks = userMasks.filter(m => m.id !== id);
					
					// 清理所有角色身上绑定的这个 ID
					characters.forEach(c => {
						if (c.userMaskId === id) c.userMaskId = '';
					});
					saveCharactersToLocal();
					saveUserMasksToLocal();

					userMaskEditTopBack.click();
					renderUserMaskList();
				}
			});
		}

		// --- 辅助：渲染供选择的下拉列表 (和私聊完全一致，带强力防空保护) ---
		window.renderUserMaskSelectOptions = function(selectElementId, selectedId = '') {
			// 智能兼容你的 HTML ID，不管有没有写 -select 都能找到
			let selectEl = document.getElementById(selectElementId) || 
						   document.getElementById(selectElementId.replace('-select', '')) || 
						   document.getElementById(selectElementId + '-select');
			
			if (!selectEl) {
				console.warn("找不到面具下拉框元素:", selectElementId);
				return;
			}
			
			// 如果你的 HTML 还是 input，自动帮你转成 select
			if (selectEl.tagName.toLowerCase() === 'input') {
				const newSelect = document.createElement('select');
				newSelect.id = selectEl.id;
				newSelect.className = selectEl.className || 'form-select';
				selectEl.parentNode.replaceChild(newSelect, selectEl);
				selectEl = newSelect;
			}

			// 清空旧选项，完全和私聊一致，只读取 userMasks 预设
			selectEl.innerHTML = '<option value="">使用全局默认设定</option>';
			if (typeof userMasks !== 'undefined' && Array.isArray(userMasks)) {
				userMasks.forEach(mask => {
					const isSelected = mask.id === selectedId ? 'selected' : '';
					// 【新增】拼接备注内容
					const remarkStr = mask.remark ? ` (${mask.remark})` : '';
					selectEl.innerHTML += `<option value="${mask.id}" ${isSelected}>[预设] ${mask.name}${remarkStr}</option>`;
				});
			}
		};
	// ============================================================
	// 【新增】表情包管理系统
	// ============================================================

	// --- 变量定义 ---
	let currentCategory = '全部'; // 当前选中的分类
	let isEmoticonBatchMode = false;
	let selectedEmoticonIds = new Set();

	// --- DOM 元素 ---
	const myEmoticonBtn = document.getElementById('my-emoticon-btn');
	const goAddEmoticonBtn = document.getElementById('go-add-emoticon-btn');
	const saveEmoticonBtn = document.getElementById('save-emoticon-btn');

	const emoticonManageTopBack = document.querySelector('#emoticon-manage-top .top-bar-back');
	const emoticonAddTopBack = document.querySelector('#emoticon-add-top .top-bar-back');

	const emoticonTabsContainer = document.getElementById('emoticon-tabs');
	const emoticonGridContainer = document.getElementById('emoticon-grid');

	const emoticonCategoryInput = document.getElementById('emoticon-category-input');
	const emoticonImportInput = document.getElementById('emoticon-import-input');

	const startEmoticonBatchBtn = document.getElementById('start-emoticon-batch-btn');
	const emoticonBatchBar = document.getElementById('emoticon-batch-bar');
	const emoticonBatchCancel = document.getElementById('emoticon-batch-cancel');
	const emoticonBatchConfirm = document.getElementById('emoticon-batch-confirm');
	const emoticonBatchCount = document.getElementById('emoticon-batch-count');

	// --- 1. 导航逻辑 ---

	// 进入表情管理页
	if (myEmoticonBtn) {
		myEmoticonBtn.addEventListener('click', () => {
			renderEmoticonTabs();
			renderEmoticonGrid();
			// 确保进入时是非批量模式
			toggleEmoticonBatchMode(false);
			switchPage('emoticon-manage-page');
			switchTopBar('emoticon-manage-top');
		});
	}

	// 管理页 -> 返回 -> 我
	if (emoticonManageTopBack) {
		emoticonManageTopBack.addEventListener('click', () => {
			switchPage('me-page');
			switchTopBar('');
		});
	}

	// 管理页 -> 添加页
	if (goAddEmoticonBtn) {
		goAddEmoticonBtn.addEventListener('click', () => {
			// 清空输入框
			emoticonCategoryInput.value = '';
			emoticonImportInput.value = '';
			switchPage('emoticon-add-page');
			switchTopBar('emoticon-add-top');
		});
	}

	// 添加页 -> 返回 -> 管理页
	if (emoticonAddTopBack) {
		emoticonAddTopBack.addEventListener('click', () => {
			switchPage('emoticon-manage-page');
			switchTopBar('emoticon-manage-top');
		});
	}

	// --- 2. 添加表情逻辑 (解析 URL + 描述) ---

	saveEmoticonBtn.addEventListener('click', () => {
		const category = emoticonCategoryInput.value.trim();
		const rawText = emoticonImportInput.value.trim();

		if (!category) {
			alert('请输入分类名称！');
			return;
		}
		if (!rawText) {
			alert('请输入表情包数据！');
			return;
		}

		const lines = rawText.split('\n');
		let addedCount = 0;

		lines.forEach(line => {
			line = line.trim();
			if (!line) return;

			let url = '';
			let desc = '';

			// 智能解析：利用正则匹配第一个连续的“空白字符”（包括半角空格、全角空格、制表符Tab等）
			const match = line.match(/\s+/);

			if (!match) {
				// 如果没有任何空白符号，说明全是URL，兜底用分类名作为描述
				url = line;
				desc = category; 
			} else {
				// 以第一个出现的连续空白字符为界线，切分URL和描述
				const sepIndex = match.index;
				const sepLength = match[0].length;
				
				url = line.substring(0, sepIndex).trim();
				desc = line.substring(sepIndex + sepLength).trim();
				
				// 防止用户不小心打了个空格但后面没写字
				if (!desc) desc = category;
			}

			if (url) {
				emoticonList.push({
					id: Date.now() + Math.random().toString(36).substr(2, 9),
					category: category,
					url: url,
					description: desc
				});
				addedCount++;
			}
		});

		if (addedCount > 0) {
			 saveEmoticonsToLocal();
			alert(`成功添加 ${addedCount} 个表情！`);
			// 刷新列表并返回
			currentCategory = category; // 自动切换到新添加的分类
			renderEmoticonTabs();
			renderEmoticonGrid();
			switchPage('emoticon-manage-page');
			switchTopBar('emoticon-manage-top');
		} else {
			alert('未能解析出有效数据，请检查格式。');
		}
	});

	// --- 3. 渲染逻辑 (分类 + 网格) ---

	function renderEmoticonTabs() {
		// 1. 提取所有不重复的分类
		const categories = ['全部', ...new Set(emoticonList.map(item => item.category))];
		
		let html = '';
		categories.forEach(cat => {
			const activeClass = (cat === currentCategory) ? 'active' : '';
			html += `<div class="emoticon-tab-item ${activeClass}" onclick="switchEmoticonCategory('${cat}')">${cat}</div>`;
		});
		
		emoticonTabsContainer.innerHTML = html;
	}
	
	// 【新增】辅助函数：更新分组管理区域的可见性
	function updateGroupManagementVisibility() {
		if (currentCategory === '全部') {
			emoticonGroupManagement.style.display = 'none';
		} else {
			emoticonGroupManagement.style.display = 'block';
		}
	}

	// 修改 switchEmoticonCategory 函数
	window.switchEmoticonCategory = function(cat) {
		currentCategory = cat;
		renderEmoticonTabs(); // 更新高亮
		renderEmoticonGrid(); // 更新网格
		updateGroupManagementVisibility(); // 【新增】更新管理区可见性
		toggleEmoticonBatchMode(false); // 切换分类时退出批量模式
	};

	function renderEmoticonGrid() {
		emoticonGridContainer.innerHTML = '';

		
		// 1. 筛选数据
		let displayList = [];
		if (currentCategory === '全部') {
			displayList = emoticonList;
		} else {
			displayList = emoticonList.filter(item => item.category === currentCategory);
		}

		if (displayList.length === 0) {
			emoticonGridContainer.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:#999; padding: 20px;">该分类下暂无表情</div>';
			return;
		}

		// 2. 生成 HTML
		displayList.forEach(item => {
			// 检查是否被选中 (用于批量模式渲染)
			const isSelected = selectedEmoticonIds.has(item.id) ? 'selected' : '';
			
			const card = document.createElement('div');
			card.className = `emoticon-card ${isSelected}`;
			card.dataset.id = item.id;
			card.innerHTML = `
				<div class="emoticon-img-box">
					<img src="${item.url}" alt="${item.description}" onerror="this.src='static/images/error.png';this.alt='加载失败'">
				</div>
				<div class="emoticon-desc">${item.description}</div>
				<div class="emoticon-select-overlay">
					<div class="select-icon"><i class="fas fa-check"></i></div>
				</div>
			`;
			
			// 绑定点击事件
			card.addEventListener('click', () => handleEmoticonClick(item.id));
			
			emoticonGridContainer.appendChild(card);
		});
		updateGroupManagementVisibility();
	}

	// --- 4. 点击交互与批量删除 ---

	function handleEmoticonClick(id) {
		if (isEmoticonBatchMode) {
			// 批量模式：切换选中状态
			if (selectedEmoticonIds.has(id)) {
				selectedEmoticonIds.delete(id);
			} else {
				selectedEmoticonIds.add(id);
			}
			renderEmoticonGrid(); // 重新渲染以更新 UI
			updateEmoticonBatchBar();
		} else {
			// 普通模式：单条删除 (或者你可以改成预览大图)
			if (confirm('确定要删除这个表情包吗？')) {
				emoticonList = emoticonList.filter(item => item.id !== id);
				saveEmoticonsToLocal();
				renderEmoticonGrid();
			}
		}
	}

	// 切换批量模式
	function toggleEmoticonBatchMode(enable) {
		isEmoticonBatchMode = enable;
		selectedEmoticonIds.clear();

		const batchStarter = document.querySelector('.emoticon-batch-starter'); // 获取容器
		
		if (enable) {
			emoticonBatchBar.classList.add('show');
			if(batchStarter) batchStarter.style.display = 'none'; // 隐藏入口按钮容器
			if(emoticonGroupManagement) emoticonGroupManagement.style.display = 'none'; // 隐藏分组管理
		} else {
			emoticonBatchBar.classList.remove('show');
			if(batchStarter) batchStarter.style.display = 'block'; // 显示入口按钮容器
			updateGroupManagementVisibility(); // 恢复分组管理的正常状态
			
			// 清除所有视觉选中样式
			document.querySelectorAll('.emoticon-card.selected').forEach(el => el.classList.remove('selected'));
		}
		updateEmoticonBatchBar();
	}

	function updateEmoticonBatchBar() {
		const count = selectedEmoticonIds.size;
		emoticonBatchCount.innerText = count;
		emoticonBatchConfirm.disabled = (count === 0);
		if(count > 0) {
			emoticonBatchConfirm.style.color = '#ff3b30';
		} else {
			emoticonBatchConfirm.style.color = '#ccc';
		}
	}

	// 绑定批量操作事件
	if (startEmoticonBatchBtn) {
		startEmoticonBatchBtn.addEventListener('click', () => toggleEmoticonBatchMode(true));
	}

	if (emoticonBatchCancel) {
		emoticonBatchCancel.addEventListener('click', () => toggleEmoticonBatchMode(false));
	}

	if (emoticonBatchConfirm) {
		emoticonBatchConfirm.addEventListener('click', () => {
			if (selectedEmoticonIds.size === 0) return;
			
			if (confirm(`确定要删除选中的 ${selectedEmoticonIds.size} 个表情包吗？`)) {
				// 执行删除
				emoticonList = emoticonList.filter(item => !selectedEmoticonIds.has(item.id));
				 saveEmoticonsToLocal();
				
				// 退出批量模式并刷新
				toggleEmoticonBatchMode(false);
				renderEmoticonTabs(); // 分类可能因为删光了而消失，所以要刷 tabs
				renderEmoticonGrid();
			}
		});
	}
	
	// --- 5. 分组管理功能 ---

	// 重命名分组
	renameGroupBtn.addEventListener('click', () => {
		if (currentCategory === '全部') return;

		const oldName = currentCategory;
		const newName = prompt('请输入新的分组名称：', oldName);

		if (newName && newName.trim() !== '' && newName.trim() !== oldName) {
			const finalNewName = newName.trim();

			// 检查新名称是否已存在
			const isExist = emoticonList.some(item => item.category === finalNewName);
			if (isExist) {
				alert(`分组 "${finalNewName}" 已存在，请使用其他名称。`);
				return;
			}

			// 遍历更新所有相关表情的分类
			emoticonList.forEach(item => {
				if (item.category === oldName) {
					item.category = finalNewName;
				}
			});

			saveEmoticonsToLocal();
			
			// 更新当前状态并重新渲染
			currentCategory = finalNewName;
			renderEmoticonTabs();
			renderEmoticonGrid();
			alert('分组已重命名！');
		}
	});

	// 删除分组
	deleteGroupBtn.addEventListener('click', () => {
		if (currentCategory === '全部') return;

		if (confirm(`⚠️ 警告\n\n确定要删除 "${currentCategory}" 分组吗？\n该分组下的所有表情包都将被永久删除！`)) {
			const categoryToDelete = currentCategory;

			// 过滤掉所有属于该分组的表情
			emoticonList = emoticonList.filter(item => item.category !== categoryToDelete);
			
			saveEmoticonsToLocal();
			
			// 返回“全部”并重新渲染
			currentCategory = '全部';
			renderEmoticonTabs();
			renderEmoticonGrid();
			alert(`分组 "${categoryToDelete}" 已被删除。`);
		}
	});
	
	// ============================================================
	// 【新增】聊天表情选择器逻辑
	// ============================================================

	const emoticonToggleBtn = document.getElementById('emoticon-toggle-btn');
	const emoticonPickerModal = document.getElementById('emoticon-picker-modal');
	const emoticonPickerTabs = document.getElementById('emoticon-picker-tabs');
	const emoticonPickerGrid = document.getElementById('emoticon-picker-grid');

	let currentPickerCategory = '全部'; // 独立于管理页的分类状态

	// --- 1. 打开/关闭选择器 ---

	function openEmoticonPicker() {
		// 如果没有表情，直接提示
		if (!emoticonList || emoticonList.length === 0) {
			alert('还没有添加表情包，请先去“我-表情管理”中添加。');
			return;
		}
		currentPickerCategory = '全部'; // 每次打开重置为“全部”
		renderEmoticonPicker();
		emoticonPickerModal.classList.add('show');
	}

	function closeEmoticonPicker() {
		emoticonPickerModal.classList.remove('show');
	}

	// ✅ 修正：判断当前状态，决定是打开还是关闭
	emoticonToggleBtn.addEventListener('click', (e) => {
		e.stopPropagation(); // 阻止冒泡，防止触发全局关闭
		const picker = document.getElementById('emoticon-picker-modal');
		
		// 如果功能面板开着，先关掉它
		const funcPanel = document.getElementById('function-panel-modal');
		if (funcPanel && funcPanel.classList.contains('show')) {
			funcPanel.classList.remove('show');
		}

		if (picker.classList.contains('show')) {
			closeEmoticonPicker();
		} else {
			openEmoticonPicker();
		}
	});
	
	emoticonPickerModal.addEventListener('click', (e) => {
		// 点击遮罩层关闭
		if (e.target === emoticonPickerModal) {
			closeEmoticonPicker();
		}
	});

	// --- 2. 渲染选择器内容 ---

	function renderEmoticonPicker() {
		renderPickerTabs();
		renderPickerGrid();
	}

	function renderPickerTabs() {
		const categories = ['全部', ...new Set(emoticonList.map(item => item.category))];
		let html = '';
		categories.forEach(cat => {
			const activeClass = (cat === currentPickerCategory) ? 'active' : '';
			html += `<div class="emoticon-tab-item ${activeClass}" onclick="switchPickerCategory('${cat}')">${cat}</div>`;
		});
		emoticonPickerTabs.innerHTML = html;
	}

	function renderPickerGrid() {
		let displayList = (currentPickerCategory === '全部') 
			? emoticonList 
			: emoticonList.filter(item => item.category === currentPickerCategory);

		emoticonPickerGrid.innerHTML = '';
		if (displayList.length === 0) {
			emoticonPickerGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:#999; padding: 20px;">该分类下暂无表情</div>';
			return;
		}
		
		displayList.forEach(item => {
			const card = document.createElement('div');
			card.className = 'emoticon-picker-card';
			card.innerHTML = `
            <div class="emoticon-picker-img-box">
                <img src="${item.url}" alt="${item.description}">
            </div>
            <div class="emoticon-picker-desc">${item.description}</div>
			`;
			
			// 【核心】点击卡片发送表情
			card.addEventListener('click', () => sendEmoticon(item));
			
			emoticonPickerGrid.appendChild(card);
		});
	}

	// --- 3. 切换分类和发送 ---

	window.switchPickerCategory = function(cat) {
		currentPickerCategory = cat;
		renderPickerTabs();
		renderPickerGrid();
	};

	function sendEmoticon(emoticon) {
        // 调用修改后的 saveAndRenderMessage 函数
        // 参数顺序：text, type, targetId, groupId, quoteData, isWithdrawn, imageUrl
		const formattedText = `[表情包：${emoticon.description}]`;
		 
        saveAndRenderMessage(
            formattedText, // <--- 修复：使用带标签的文本，这样系统才知道这是表情包, // text (作为上下文)
            'sent',               // type
            null,                 // targetId (null 表示发给当前激活的聊天)
            null,                 // groupId
            null,                 // quoteData
            false,                // isWithdrawnForce
            emoticon.url          // 【修复点】imageUrl 传在这里 (第7个参数)
        );
        
        closeEmoticonPicker(); // 发送后关闭选择器
    }
	
	// ============================================================
	// 【新增】人生档案页面功能逻辑
	// ============================================================

	// --- DOM 元素 ---
	const lifeEventsMenuBtn = document.getElementById('menu-life-events-btn');
	const lifeEventsTopBack = document.querySelector('#life-events-top .top-bar-back');
	const lifeEventsSaveBtn = document.getElementById('life-events-save-btn');
	const addLifeEventBtn = document.getElementById('add-life-event-btn');
	const addEventDateInput = document.getElementById('add-life-event-date-input');
	const lifeEventsListContainer = document.getElementById('life-events-list');

	// --- 添加事件弹窗相关 DOM ---
	const addEventModal = document.getElementById('add-life-event-modal');
	const addEventInput = document.getElementById('add-life-event-input');
	const cancelAddEventBtn = document.getElementById('cancel-add-life-event-btn');
	const confirmAddEventBtn = document.getElementById('confirm-add-life-event-btn');


	// --- 1. 导航：从聊天菜单进入人生档案页 ---
	if (lifeEventsMenuBtn) {
		lifeEventsMenuBtn.addEventListener('click', () => {
			document.getElementById('chat-menu-dropdown').classList.remove('show');
			renderLifeEventsPage();
			switchPage('life-events-page');
			switchTopBar('life-events-top');
		});
	}

	// --- 2. 导航：从人生档案页返回聊天页 ---
	if (lifeEventsTopBack) {
		lifeEventsTopBack.addEventListener('click', () => {
			// 可以在这里加一个“未保存”的提示
			switchPage('chat-detail-page');
			switchTopBar('chat-detail-top');
			scrollToBottom();
		});
	}

	// --- 3. 渲染人生档案页面 ---
	function renderLifeEventsPage() {
		const char = characters.find(c => c.id == activeChatId);
		if (!char || !char.lifeEvents) {
			lifeEventsListContainer.innerHTML = '<p style="text-align:center; color:#999;">还没有记录任何人生大事。</p>';
			return;
		}

		// 按日期排序 (可选，但建议)
		char.lifeEvents.sort((a, b) => a.date.localeCompare(b.date));
		
		let html = '';
		char.lifeEvents.forEach((event, index) => {
			html += `
				<div class="life-event-item" data-index="${index}">
					<span class="date">【${event.date}】</span>
					<textarea rows="1" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${event.event}</textarea>
					<button class="life-event-delete-btn"><i class="fas fa-times-circle"></i></button>
				</div>
			`;
		});
		lifeEventsListContainer.innerHTML = html;
		
		// 渲染后自适应一下高度
		lifeEventsListContainer.querySelectorAll('textarea').forEach(ta => {
			ta.style.height='auto';
			ta.style.height=ta.scrollHeight+'px';
		});
	}
	
	// --- 4. 保存对人生档案的修改 ---
	if (lifeEventsSaveBtn) {
		lifeEventsSaveBtn.addEventListener('click', () => {
			const char = characters.find(c => c.id == activeChatId);
			if (!char) return;

			const newLifeEvents = [];
			const items = lifeEventsListContainer.querySelectorAll('.life-event-item');
			
			items.forEach(item => {
				const date = item.querySelector('.date').textContent.replace(/[【】]/g, '');
				const eventText = item.querySelector('textarea').value.trim();
				if (eventText) { // 只保存有内容的
					newLifeEvents.push({ date, event: eventText });
				}
			});

			char.lifeEvents = newLifeEvents;
			saveCharactersToLocal();
			alert('人生档案已保存！');
			lifeEventsTopBack.click(); // 点击返回按钮返回聊天页
		});
	}


	// --- 5. 添加新事件的弹窗逻辑 (彻底修复点击无反应问题) ---

	if (addLifeEventBtn) {
		// 移除旧监听防止重复（虽然通常不需要，但为了保险）
		addLifeEventBtn.onclick = null; 
		
		addLifeEventBtn.onclick = function() {
			//console.log("添加大事件按钮被点击"); // 调试用
			if (addEventModal) {
				// 清空输入框
				addEventInput.value = '';
				// 默认日期设为今天
				if (addEventDateInput) {
					addEventDateInput.valueAsDate = new Date();
				}
				// 显示弹窗
				addEventModal.classList.add('show');
				addEventInput.focus();
			} else {
				console.error("找不到人生档案弹窗 ID: add-life-event-modal");
			}
		};
	}

	// 取消按钮
	if (cancelAddEventBtn) {
		cancelAddEventBtn.onclick = function() {
			addEventModal.classList.remove('show');
		};
	}

	// 确认添加按钮 (保存逻辑)
	if (confirmAddEventBtn) {
		confirmAddEventBtn.onclick = function() {
			const eventText = addEventInput.value.trim();
			const eventDate = addEventDateInput.value;

			if (!eventDate || !eventText) {
				alert('请完整填写日期和事件描述！');
				return;
			}

			const char = characters.find(c => c.id == activeChatId);
			if (!char) return;

			// 格式化日期：2024-02-15 -> 24/02/15
			const formattedDate = eventDate.substring(2).replace(/-/g, '/');

			if (!char.lifeEvents) char.lifeEvents = [];
			char.lifeEvents.push({ date: formattedDate, event: eventText });

			saveCharactersToLocal();
			renderLifeEventsPage(); // 刷新页面列表
			addEventModal.classList.remove('show');
			alert('事件已添加，记得点击右上角“保存”以确保存储。');
		};
	}

	// --- 6. 删除单个事件 (使用事件委托) ---
	if (lifeEventsListContainer) {
		lifeEventsListContainer.addEventListener('click', (e) => {
			const deleteBtn = e.target.closest('.life-event-delete-btn');
			if (deleteBtn) {
				if (confirm('确定要删除这条记录吗？')) {
					const item = deleteBtn.closest('.life-event-item');
					item.remove();
					// 注意：此时只是从DOM中移除，点击顶部的“保存”按钮才会真正从数据中删除。
				}
			}
		});
	}
	
	// ============================================================
	// 【重构】底部功能面板逻辑 (最终修复版)
	// ============================================================
	(function initFunctionPanel() {
		// 1. 获取基础 DOM 元素
		const attachBtn = document.getElementById('chat-attach-btn');
		const funcPanelModal = document.getElementById('function-panel-modal');
		
		const vImgModal = document.getElementById('virtual-image-modal');
		const vImgInput = document.getElementById('virtual-image-input');
		const vImgCancel = document.getElementById('virtual-image-cancel');
		const vImgConfirm = document.getElementById('virtual-image-confirm');

		// ------------------------------------------------
		// A. 面板切换逻辑
		// ------------------------------------------------
		function toggleFunctionPanel() {
			const emoticonModal = document.getElementById('emoticon-picker-modal');
			if (emoticonModal && emoticonModal.classList.contains('show')) {
				emoticonModal.classList.remove('show');
			}
			if (funcPanelModal) {
				// 【新增判断】即将打开面板前，判断当前是否为群聊
				if (!funcPanelModal.classList.contains('show') && activeChatId) {
					const btnVideo = document.getElementById('btn-func-video');
					const btnCall = document.getElementById('btn-func-call');
					const char = characters.find(c => c.id == activeChatId);
					
					if (char && char.type === 'group') {
						// 群聊模式：隐藏视频和语音功能
						if (btnVideo) btnVideo.style.display = 'none';
						if (btnCall) btnCall.style.display = 'none';
					} else {
						// 单聊模式：恢复显示
						if (btnVideo) btnVideo.style.display = '';
						if (btnCall) btnCall.style.display = '';
					}
				}

				funcPanelModal.classList.toggle('show');
			}
		}

		if (attachBtn) {
			attachBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				toggleFunctionPanel();
			});
		}

		if (funcPanelModal) {
			funcPanelModal.addEventListener('click', (e) => {
				if (e.target === funcPanelModal) {
					funcPanelModal.classList.remove('show');
				}
			});
		}

		// ------------------------------------------------
		// B. 相册 (发送真实图片) 逻辑
		// ------------------------------------------------
		const btnFuncAlbum = document.getElementById('btn-func-album');
		const realImageInput = document.getElementById('real-image-input');

		if (btnFuncAlbum && realImageInput) {
			btnFuncAlbum.addEventListener('click', () => {
				if (funcPanelModal) funcPanelModal.classList.remove('show');
				realImageInput.click();
			});
		}

		if (realImageInput) {
			realImageInput.addEventListener('change', function(e) {
				const file = e.target.files[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = (event) => {
					// 此处省略了压缩逻辑以简化，你可以保留之前的压缩代码
					saveAndRenderMessage('[图片]', 'sent', null, null, null, false, event.target.result);
				};
				reader.readAsDataURL(file);
				this.value = '';
			});
		}

		// ------------------------------------------------
		// C. 拍摄/虚拟图片 逻辑
		// ------------------------------------------------
		const btnFuncCamera = document.getElementById('btn-func-camera');
		if (btnFuncCamera) {
			btnFuncCamera.addEventListener('click', () => {
				if (funcPanelModal) funcPanelModal.classList.remove('show');
				if (vImgModal && vImgInput) {
					vImgInput.value = '';
					vImgModal.classList.add('show');
					setTimeout(() => vImgInput.focus(), 100);
				}
			});
		}
		if (vImgCancel) {
			vImgCancel.addEventListener('click', () => {
				if (vImgModal) vImgModal.classList.remove('show');
			});
		}
		if (vImgConfirm) {
			vImgConfirm.addEventListener('click', () => {
                // ... (此部分逻辑保持不变)
                if (!vImgInput) return;
				const desc = vImgInput.value.trim();
				if (!desc) { alert('请描述一下图片内容'); return; }
				saveAndRenderMessage(desc, 'sent');
				const char = characters.find(c => c.id == activeChatId);
				if (char && char.chatHistory.length > 0) {
					const lastMsg = char.chatHistory[char.chatHistory.length - 1];
					lastMsg.isVirtual = true;
					saveCharactersToLocal();
					const container = document.getElementById('chat-message-container');
					if (container && container.lastElementChild) {
						container.lastElementChild.remove();
						renderMessageToScreen(lastMsg);
						scrollToBottom();
					}
				}
				if (vImgModal) vImgModal.classList.remove('show');
			});
		}

        // ============================================================
        // 【核心修改】视频通话与语音通话按钮逻辑更新
        // ============================================================
        
		// 1. 视频通话按钮
        const btnFuncVideo = document.getElementById('btn-func-video');
        if (btnFuncVideo) {
            const newBtn = btnFuncVideo.cloneNode(true);
            btnFuncVideo.parentNode.replaceChild(newBtn, btnFuncVideo);
            newBtn.addEventListener('click', () => {
                const funcPanelModal = document.getElementById('function-panel-modal');
                if (funcPanelModal) funcPanelModal.classList.remove('show');
                
                if (!activeChatId) { alert("请先进入一个对话"); return; }
                if (VideoCallSystem && VideoCallSystem.initiateUserCall) {
                    VideoCallSystem.initiateUserCall('video'); // 传入 video 标识
                }
            });
        }

		// 2. 语音通话按钮 (新增激活)
		const btnFuncCall = document.getElementById('btn-func-call');
		if (btnFuncCall) {
			const newBtnCall = btnFuncCall.cloneNode(true);
			btnFuncCall.parentNode.replaceChild(newBtnCall, btnFuncCall);
			newBtnCall.addEventListener('click', () => {
				const funcPanelModal = document.getElementById('function-panel-modal');
				if (funcPanelModal) funcPanelModal.classList.remove('show');
				
				if (!activeChatId) { alert("请先进入一个对话"); return; }
				const char = characters.find(c => c.id == activeChatId);
				if (!char) return;
				
				// 检查是否配置了声音
				if (!char.voice || !char.voice.id) {
					if(!confirm("该角色暂未配置声音ID，将只显示文字，是否继续？")) return;
				}

				if (VideoCallSystem && VideoCallSystem.initiateUserCall) {
					VideoCallSystem.initiateUserCall('voice'); // 传入 voice 标识
				}
			});
		}
        
		// ------------------------------------------------
		// D. 发送文件 逻辑
		// ------------------------------------------------
		const btnFuncFile = document.getElementById('btn-func-file');
		const vFileModal = document.getElementById('virtual-file-modal');
		const vFileName = document.getElementById('virtual-file-name');
		const vFileExt = document.getElementById('virtual-file-ext');
		const vFileDesc = document.getElementById('virtual-file-desc');
		const vFileCancel = document.getElementById('virtual-file-cancel');
		const vFileConfirm = document.getElementById('virtual-file-confirm');

		if (btnFuncFile) {
			btnFuncFile.addEventListener('click', () => {
				if (funcPanelModal) funcPanelModal.classList.remove('show');
				if (vFileModal && vFileName) {
					vFileName.value = '';
					vFileExt.value = '';
					vFileDesc.value = '';
					vFileModal.classList.add('show');
					setTimeout(() => vFileName.focus(), 100);
				}
			});
		}
		if (vFileCancel) {
			vFileCancel.addEventListener('click', () => {
				if (vFileModal) vFileModal.classList.remove('show');
			});
		}
		if (vFileConfirm) {
			vFileConfirm.addEventListener('click', () => {
				if (!vFileName) return;
				let name = vFileName.value.trim() || '未命名文档';
				let ext = vFileExt.value.trim() || 'txt';
				let desc = vFileDesc.value.trim();
				
				if (!desc) { alert('请描述一下文件内容供AI阅读'); return; }
				
				// 去除后缀名前可能带的"." (如 .pdf 变成 pdf)
				ext = ext.replace(/^\.+/, '');
				
				// 构建标准指令存入数据库
				const formatText = `[文件：${name}.${ext}|${desc}]`;
				saveAndRenderMessage(formatText, 'sent');
				
				if (vFileModal) vFileModal.classList.remove('show');
			});
		}

	})();
		
		// ============================================================
		// 【新增/修改】虚拟图片及文件 3段式点击逻辑 (带智能滚动修复)
		// 1. 图标 -> 2. 文字 -> 3. 文字+菜单+时间 -> 1. 回到图标
		// ============================================================
		window.handleVirtualCycle = function(event, timestamp, el) {
			event.stopPropagation(); // 阻止冒泡

			// 1. 获取相关 DOM 元素
			const bubble = el.closest('.msg-bubble');
			const menu = document.getElementById(`menu-${timestamp}`);
			const time = bubble.parentElement.querySelector('.msg-detail-time');

			// 2. 判断当前状态
			const isTextShown = bubble.classList.contains('show-text');
			const isMenuShown = menu.classList.contains('show');

			// 【核心新增】操作前先判断当前滚动条是否在底部
			let wasAtBottom = true;
			if (typeof isScrolledToBottom === 'function') {
				wasAtBottom = isScrolledToBottom();
			}

			// 3. 执行状态流转
			if (!isTextShown) {
				// --- 状态 A (图标) -> 状态 B (文字) ---
				bubble.classList.add('show-text');
				if (menu) menu.classList.remove('show');
				if (time) time.classList.remove('show');
			} 
			else if (isTextShown && !isMenuShown) {
				// --- 状态 B (文字) -> 状态 C (文字 + 菜单/时间) ---
				if (menu) menu.classList.add('show');
				if (time) time.classList.add('show');
			} 
			else {
				// --- 状态 C (全显示) -> 状态 A (图标) ---
				bubble.classList.remove('show-text');
				if (menu) menu.classList.remove('show');
				if (time) time.classList.remove('show');
			}

			// 【核心新增】如果用户本身就在看最新消息，展开盒子后帮他自动滚一下，防止被挡住
			if (wasAtBottom && typeof scrollToBottom === 'function') {
				// 延迟 50ms 等待 CSS 动画和 DOM 高度撑开
				setTimeout(() => {
					scrollToBottom();
				}, 50);
			}
		};
		
		// --- 【新增】聊天专用用户头像上传监听 ---
		if (settingUserAvatarUploader && settingUserAvatarInput) {
			// 点击图标触发文件选择
			settingUserAvatarUploader.addEventListener('click', () => {
				settingUserAvatarInput.click();
			});

			// 文件改变时压缩并预览
			settingUserAvatarInput.addEventListener('change', async function(e) {
				const file = e.target.files[0];
				if (!file || !file.type.startsWith('image/')) return;
				
				const reader = new FileReader();
				reader.onload = async (event) => {
					try {
						// 压缩成 120px 缩略图 (和角色头像一致)
						tempSettingUserAvatar = await compressImage(event.target.result, 120, 0.8);
						settingUserAvatarUploader.innerHTML = `<img src="${tempSettingUserAvatar}" style="width:100%; height:100%; object-fit:cover; border-radius: 8px;">`;
					} catch (error) {
						alert('图片处理失败: ' + error.message);
					}
				};
				reader.readAsDataURL(file);
				this.value = ''; // 清空 value 以便重复选择
			});
		}
		
		
		// --- 新增：角色专属 API 拉取模型 ---
        const settingFetchModelsBtn = document.getElementById('setting-fetch-models-btn');
        if (settingFetchModelsBtn) {
            settingFetchModelsBtn.addEventListener('click', () => {
                const urlInput = document.getElementById('setting-api-url');
                const keyInput = document.getElementById('setting-api-key');
                const modelSel = document.getElementById('setting-model-select');
                
                // 复用通用的拉取函数 fetchModelsForApi
                // 注意：最后一个参数传空对象或当前角色的apiSettings即可
                fetchModelsForApi(urlInput, keyInput, modelSel, settingFetchModelsBtn, {});
            });
        }
		
		// ============================================================
		// 【新增】朋友圈/论坛 API 设置逻辑
		// ============================================================

		// 1. 进入设置页
		if (socialApiSettingBtn) {
			socialApiSettingBtn.addEventListener('click', () => {
				// 回显数据
				socialApiUrlInput.value = socialApiSettings.baseUrl || '';
				socialApiKeyInput.value = socialApiSettings.apiKey || '';
				socialApiTempInput.value = socialApiSettings.temperature || '';
				
				// 回显模型
				if (socialApiSettings.model) {
					socialModelSelect.innerHTML = `<option value="${socialApiSettings.model}" selected>${socialApiSettings.model}</option>`;
				} else {
					socialModelSelect.innerHTML = `<option value="">请先拉取或手动输入</option>`;
				}

				// 填充预设下拉框 (复用全局预设 apiPresets)
				populatePresetDropdown(); 
				switchPage('social-api-setting-page');
				switchTopBar('social-api-setting-top');
			});
		}

		// 2. 返回按钮
		if (socialApiSettingTopBack) {
			socialApiSettingTopBack.addEventListener('click', () => {
				switchPage('contact-page');
				switchTopBar('contact-top');
			});
		}

		// 3. 保存按钮
		if (socialApiSaveBtn) {
			socialApiSaveBtn.addEventListener('click', () => {
				socialApiSettings.baseUrl = socialApiUrlInput.value.trim();
				socialApiSettings.apiKey = socialApiKeyInput.value.trim();
				socialApiSettings.model = socialModelSelect.value;
				
				const tempVal = parseFloat(socialApiTempInput.value);
				socialApiSettings.temperature = isNaN(tempVal) ? '' : tempVal;

				saveSocialApiSettingsToLocal();
				alert('朋友圈/论坛 API 设置已保存！');
				socialApiSettingTopBack.click();
			});
		}

		// 4. 拉取模型按钮 (复用通用的 fetchModelsForApi 函数)
		if (socialFetchModelsBtn) {
			socialFetchModelsBtn.addEventListener('click', () => {
				fetchModelsForApi(socialApiUrlInput, socialApiKeyInput, socialModelSelect, socialFetchModelsBtn, socialApiSettings);
			});
		}

		// 监听预设选择
		if (socialPresetSelectMenu) {
			socialPresetSelectMenu.addEventListener('change', (e) => {
				const presetName = e.target.value;
				if (!presetName) return;

				const preset = apiPresets.find(p => p.name === presetName);
				if (preset) {
					if(confirm(`确定要应用预设 "${presetName}" 到朋友圈API设置吗？`)) {
						// 用户点击“确认”，应用设置
						socialApiUrlInput.value = preset.baseUrl;
						socialApiKeyInput.value = preset.apiKey;
						socialApiTempInput.value = preset.temperature;
						
						if (preset.model) {
							socialModelSelect.innerHTML = `<option value="${preset.model}" selected>${preset.model}</option>`;
						} else {
							socialModelSelect.innerHTML = `<option value="">请先拉取模型</option>`;
						}
						// 此时 e.target.value 保持为 presetName，下拉框会正确显示
					} else {
						// 用户点击“取消”，将下拉框重置回默认选项
						e.target.value = "";
					}
				}
			});
		}
		
		// ============================================================
		// 【新增】朋友圈功能逻辑
		// ============================================================

		const momentsEntryBtn = document.getElementById('moments-entry-btn');
		const momentsTopBack = document.querySelector('#moments-top .top-bar-back');
		const postMomentBtn = document.getElementById('post-moment-btn');

		// 1. 从发现页进入朋友圈
		if (momentsEntryBtn) {
			momentsEntryBtn.addEventListener('click', () => {
				// 【新增】清除未读红点
                setMomentsUnread(false);
				// 渲染页面内容
				renderMomentsHeader();
				renderMomentsFeed();

				// 切换页面和顶部栏
				switchPage('moments-page');
				switchTopBar('moments-top');
				
				// 【关键】让内容区从顶部开始，以适配透明顶栏
				contentArea.style.top = '0';
			});
		}

		// 2. 从朋友圈返回发现页
		if (momentsTopBack) {
			momentsTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');

				// 【关键】恢复内容区的正常 top 值
				contentArea.style.top = '44px';
			});
		}



		// 4. 渲染朋友圈头部 (封面、用户名、头像)
		// ============================================================
		// 【完整修正版】渲染朋友圈头部
		// 包含：封面、用户名、头像渲染 + 点击进入设置页(带提示)
		// ============================================================
		function renderMomentsHeader() {
			const coverContainer = document.getElementById('moments-cover-img');
			const nameEl = document.getElementById('moments-user-name');
			const avatarEl = document.getElementById('moments-user-avatar');

			// 1. 渲染封面 (优先使用用户设置的封面)
			const coverUrl = userInfo.momentsCover || 'https://s41.ax1x.com/2026/02/07/pZoDx1H.jpg';
			coverContainer.style.backgroundImage = `url("${coverUrl}")`;

			// 绑定封面点击事件 (更换封面)
			coverContainer.onclick = () => {
				coverUrlInput.value = userInfo.momentsCover || '';
				coverChangeModal.classList.add('show');
			};
			
			// 2. 【核心找回】渲染用户姓名和头像 (之前可能被误删的部分)
			nameEl.textContent = userInfo.name;
			if (userInfo.avatar) {
				avatarEl.innerHTML = `<img src="${userInfo.avatar}" alt="avatar">`;
			} else {
				avatarEl.innerHTML = `<i class="${userInfo.avatarIcon || 'fas fa-user'}"></i>`;
			}

			// 3. 绑定头像点击事件 (进入设置页)
			avatarEl.onclick = () => {
				// A. 准备设置页数据
				renderPostableCharactersList();
				
				// 朋友圈特殊样式修正
				const contentArea = document.getElementById('main-content-area');
				if (contentArea) contentArea.style.top = '44px'; 
				
				// 回显数据
				if (memorySyncSwitch) memorySyncSwitch.checked = momentsSettings.memorySyncEnabled;
				if (memoryLimitInput) {
					memoryLimitInput.value = momentsSettings.memoryLimit;
					// 【新增】设置输入框提示
					memoryLimitInput.placeholder = "建议10-15条，默认10";
					memoryLimitInput.title = "建议不要超过15条以免影响性能";
				}

				// B. 切换页面
				switchPage('moments-setting-page');
				switchTopBar('moments-setting-top');
			};
		}

		// ============================================================
		// 【最终修改版】渲染朋友圈列表
		// 1. 读取设置限制
		// 2. 时间戳改为 getChatHistoryTime (带具体 HH:MM)
		// ============================================================
		function renderMomentsFeed() {
			const feedContainer = document.getElementById('moments-feed-container');
			if (!feedContainer) return;

			// 1. 空状态处理
			if (!socialMoments || socialMoments.length === 0) {
				feedContainer.innerHTML = `
					<div style="padding: 40px 20px; text-align: center; color: #999;">
						<i class="fas fa-wind" style="font-size: 32px; margin-bottom: 10px;"></i>
						<p>这里空空如也</p>
						<p style="font-size: 12px; margin-top: 5px;">刷新试试？或者发布第一条动态</p>
					</div>
				`;
				return;
			}

			// 2. 读取限制并截取数据
			const limit = (momentsSettings && momentsSettings.memoryLimit) ? parseInt(momentsSettings.memoryLimit) : 10;
			
			const sortedMoments = [...socialMoments]
				.sort((a, b) => b.timestamp - a.timestamp)
				.slice(0, limit); 

			let html = '';

			// 3. 遍历生成 HTML
			sortedMoments.forEach(post => {
				if (!post.likes) post.likes = [];
				if (!post.comments) post.comments = [];

				// --- A. 头像与作者 ---
				const avatarHtml = post.authorAvatar 
					? `<img src="${post.authorAvatar}" alt="avatar">` 
					: '<i class="fas fa-user" style="font-size: 20px; color: #ccc;"></i>';

				// --- B. 图片 ---
				let imagesHtml = '';
				if (post.images && post.images.length > 0) {
					const imgCount = post.images.length;
					const imageItems = post.images.map(imgStr => {
						if (imgStr.startsWith('virtual_text::')) {
							const content = imgStr.replace('virtual_text::', '');
							return `<div class="post-image-item"><div class="moment-virtual-card" onclick="toggleMomentVirtual(this)"><div class="mv-placeholder"><i class="fas fa-image mv-icon"></i><span class="mv-hint">查看图片</span></div><div class="mv-content">${content}</div></div></div>`;
						} else {
							return `<div class="post-image-item"><img src="${imgStr}" alt="post image" style="width:100%; height:100%; object-fit:cover;"></div>`;
						}
					}).join('');
					imagesHtml = `<div class="post-images image-count-${imgCount}">${imageItems}</div>`;
				}
				
				// 【核心修改点】这里改成了 getChatHistoryTime
				// 效果：今天 14:30 / 昨天 14:30 / 星期五 14:30 / 2023/10/01 14:30
				const timeAgo = getChatHistoryTime(post.timestamp);

				// --- C. 点赞状态 ---
				const postChar = characters.find(c => c.name === post.authorName);
				let currentUserName = userInfo.name;
				if (postChar && postChar.userName && postChar.userName.trim()) {
					currentUserName = postChar.userName.trim();
				}

				const isLikedByMe = post.likes.includes(currentUserName);
				const menuHeartClass = isLikedByMe ? 'fas fa-heart liked' : 'far fa-heart unliked';
				const listHeartClass = isLikedByMe ? 'fas fa-heart liked-icon' : 'far fa-heart';
				const likeActionText = isLikedByMe ? '取消' : '赞';

				// --- D. 删除按钮 ---
				const deleteBtnHtml = `
					<div class="moment-menu-line"></div>
					<div class="moment-menu-item" onclick="handleMomentDelete('${post.id}')">
						<i class="far fa-trash-alt"></i> 删除
					</div>
				`;

				// --- E. 点赞列表 ---
				let likesSectionHtml = '';
				if (post.likes.length > 0) {
					const likeUsersHtml = post.likes.map(name => `<span class="moment-user-blue" style="color: #576b95; font-weight: 500;">${name}</span>`).join(', ');
					likesSectionHtml = `
						<div class="moment-likes">
							<i class="${listHeartClass}"></i> ${likeUsersHtml}
						</div>
					`;
				}

				// --- F. 评论列表 ---
				let commentsSectionHtml = '';
				if (post.comments.length > 0) {
					const commentsList = post.comments.map((c, index) => {
						let userHtml = `<span class="moment-user-blue" style="color: #576b95; font-weight: 500;">${c.user}</span>`;
						let replyHtml = c.replyTo ? `回复 <span class="moment-user-blue" style="color: #576b95; font-weight: 500;">${c.replyTo}</span>` : '';
						const deleteCommentHtml = `<span onclick="event.stopPropagation(); deleteMomentComment('${post.id}', ${index})" style="color: #576b95; font-size: 12px; margin-left: 5px; cursor: pointer;">删除</span>`;

						return `
							<div class="moment-comment-item" onclick="handleSimpleCommentReply('${post.id}', '${c.user}')" style="line-height: 1.4;">
								${userHtml} ${replyHtml}: <span class="moment-comment-content" style="color:#333;">${c.content}</span>
								${deleteCommentHtml}
							</div>
						`;
					}).join('');
					commentsSectionHtml = `<div class="moment-comments">${commentsList}</div>`;
				}

				// --- G. 互动区域 ---
				let interactionsHtml = '';
				if (likesSectionHtml || commentsSectionHtml) {
					interactionsHtml = `
						<div class="moment-interactions">
							${likesSectionHtml}
							${commentsSectionHtml}
						</div>
					`;
				}

				// --- H. 拼接 ---
				html += `
					<div class="moment-post" data-id="${post.id}">
						<div class="post-left">
							<div class="post-avatar">${avatarHtml}</div>
						</div>
						<div class="post-main">
							<div class="post-author moment-user-blue" style="color: #576b95; font-weight: 600;">${post.authorName}</div>
							<div class="post-content">${post.content}</div>
							${imagesHtml}
							
							<div class="post-meta">
								<span class="post-timestamp">${timeAgo}</span>
								<button class="post-action-btn" onclick="toggleMomentMenu(event, '${post.id}')">••</button>
								
								<div class="moment-action-menu" id="moment-menu-${post.id}">
									<div class="moment-menu-item" onclick="handleSimpleLike('${post.id}')">
										<i class="${menuHeartClass}"></i> ${likeActionText}
									</div>
									<div class="moment-menu-line"></div>
									<div class="moment-menu-item" onclick="handleSimpleComment('${post.id}')">
										<i class="far fa-comment"></i> 评论
									</div>
									${deleteBtnHtml}
								</div>
							</div>

							${interactionsHtml}
						</div>
					</div>
				`;
			});

			// 4. 底部提示
			if (socialMoments.length >= limit) {
				html += `<div style="text-align:center; padding: 20px; color:#ccc; font-size:12px;">已显示最近 ${limit} 条动态 (已根据设置隐藏旧内容)</div>`;
			}

			feedContainer.innerHTML = html;
		}
		// ============================================================
		// 【新增】更换朋友圈封面弹窗逻辑
		// ============================================================

		// 1. 取消按钮
		if (cancelChangeCoverBtn) {
			cancelChangeCoverBtn.addEventListener('click', () => {
				coverChangeModal.classList.remove('show');
			});
		}

		// 2. 确认按钮
		if (confirmChangeCoverBtn) {
			confirmChangeCoverBtn.addEventListener('click', () => {
				const newUrl = coverUrlInput.value.trim();

				// 更新数据
				userInfo.momentsCover = newUrl;
				saveUserInfoToLocal();

				// 立即更新界面
				const coverContainer = document.getElementById('moments-cover-img');
				if (coverContainer) {
					const displayUrl = newUrl || 'https://s41.ax1x.com/2026/02/07/pZoDx1H.jpg'; // 如果清空URL，则恢复默认
					coverContainer.style.backgroundImage = `url("${displayUrl}")`;
				}
				
				// 关闭弹窗
				coverChangeModal.classList.remove('show');
				alert('封面已更新！');
			});
		}
		
		// --- 朋友圈评论相关全局变量 ---
		let currentCommentPostId = null;  // 当前正在评论的帖子ID
		let currentCommentReplyTo = null; // 当前正在回复的对象 (null表示直接评论帖子)
		// ============================================================
		// 【新增】朋友圈设置页面逻辑
		// ============================================================

		// 1. 渲染可发布角色的列表
		function renderPostableCharactersList() {
			postableCharsContainer.innerHTML = ''; // 清空
			if (!characters || characters.length === 0) {
				postableCharsContainer.innerHTML = `<div style="padding:10px; color:#999; text-align:center;">暂无任何角色</div>`;
				return;
			}

			// 获取已选中的角色ID
			const selectedIds = momentsSettings.postableCharacterIds || [];

			characters.forEach(char => {
				const isChecked = selectedIds.includes(char.id) ? 'checked' : '';
				const label = document.createElement('label');
				label.className = 'checkbox-item';
				label.innerHTML = `
					<input type="checkbox" value="${char.id}" ${isChecked}>
					<span class="custom-check-circle"></span>
					<span>${char.name}</span>
				`;
				postableCharsContainer.appendChild(label);
			});
		}

		// 2. 设置页返回按钮
		if (momentsSettingBackBtn) {
			momentsSettingBackBtn.addEventListener('click', () => {
				// 这里可以添加一个“未保存”的确认弹窗
				switchPage('moments-page');
				switchTopBar('moments-top');
			});
		}

		// 3. 设置页保存按钮
		// ============================================================
		// 【修改】朋友圈设置页保存按钮逻辑
		// 1. 保存时立即执行数据裁切
		// 2. 限制最大条数
		// ============================================================
		if (momentsSettingSaveBtn) {
			momentsSettingSaveBtn.addEventListener('click', () => {
				// 1. 读取选中的角色
				const selectedIds = [];
				postableCharsContainer.querySelectorAll('input:checked').forEach(input => {
					selectedIds.push(input.value);
				});

				// 2. 读取开关和输入框的值
				const isSyncEnabled = memorySyncSwitch.checked;
				let limit = parseInt(memoryLimitInput.value);

				// 【优化】输入校验与提示
				if (isNaN(limit) || limit < 1) {
					alert('请输入有效的条数（建议10-15条）！');
					return;
				}
				
				// 3. 更新设置
				momentsSettings.postableCharacterIds = selectedIds;
				momentsSettings.memorySyncEnabled = isSyncEnabled;
				momentsSettings.memoryLimit = limit;
				
				// 4. 保存设置
				saveMomentsSettingsToLocal();

				// 【核心新增】立即对现有数据进行裁切 (数据做减法)
				if (socialMoments && socialMoments.length > limit) {
					// 保留最新的 limit 条，删除旧的
					socialMoments = socialMoments.slice(0, limit);
					saveMomentsToLocal(); 
					console.log(`已根据设置裁切朋友圈数据，剩余 ${socialMoments.length} 条`);
				}

				alert('朋友圈设置已保存！');
				
				// 点击返回按钮逻辑（见下方第2点修复）
				momentsSettingBackBtn.click();
			});
		}
		
		// ============================================================
		// 【最终修复版】发布朋友圈页面逻辑 (彻底修复二次弹窗问题)
		// ============================================================

		// 1. 获取 DOM 元素 (确保只声明一次)
		const postMomentTop = document.getElementById('post-moment-top');
		const postMomentPage = document.getElementById('post-moment-page');
		const doPostBtn = document.getElementById('do-post-moment-btn'); 
		
		const postPersonaSelect = document.getElementById('post-persona-select');
		const postPersonaPreview = document.getElementById('post-persona-preview');
		const postImgCountInput = document.getElementById('post-img-count');
		const postImgInputsContainer = document.getElementById('post-img-inputs-container');
		const postMomentText = document.getElementById('post-moment-text');
		const postRealImgInput = document.getElementById('post-real-img-input');
		const postRealImgsContainer = document.getElementById('post-real-imgs-container');
		let postRealImages =[]; // 存储真实图片的 base64

		// ============================================================
		// 【核心修复：将真实图片的事件监听提取到外部，只绑定一次！】
		// ============================================================
		if (postRealImgsContainer && postRealImgInput) {
			// 使用 onclick 和 onchange 替代 addEventListener 的累加，防止多次进页面重复绑定
			postRealImgsContainer.onclick = (e) => {
				const uploader = e.target.closest('#post-real-img-uploader');
				if (uploader) {
					const virtualCount = parseInt(postImgCountInput.value) || 0;
					if (postRealImages.length + virtualCount >= 4) {
						alert('总计最多只能发4张图片哦！'); return;
					}
					postRealImgInput.click();
				}
				
				const deleteBtn = e.target.closest('.delete-real-img-btn');
				if (deleteBtn) {
					const idx = parseInt(deleteBtn.getAttribute('data-index'));
					postRealImages.splice(idx, 1);
					if(typeof window.renderPostRealImages === 'function') window.renderPostRealImages();
				}
			};

			postRealImgInput.onchange = async function(e) {
				const files = Array.from(e.target.files);
				if (!files.length) return;
				const virtualCount = parseInt(postImgCountInput.value) || 0;
				
				for (let file of files) {
					if (postRealImages.length + virtualCount >= 4) break;
					if (!file.type.startsWith('image/')) continue;
					
					const reader = new FileReader();
					reader.onload = async (event) => {
						try {
							const compressed = await compressImage(event.target.result, 800, 0.8);
							postRealImages.push(compressed);
							if(typeof window.renderPostRealImages === 'function') window.renderPostRealImages();
						} catch(err) { console.error(err); }
					};
					reader.readAsDataURL(file);
				}
				this.value = '';
			};
		}

		window.renderPostRealImages = function() {
			if(!postRealImgsContainer) return;
			let html = '';
			postRealImages.forEach((img, idx) => {
				html += `
					<div style="position: relative; width: 60px; height: 60px;">
						<img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">
						<div class="delete-real-img-btn" data-index="${idx}" style="position: absolute; top: -5px; right: -5px; background: red; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10;"><i class="fas fa-times"></i></div>
					</div>
				`;
			});
			const virtualCount = parseInt(postImgCountInput.value) || 0;
			if (postRealImages.length + virtualCount < 4) {
				html += `<div class="character-avatar-uploader" id="post-real-img-uploader" style="width: 60px; height: 60px; border-radius: 4px; font-size: 20px;"><i class="fas fa-plus"></i></div>`;
			}
			postRealImgsContainer.innerHTML = html;
		}

		// 2. 初始化并进入发布页面 (点击朋友圈首页右上角的相机/发布按钮)
		if (postMomentBtn) {
			// 为了防止重复绑定事件，这里使用 cloneNode 清理旧事件
			const newPostEntryBtn = postMomentBtn.cloneNode(true);
			postMomentBtn.parentNode.replaceChild(newPostEntryBtn, postMomentBtn);
			
			newPostEntryBtn.addEventListener('click', () => {
				// A. 准备数据：填充身份选择器
				populatePersonaSelect();
				
				// B. 重置表单
				postMomentText.value = '';
				postImgCountInput.value = '';
				postImgInputsContainer.innerHTML = '';
				postRealImages =[]; // 清空图片数组
				if(typeof window.renderPostRealImages === 'function') {
					window.renderPostRealImages(); // 重新渲染上传区域
				}
				updatePersonaPreview(); // 更新预览为默认选中项
				
				// C. 跳转
				switchPage('post-moment-page');
				switchTopBar('post-moment-top');
				
				// 恢复内容区顶部距离 (防止之前朋友圈页面的特殊样式影响)
				const contentArea = document.getElementById('main-content-area');
				if(contentArea) contentArea.style.top = '44px'; 
			});
		}

		// 3. 页面返回按钮
		const postBackBtn = document.querySelector('#post-moment-top .top-bar-back');
		if (postBackBtn) {
			postBackBtn.addEventListener('click', () => {
				switchPage('moments-page');
				switchTopBar('moments-top');
				const contentArea = document.getElementById('main-content-area');
				if(contentArea) contentArea.style.top = '0'; // 朋友圈主页特殊样式
			});
		}

		// 4. 填充身份选择下拉框 (逻辑：任意一项专用设定存在即生成)
		function populatePersonaSelect() {
			if(!postPersonaSelect) return;
			postPersonaSelect.innerHTML = '';

			// --- Option 1: 全局默认身份 ---
			const globalOpt = document.createElement('option');
			globalOpt.value = 'global';
			globalOpt.text = `全局默认: ${userInfo.name}`;
			globalOpt.dataset.name = userInfo.name;
			globalOpt.dataset.avatar = userInfo.avatar || '';
			globalOpt.dataset.mask = userInfo.mask || '无面具';
			postPersonaSelect.add(globalOpt);

			// --- Option 2: 从面具预设库中读取 ---
			if (typeof userMasks !== 'undefined') {
				userMasks.forEach(mask => {
					const opt = document.createElement('option');
					opt.value = mask.id; // 【关键】直接存面具ID
					// 【新增】在朋友圈面具选择器上也加上备注
					const remarkStr = mask.remark ? ` (${mask.remark})` : '';
					opt.text = `[马甲]: ${mask.name}${remarkStr}`;					
					opt.dataset.name = mask.name;
					// 【修复】如果马甲没有头像，则使用全局默认头像补上
					opt.dataset.avatar = mask.avatar || userInfo.avatar || '';
					opt.dataset.mask = mask.mask || '';
					postPersonaSelect.add(opt);
				});
			}
			updatePersonaPreview();
		}

		// 5. 监听下拉框变化，更新预览卡片
		if (postPersonaSelect) {
			postPersonaSelect.addEventListener('change', updatePersonaPreview);
		}

		function updatePersonaPreview() {
			if (!postPersonaSelect || !postPersonaPreview) return;
			const selectedOpt = postPersonaSelect.options[postPersonaSelect.selectedIndex];
			if (!selectedOpt) return;

			const name = selectedOpt.dataset.name;
			const avatar = selectedOpt.dataset.avatar;
			const mask = selectedOpt.dataset.mask;

			const previewName = postPersonaPreview.querySelector('.pp-name');
			const previewMask = postPersonaPreview.querySelector('.pp-mask');
			const previewAvatar = postPersonaPreview.querySelector('.pp-avatar');

			if(previewName) previewName.textContent = name;
			if(previewMask) previewMask.textContent = mask.length > 20 ? mask.substring(0, 20) + '...' : mask;
			
			if (previewAvatar) {
				if (avatar) {
					previewAvatar.innerHTML = `<img src="${avatar}">`;
				} else {
					previewAvatar.innerHTML = `<i class="fas fa-user"></i>`;
				}
			}
		}

		// 6. 监听图片数量变化，生成输入框
		if (postImgCountInput) {
			postImgCountInput.addEventListener('input', (e) => {
				let count = parseInt(e.target.value);
				
				// 基础校验
				if (isNaN(count)) count = 0;
				if (count < 0) count = 0;
				if (count > 4) {
					count = 4;
					e.target.value = 4; // 强制修正界面显示
				}

				renderImageInputs(count);
			});
		}
		
		function renderImageInputs(count) {
			if (!postImgInputsContainer) return;
			postImgInputsContainer.innerHTML = ''; // 清空旧内容

			for (let i = 1; i <= count; i++) {
				const div = document.createElement('div');
				div.className = 'img-input-group';
				div.innerHTML = `
					<label style="font-size: 12px; color: #888; margin-bottom: 5px; display:block;">图片 ${i} 内容描述</label>
					<input type="text" class="form-input moment-img-input" placeholder="输入文字描述" data-index="${i}">
				`;
				postImgInputsContainer.appendChild(div);
			}
		}

		// 7. 最终发布逻辑 (点击右上角发布按钮)
		if (doPostBtn) {
			doPostBtn.addEventListener('click', () => {
				const content = postMomentText ? postMomentText.value.trim() : '';
				const selectedOpt = postPersonaSelect.options[postPersonaSelect.selectedIndex];
				let sourceId = 'global'; 
				if (selectedOpt && selectedOpt.value && selectedOpt.value !== 'global') sourceId = selectedOpt.value; 
				
				const imageInputs = document.querySelectorAll('.moment-img-input');
				let hasImageInput = false;
				imageInputs.forEach(input => { if(input.value.trim()) hasImageInput = true; });

				if (!content && !hasImageInput && postRealImages.length === 0) {
					alert('写点什么或描述/上传一张图片吧！');
					return;
				}

				const images =[];
				imageInputs.forEach(input => { if (input.value.trim()) images.push('virtual_text::' + input.value.trim()); });
				postRealImages.forEach(imgBase64 => images.push(imgBase64));

				const newMoment = {
					id: 'moment_' + Date.now(),
					authorName: selectedOpt.dataset.name,
					authorAvatar: selectedOpt.dataset.avatar || userInfo.avatar || '',
					content: content,
					sourceId: sourceId,
					images: images,
					imageDescriptions:[], 
					timestamp: Date.now()
				};
				if (typeof socialMoments !== 'undefined') {
					socialMoments.unshift(newMoment);
					saveMomentsToLocal(); 
				}
				renderMomentsFeed(); 
				
				const backBtn = document.querySelector('#post-moment-top .top-bar-back');
				if(backBtn) backBtn.click();

				const refreshLoader = document.getElementById('moments-refresh-loader');
				const refreshText = document.getElementById('moments-refresh-text');
				const refreshIcon = document.getElementById('moments-refresh-icon');
				if (refreshLoader) refreshLoader.style.height = '50px';
				if (refreshIcon) refreshIcon.className = "fas fa-spinner fa-spin";
				if (refreshText) refreshText.innerText = "后台识图中，请稍候...";

				setTimeout(async () => {
					try {
						let imageDescs =[];
						for (let i = 0; i < images.length; i++) {
							const imgData = images[i];
							if (imgData.startsWith('virtual_text::')) {
								imageDescs.push(imgData.replace('virtual_text::', ''));
							} else {
								if (refreshText) refreshText.innerText = `正在识图 (${i+1}/${postRealImages.length})...`;
								try {
									const desc = await analyzeImage(imgData);
									imageDescs.push(desc);
								} catch (err) {
									console.error('识图失败', err);
									imageDescs.push("一张图片 (识图失败)");
								}
							}
						}
						newMoment.imageDescriptions = imageDescs;
						saveMomentsToLocal();

						if (refreshText) refreshText.innerText = "通知好友中...";
						await generateReactionsToUserPost(newMoment);
						
						if (refreshText) refreshText.innerText = "发布与互动完成！";
						if (refreshIcon) refreshIcon.className = "fas fa-check";
					} catch(e) {
						console.error("后台处理失败:", e);
						if (refreshText) refreshText.innerText = "后台处理发生错误";
						if (refreshIcon) refreshIcon.className = "fas fa-times";
					} finally {
						setTimeout(() => { if (refreshLoader) refreshLoader.style.height = '0px'; }, 1500);
					}
				}, 100); 
			});
		}
		// ============================================================
		// 【全局函数】朋友圈虚拟图片点击交互 (必须放在最外层)
		// ============================================================
		window.toggleMomentVirtual = function(el) {
			// 阻止冒泡，防止触发进入详情页等其他潜在事件
			if (window.event) {
				window.event.stopPropagation();
			}
			
			// 切换 class 来控制显示/隐藏
			// 需要配合 CSS 中的 .moment-virtual-card.show-text 样式
			el.classList.toggle('show-text');
		};
		
		// ============================================================
		// 【新增】朋友圈交互逻辑 (点赞、评论、删除)
		// ============================================================

		// 1. 切换操作菜单显示/隐藏
		window.toggleMomentMenu = function(event, postId) {
			event.stopPropagation(); // 阻止冒泡
			
			// 先关闭所有其他的菜单
			document.querySelectorAll('.moment-action-menu.show').forEach(el => {
				if (el.id !== `moment-menu-${postId}`) {
					el.classList.remove('show');
				}
			});

			const menu = document.getElementById(`moment-menu-${postId}`);
			if (menu) {
				menu.classList.toggle('show');
			}
		};

		// 全局点击关闭朋友圈菜单
		document.addEventListener('click', (e) => {
			if (!e.target.closest('.moment-action-menu') && !e.target.closest('.post-action-btn')) {
				document.querySelectorAll('.moment-action-menu.show').forEach(el => {
					el.classList.remove('show');
				});
			}
		});


		// 3. 处理评论
		window.handleMomentComment = function(postId) {
			const post = socialMoments.find(p => p.id === postId);
			if (!post) return;

			// 这里使用简单的 prompt，也可以换成自定义弹窗
			const content = prompt("请输入评论内容：");
			if (content && content.trim()) {
				if (!post.comments) post.comments = [];
				
				post.comments.push({
					user: userInfo.name,
					content: content.trim()
				});

				saveMomentsToLocal();
				renderMomentsFeed();
			}
			
			// 关闭菜单
			const menu = document.getElementById(`moment-menu-${postId}`);
			if(menu) menu.classList.remove('show');
		};

		// 4. 处理删除动态
		window.handleMomentDelete = function(postId) {
			if (confirm("确定要删除这条朋友圈吗？")) {
				socialMoments = socialMoments.filter(p => p.id !== postId);
				saveMomentsToLocal();
				renderMomentsFeed();
			}
		};
		
		// 删除单条评论
		window.deleteMomentComment = function(postId, commentIndex) {
			if(!confirm("删除这条评论？")) return;
			const post = socialMoments.find(p => p.id === postId);
			if(post && post.comments) {
				post.comments.splice(commentIndex, 1);
				saveMomentsToLocal();
				renderMomentsFeed();
			}
		};

		// 简化版点赞 (自动识别身份)
		window.handleSimpleLike = function(postId) {
			const post = socialMoments.find(p => p.id === postId);
			if (!post) return;
			if (!post.likes) post.likes =[];

			// 1. 确定身份
			const postChar = characters.find(c => c.name === post.authorName);
			let myIdentity = userInfo.name;
			
			if (postChar) {
				// 【情况A】如果帖子是AI发的，使用我跟这个AI对话的面具
				if (postChar.userMaskId) {
					const boundMask = userMasks.find(m => m.id === postChar.userMaskId);
					if (boundMask && boundMask.name) myIdentity = boundMask.name;
				} else if (postChar.userName && postChar.userName.trim()) {
					myIdentity = postChar.userName.trim();
				}
			} else {
				// 【情况B】如果帖子是我自己发的，使用我发这条帖子时选用的面具
				if (post.sourceId && post.sourceId !== 'global') {
					const boundMask = userMasks.find(m => m.id === post.sourceId);
					if (boundMask && boundMask.name) myIdentity = boundMask.name;
				}
			}

			// 2. 切换状态
			const idx = post.likes.indexOf(myIdentity);
			if (idx === -1) {
				post.likes.push(myIdentity);
			} else {
				post.likes.splice(idx, 1);
			}

			saveMomentsToLocal();
			renderMomentsFeed();
			// 关闭菜单
			const menu = document.getElementById(`moment-menu-${postId}`);
			if(menu) menu.classList.remove('show');
		};

		// 简化版评论 (直接弹 prompt，不再选身份)
		window.handleSimpleComment = function(postId) {
			// 关闭菜单
			const menu = document.getElementById(`moment-menu-${postId}`);
			if(menu) menu.classList.remove('show');

			const content = prompt("请输入评论内容：");
			if (content && content.trim()) {
				executeComment(postId, null, content.trim());
			}
		};

		// 简化版回复评论
		window.handleSimpleCommentReply = function(postId, replyToUser) {
			const content = prompt(`回复 ${replyToUser}：`);
			if (content && content.trim()) {
				executeComment(postId, replyToUser, content.trim());
			}
		};

		// 执行评论并触发 AI 回复 (核心逻辑入口 - 修复版：支持回复AI层主与NPC)
		async function executeComment(postId, replyToUser, content) {
			const post = socialMoments.find(p => p.id === postId);
			if (!post) return;
			if (!post.comments) post.comments =[];

			// 1. 确定我的身份 (保持原有逻辑)
			const postChar = characters.find(c => c.name === post.authorName);
			let myIdentity = userInfo.name;

			if (postChar) {
				if (postChar.userMaskId) {
					const boundMask = userMasks.find(m => m.id === postChar.userMaskId);
					if (boundMask && boundMask.name) myIdentity = boundMask.name;
				} else if (postChar.userName && postChar.userName.trim()) {
					myIdentity = postChar.userName.trim();
				}
			} else {
				if (post.sourceId && post.sourceId !== 'global') {
					const boundMask = userMasks.find(m => m.id === post.sourceId);
					if (boundMask && boundMask.name) myIdentity = boundMask.name;
				}
			}

			// 2. 保存用户评论
			post.comments.push({
				user: myIdentity,
				content: content,
				replyTo: replyToUser
			});
			saveMomentsToLocal();
			renderMomentsFeed();

			// 3. 【核心修改：智能触发 AI 回复 (分流NPC和主角色)】
			
			if (replyToUser) {
				// 尝试寻找真实的 AI 角色
				const targetAiChar = characters.find(c => c.name === replyToUser);
				
				if (targetAiChar) {
					// 情况 A: 用户回复了具体的 AI 角色
					await triggerAiReplyToMomentComment(post, targetAiChar, myIdentity, content, replyToUser);
				} else {
					// 情况 B: 用户回复了虚拟的 NPC
					// 我们需要找一个“宿主” AI 来作为底座引擎，代为扮演 NPC 发言。
					let hostChar = null;
					if (postChar) {
						// 优先让发帖的 AI 楼主代劳
						hostChar = postChar;
					} else {
						// 如果是用户自己的帖子，随便找一个跟该面具绑定的 AI 来代劳
						hostChar = characters.find(c => c.userMaskId === post.sourceId || (!c.userMaskId && post.sourceId === 'global'));
					}
					if (!hostChar && characters.length > 0) hostChar = characters[0]; // 终极兜底

					if (hostChar) {
						// 调用新增的 NPC 回复函数
						await triggerNpcReplyToMomentComment(post, hostChar, myIdentity, content, replyToUser);
					}
				}
				return; // 结束，避免重复触发楼主
			}

			// 情况 C：用户直接评论帖子，且楼主是 AI (replyToUser 为空，postChar 存在)
			if (!replyToUser && postChar) {
				await triggerAiReplyToMomentComment(post, postChar, myIdentity, content, null);
			}
		}
		// ============================================================
		// 【终极修复】让 AI 充当世界模拟器，代为生成 NPC 对用户的回复 (打通全量上下文)
		// ============================================================
		async function triggerNpcReplyToMomentComment(post, hostChar, userName, userContent, npcName) {
			// --- 1. UI 动画初始化 ---
			const refreshLoader = document.getElementById('moments-refresh-loader');
			const refreshText = document.getElementById('moments-refresh-text');
			const refreshIcon = document.getElementById('moments-refresh-icon');
			const manualBtnIcon = document.querySelector('#manual-refresh-btn i');

			if (refreshLoader) {
				refreshLoader.style.height = '50px';
				refreshLoader.style.transition = 'height 0.3s ease';
			}
			if (refreshText) refreshText.innerText = `${npcName} 正在回复...`;
			if (refreshIcon) refreshIcon.className = "fas fa-spinner fa-spin";
			if (manualBtnIcon) manualBtnIcon.classList.add('fa-spin');

			// --- 2. 准备数据 ---
			let userMaskDesc = userInfo.mask || "无设定";
			if (hostChar.userMaskId) {
				const boundMask = userMasks.find(m => m.id === hostChar.userMaskId);
				if (boundMask && boundMask.mask) userMaskDesc = boundMask.mask;
			} else if (hostChar.userMask) {
				userMaskDesc = hostChar.userMask;
			}

			const { wbBefore, wbAfter } = getFormattedWorldBooks(hostChar.worldBookIds);

			// 【核心修复】：为 NPC 注入主线角色视角的全量记忆，保证世界观和剧情的连贯性
			let weatherContext = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(hostChar.id) : "";
			let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(hostChar.id) : ""; // <--- 借用宿主日程作为客观时间线参考
			// 【修复点】将 char 修正为 hostChar
			const postSourceId = hostChar.userMaskId || 'global';
			const sameMaskCharIds = characters
				.filter(c => c.type !== 'group' && (c.userMaskId || 'global') === postSourceId)
				.map(c => c.id);
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(sameMaskCharIds) : "";
			const persona = hostChar.persona || "无设定";
			const ltm = (hostChar.longTermMemories || []).join('; ');
			const lifeEvents = (hostChar.lifeEvents ||[]).map(e => e.event).join('; ');
			const recentChat = (hostChar.chatHistory ||[])
				.slice(-15)
				.map(m => {
					if (m.isHidden || m.isSystemMsg) return "";
					const role = m.type === 'sent' ? userName : hostChar.name;
					return `${role}: ${m.text}`;
				})
				.filter(Boolean)
				.join('\n');

			let promptImagesDesc = "";
			if (post.imageDescriptions && post.imageDescriptions.length > 0) {
				promptImagesDesc = post.imageDescriptions.join(', ');
			} else {
				promptImagesDesc = (post.images ||[]).map(img => img.startsWith('virtual_text::') ? img.replace('virtual_text::', '') : '[图片]').join(', ');
			}

			const systemPrompt = `
			${wbBefore}
			你现在是世界角色扮演模拟器。在朋友圈中，用户 "${userName}" 刚刚回复了一个名叫 "${npcName}" 的共同好友(NPC)。
			你需要扮演 "${npcName}" 生成一条简短自然的回复。

			【全局背景参考资料 (宿主视角: ${hostChar.name})】
			如果你扮演的NPC与以下事件或背景有关，请自然地参考它们，以保证世界观和逻辑连贯：
			- 世界观设定: ${wbAfter}
			- 天气环境: ${weatherContext || '无'}
			- 当日运势:${fortuneContext}
			- 宿主设定: ${persona}
			- 宿主日程安排： ${theirDayContext}
			- 长期记忆: ${ltm || '暂无'}
			- 人生档案: ${lifeEvents || '暂无'}
			- 宿主近期聊天: 
			  ${recentChat || '暂无'}

			【用户(${userName})设定】: ${userMaskDesc}

			【朋友圈原文】
			发布者: ${post.authorName}
			内容: ${post.content}
			图片: ${promptImagesDesc || '无'}

			【当前互动情况】
			用户 "${userName}" 对 ${npcName} 评论道: "${userContent}"

			【任务】
			请以 "${npcName}" 的身份和口吻直接生成回复内容。语气要符合微信朋友圈中普通朋友的社交氛围。
			不要带引号，直接输出内容。
			`;

			const useSettings = (socialApiSettings && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;

			try {
				const replyText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: `请直接生成 ${npcName} 的回复。` }
				], useSettings);

				if (replyText) {
					if (!post.comments) post.comments =[];
					post.comments.push({
						user: npcName,
						content: replyText.replace(/^["']|["']$/g, '').trim(),
						replyTo: userName
					});
					saveMomentsToLocal();
					renderMomentsFeed();
					
					const currentPage = document.querySelector('.page.active');
					if (currentPage && currentPage.id !== 'moments-page') setMomentsUnread(true);

					if (refreshText) refreshText.innerText = "回复成功";
					if (refreshIcon) refreshIcon.className = "fas fa-check";
					setTimeout(stopLoadingAnimation, 1000);
				}
			} catch (e) {
				console.error("NPC 回复评论失败:", e);
				if (refreshText) refreshText.innerText = "回复失败";
				setTimeout(stopLoadingAnimation, 1000);
			}

			function stopLoadingAnimation() {
				if (refreshLoader) refreshLoader.style.height = '0px';
				if (manualBtnIcon) manualBtnIcon.classList.remove('fa-spin');
				setTimeout(() => {
					if (refreshText) refreshText.innerText = "点击按钮刷新";
					if (refreshIcon) {
						refreshIcon.className = "fas fa-arrow-down";
						refreshIcon.classList.remove('fa-spin', 'fa-spinner');
					}
				}, 300);
			}
		}
		// ============================================================
		// 【最终极简版】朋友圈刷新逻辑 (仅按钮触发，无拖拽)
		// ============================================================

		(function initMomentsButtonOnly() {
			// 1. 变量定义
			let isRefreshing = false;
			
			// 获取提示条元素（保留它作为加载进度条显示，但不用手拉）
			const refreshLoader = document.getElementById('moments-refresh-loader');      
			const refreshText = document.getElementById('moments-refresh-text');          
			const refreshIcon = document.getElementById('moments-refresh-icon'); 

			// 2. 自动添加右上角刷新按钮
			function addManualRefreshButton() {
				const topBar = document.getElementById('moments-top');
				// 防止重复添加
				if (topBar && !document.getElementById('manual-refresh-btn')) {
					const btn = document.createElement('div');
					btn.id = 'manual-refresh-btn';
					btn.className = 'top-bar-btn';
					// 使用同步图标
					btn.innerHTML = '<i class="fas fa-sync-alt"></i>'; 
					btn.style.marginRight = '15px'; // 离相机按钮远一点
					btn.style.cursor = 'pointer';
					
					// 绑定点击事件
					btn.onclick = () => {
						triggerAiRefresh();
					};
					
					// 插入到相机按钮之前
					const cameraBtn = document.getElementById('post-moment-btn');
					if (cameraBtn) {
						topBar.insertBefore(btn, cameraBtn);
					} else {
						topBar.appendChild(btn);
					}
				}
			}

			// 3. 核心刷新逻辑
			function triggerAiRefresh() {
				if (isRefreshing) return; // 防止重复点击
				isRefreshing = true;

				// --- UI 变化开始 ---
				
				// 1. 让按钮旋转起来
				const btnIcon = document.querySelector('#manual-refresh-btn i');
				if(btnIcon) btnIcon.classList.add('fa-spin');

				// 2. 显示顶部的提示条 (作为状态栏使用)
				if (refreshLoader) {
					refreshLoader.style.height = '50px'; // 自动展开
					refreshLoader.style.transition = 'height 0.3s ease';
				}
				if (refreshText) refreshText.innerText = "AI 正在编造朋友圈...";
				if (refreshIcon) {
					refreshIcon.className = "fas fa-spinner fa-spin";
					refreshIcon.style.transform = "rotate(0deg)";
				}

				// --- 调用 AI 生成函数 ---
				if (typeof generateAiMomentsBatch === 'function') {
					generateAiMomentsBatch()
						.then(() => {
							// 成功后延迟一下再收起，让用户看到“成功”
							if(refreshText) refreshText.innerText = "获取成功！";
							if(refreshIcon) refreshIcon.className = "fas fa-check";
							setTimeout(finishRefresh, 800);
						})
						.catch(err => {
							console.error(err);
							alert("生成失败: " + err.message);
							finishRefresh();
						});
				} else {
					console.warn("generateAiMomentsBatch 函数未找到");
					setTimeout(finishRefresh, 1500);
				}
			}

			// 4. 结束刷新，复原 UI
			function finishRefresh() {
				isRefreshing = false;

				// 停止按钮旋转
				const btnIcon = document.querySelector('#manual-refresh-btn i');
				if(btnIcon) btnIcon.classList.remove('fa-spin');

				// 收起提示条
				if (refreshLoader) refreshLoader.style.height = '0px';
				
				// 复原提示文字 (为了下次显示)
				setTimeout(() => {
					if (refreshText) refreshText.innerText = "点击按钮刷新";
					if (refreshIcon) {
						refreshIcon.className = "fas fa-arrow-down";
						refreshIcon.classList.remove('fa-spin', 'fa-spinner');
					}
				}, 300);
			}

			// 初始化
			addManualRefreshButton();

			// 【重要】移除可能残留的旧拖拽事件 (暴力移除法)
			// 重新克隆节点可以清除所有旧的 eventListener
			const container = document.getElementById('moments-scroll-container');
			if (container) {
				const newContainer = container.cloneNode(true);
				container.parentNode.replaceChild(newContainer, container);
			}
			
			// 如果之前绑定在 moments-page 上，也处理一下
			const page = document.getElementById('moments-page');
			if (page) {
				// 注意：不能轻易 clone page，因为里面包含了 topBar 和 container
				// 既然我们不写 touchstart/mousedown 监听器，只要刷新一下网页，
				// 旧的内存里的监听器自然就没了。
			}

		})();
		
		
		//朋友圈生成逻辑
		// ============================================================
		// 【修改】批量生成朋友圈 (逻辑优化)
		// 1. 角色选择逻辑：<=4人全选，>4人随机3-4人
		// 2. 确保选中的人每人只发一条
		// ============================================================
		async function generateAiMomentsBatch() {
			// 1. 确定候选角色
			const allowedIds = momentsSettings.postableCharacterIds || [];
			let candidateChars = characters.filter(c => allowedIds.includes(c.id));

			// 如果没设置，或者没找到，就默认全部
			if (candidateChars.length === 0) candidateChars = characters;
			if (candidateChars.length === 0) return; // 无角色

			// 2. 【核心修改】角色筛选逻辑
			let selectedChars = [];
			
			if (candidateChars.length <= 4) {
				// 如果候选人数少于等于4人，全员入选，一人一条
				selectedChars = candidateChars;
			} else {
				// 如果候选人数超过4人，随机抽取 3 到 4 人
				const shuffled = [...candidateChars].sort(() => 0.5 - Math.random());
				const count = Math.floor(Math.random() * 2) + 3; // 随机 3 或 4
				selectedChars = shuffled.slice(0, count);
			}
			
			console.log(`[Moments] 选定发布角色: ${selectedChars.map(c => c.name).join(', ')}`);

			// 3. 串行生成 (避免并发导致API限流或卡顿)
			for (const char of selectedChars) {
				await generateSingleCharacterMoment(char);
			}
			
			// 4. 生成完毕后，再次执行裁切，确保不超过上限
			const limit = (momentsSettings && momentsSettings.memoryLimit) ? parseInt(momentsSettings.memoryLimit) : 10;
			if (socialMoments.length > limit) {
				socialMoments = socialMoments.slice(0, limit);
				saveMomentsToLocal();
				renderMomentsFeed(); // 刷新UI
			}
		}

		// ============================================================
		// 【修改】生成单条朋友圈 (Prompt 优化)
		// 1. 明确旧内容是“避重”参考
		// ============================================================
		async function generateSingleCharacterMoment(char) {
			// --- A. 准备上下文数据 ---
			
			// 1. 基础信息
			const charName = char.name;
			const persona = char.persona || "无设定";
			
			// 【修复】智能读取私聊预设面具
			let userName = userInfo.name;
			let userMask = userInfo.mask || "无特定身份";

			if (char.userMaskId) {
				const boundMask = userMasks.find(m => m.id === char.userMaskId);
				if (boundMask) {
					if (boundMask.name) userName = boundMask.name;
					if (boundMask.mask) userMask = boundMask.mask;
				}
			} else {
				// 兼容旧版设定
				if (char.userName && char.userName.trim()) userName = char.userName.trim();
				if (char.userMask && char.userMask.trim()) userMask = char.userMask.trim();
			}

			// 3. 记忆
			const limitChat = 10;
			const recentChat = (char.chatHistory || []).slice(-limitChat).map(m => {
				const role = m.type === 'sent' ? userName : charName;
				return `${role}: ${m.text}`;
			}).join('\n');
			
			const longTermMem = (char.longTermMemories || []).join('\n');
			const lifeEvents = (char.lifeEvents || []).map(e => `${e.date}: ${e.event}`).join('\n');
			// 【修复3】加载世界书上下文
			const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);
			
			// 【新增：加载天气上下文】
			let weatherContext = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(char.id) : "";
			//加载日程
			let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(char.id) : ""; // <--- 获取角色日程
			// 【新增】筛选出与当前发帖者身处同一面具圈层的所有角色 ID
			const postSourceId = char.userMaskId || 'global';
			const sameMaskCharIds = characters
				.filter(c => c.type !== 'group' && (c.userMaskId || 'global') === postSourceId)
				.map(c => c.id);
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(sameMaskCharIds) : "";
			// 4. 【核心修改】获取该角色过去发过的朋友圈 (用于去重)
			const historyMoments = socialMoments
				.filter(p => p.authorName === charName) // 只看该角色发过的
				.slice(0, 5) // 取最近5条
				.map(p => `[${getSmartTime(p.timestamp)}] 内容: ${p.content}`)
				.join('\n');
			
			// 5. 生成完毕后
			const limit = (momentsSettings && momentsSettings.memoryLimit) ? parseInt(momentsSettings.memoryLimit) : 10;
			if (socialMoments.length > limit) {
				socialMoments = socialMoments.slice(0, limit);
				saveMomentsToLocal();
				renderMomentsFeed();
			}
			
			// 【新增】如果用户当前不在朋友圈页面，标记未读
			const currentPage = document.querySelector('.page.active');
			if (currentPage && currentPage.id !== 'moments-page') {
				setMomentsUnread(true);
			}
			// 【新增】获取所有的群聊名称，防止 AI 误将群名当作 NPC 名字
			const allGroupNames = characters.filter(c => c.type === 'group').map(g => g.name);
			const forbiddenNpcPrompt = allGroupNames.length > 0 
				? `\n\t\t\t7. **绝对严禁**使用以下群聊的名称作为NPC的名字：${allGroupNames.map(n => `"${n}"`).join('、')}。` 
				: "";
			// --- B. 构建 Prompt (优化指令) ---
			const systemPrompt = `
			 ${wbBefore}
			你现在正在扮演角色 "${charName}" 发布一条朋友圈动态。
			
			【角色设定】
			${persona}
			【当前世界观背景、人际关系和知识储备】:   
			【世界观设定】: ${wbAfter}
			${weatherContext}${theirDayContext}
			【你与用户(${userName})的背景】
			用户面具: ${userMask}
			长期记忆: ${longTermMem}
			人生档案: ${lifeEvents}
			最近聊天: 
			${recentChat}

			【你最近发布过的朋友圈 (请避免重复类似内容)】
			${historyMoments || "暂无历史记录"}

			【任务要求】
			1. 请结合你的人设和当前状态，写一条**新**的朋友圈。
			2. **核心指令**：参考【最近发布过的朋友圈】，**严禁**发布与最近几条主题、内容、心情雷同的动态。请寻找新的生活切入点或话题。${fortuneContext}
			3. 内容要生活化，符合你的性格，不要像写日记，要像发社交动态。
			4. (可选) 如果需要配图，请生成 0-3 个虚拟图片描述。
			5. (重要) 请编造 2-4 个符合你社交圈的 NPC (路人/朋友/同事) 对这条朋友圈进行点赞或评论。
			6. **严禁**使用 "${userName}" 进行点赞或评论。${forbiddenNpcPrompt}
			
			【输出格式】
			必须严格输出为 JSON 格式，不要包含Markdown代码块标记：
			{
				"content": "朋友圈正文内容",
				"images": ["虚拟图片描述1", "虚拟图片描述2"], 
				"likes": ["NPC名字1", "NPC名字2"],
				"comments": [
					{"user": "NPC名字1", "content": "评论内容"},
					{"user": "NPC名字2", "content": "评论内容"}
				]
			}
			`;

			// --- C. 调用 API ---
			const useSettings = (socialApiSettings && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;
			
			try {
				const responseText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请生成你的新朋友圈动态。" }
				], useSettings);

				// --- D. 解析 JSON ---
				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const data = JSON.parse(jsonMatch[0]);
					
					// 构建新动态
					const newPost = {
						id: 'gen_' + Date.now() + Math.random().toString(36).substr(2,5),
						authorName: charName,
						authorAvatar: char.avatar,
						content: data.content,
						images: (data.images || []).map(desc => `virtual_text::${desc}`),
						timestamp: Date.now(),
						likes: data.likes || [],
						comments: data.comments || []
					};

					// 存入开头
					socialMoments.unshift(newPost);
					
					// 这里暂不保存，等待 batch 结束后统一保存和裁切，或者单独保存也可以
					// 为了安全起见，这里保存一下
					saveMomentsToLocal();
					renderMomentsFeed()
				}

			} catch (e) {
				console.error(`角色 ${charName} 生成朋友圈失败:`, e);
			}
		}
		// ============================================================
		// 【修复】朋友圈回复主逻辑 (修复提示词主语问题，补全天气等全量世界状态)
		// ============================================================
		async function triggerAiReplyToMomentComment(post, char, userName, userContent, replyToUser) {
			// --- 1. UI 动画初始化 ---
			const refreshLoader = document.getElementById('moments-refresh-loader');
			const refreshText = document.getElementById('moments-refresh-text');
			const refreshIcon = document.getElementById('moments-refresh-icon');
			const manualBtnIcon = document.querySelector('#manual-refresh-btn i');

			// 启动动画
			if (refreshLoader) {
				refreshLoader.style.height = '50px';
				refreshLoader.style.transition = 'height 0.3s ease';
			}
			if (refreshText) refreshText.innerText = `${char.name} 正在回复...`;
			if (refreshIcon) refreshIcon.className = "fas fa-spinner fa-spin";
			if (manualBtnIcon) manualBtnIcon.classList.add('fa-spin');

			// --- 2. 准备数据 ---
			const charName = char.name;
			const persona = char.persona || "无设定";
			
			// 【核心修复】提供给 AI 的用户设定
			let userMaskDesc = userInfo.mask || "无设定";
			if (char.userMaskId) {
				const boundMask = userMasks.find(m => m.id === char.userMaskId);
				if (boundMask && boundMask.mask) userMaskDesc = boundMask.mask;
			} else if (char.userMask) {
				userMaskDesc = char.userMask;
			}

			const longTermMem = (char.longTermMemories ||[]).join('\n');
			const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);
            
			let weatherContext = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(char.id) : "";
			let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(char.id) : ""; // <--- 获取角色日程
			// 【新增】筛选出与当前发帖者身处同一面具圈层的所有角色 ID
			const postSourceId = char.userMaskId || 'global';
			const sameMaskCharIds = characters
				.filter(c => c.type !== 'group' && (c.userMaskId || 'global') === postSourceId)
				.map(c => c.id);
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(sameMaskCharIds) : "";
			
			const ltm = (char.longTermMemories ||[]).join('; ');
			const lifeEvents = (char.lifeEvents ||[]).map(e => e.event).join('; ');
			const gifts = (char.giftList ||[]).map(g => g.name).join(',');
			const recentChat = (char.chatHistory ||[])
				.slice(-15)
				.map(m => {
					if (m.isHidden || m.isSystemMsg) return "";
					const role = m.type === 'sent' ? userName : char.name;
					return `${role}: ${m.text}`;
				})
				.filter(Boolean)
				.join('\n');
			
			let promptImagesDesc = "";
			if (post.imageDescriptions && post.imageDescriptions.length > 0) {
				promptImagesDesc = post.imageDescriptions.join(', ');
			} else {
				promptImagesDesc = (post.images ||[]).map(img => img.startsWith('virtual_text::') ? img.replace('virtual_text::', '') : '[图片]').join(', ');
			}
			
			const postContext = `
			【朋友圈原文】
			发布者: ${post.authorName}
			正文: ${post.content}
			图片描述: ${promptImagesDesc || '无'}
			`;

			// 【核心修复】提示词主语关系，防止 AI 把你的帖子认成自己的
			let situationDesc = "";
			if (post.authorName === charName) {
				situationDesc = `你在朋友圈发了一条动态，用户 "${userName}" 刚刚对你进行了评论/回复。你需要自然地回复对方。`;
			} else if (post.authorName === userName) {
				situationDesc = `用户 "${userName}" 发了一条动态，你在下面留了言，现在对方回复了你。你需要继续和对方互动。`;
			} else {
				situationDesc = `你们的共同好友 "${post.authorName}" 发了一条动态，用户 "${userName}" 刚刚在评论区回复了你。你需要继续和对方互动。`;
			}

			const systemPrompt = `
			${wbBefore}
			你扮演角色 "${charName}"。
			${situationDesc}
			
			【角色设定】: ${persona}
			【角色对应世界观背景】:  ${wbAfter || '无特定限制'}
			【天气环境】: ${weatherContext || '无'}
			【日程安排】${theirDayContext}
			【当日运势】 ${fortuneContext}
			【用户设定(${userName})】: ${userMaskDesc}
			【你们的关系与记忆参考】
			- 长期记忆：${ltm || '暂无'}
			- 人生档案：${lifeEvents || '暂无'}
			- 送出/收到过的礼物：${gifts || '无'}
			- 近期私聊记录：
			  ${recentChat || '暂无聊天记录'}
			
			${postContext}

			【当前互动情况】
			用户("${userName}")刚刚说: "${userContent}"
			(如果为回复) 用户回复的具体对象是: ${replyToUser || "直接评论帖子"}

			【任务】
			请生成一条简短自然的回复内容。不要带引号，直接输出纯文本内容。
			语气要符合你的人设和你们的关系状态。
			`;

			const useSettings = (socialApiSettings && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;

			try {
				// --- 3. 调用 API ---
				const replyText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请生成你的回复内容。" }
				], useSettings);

				if (replyText) {
					// 存入评论
					if (!post.comments) post.comments =[];
					post.comments.push({
						user: charName,
						content: replyText.replace(/^["']|["']$/g, '').trim(),
						replyTo: userName
					});
					saveMomentsToLocal();
					renderMomentsFeed();
					
					// 【新增】如果用户当前不在朋友圈页面，标记未读
					const currentPage = document.querySelector('.page.active');
					if (currentPage && currentPage.id !== 'moments-page') {
						setMomentsUnread(true);
					}

					// --- 4. UI 成功状态 ---
					if (refreshText) refreshText.innerText = "回复成功";
					if (refreshIcon) refreshIcon.className = "fas fa-check";
					setTimeout(stopLoadingAnimation, 1000);
				}
			} catch (e) {
				console.error("AI 回复评论失败:", e);
				// --- 5. UI 失败状态 ---
				if (refreshText) refreshText.innerText = "回复失败";
				setTimeout(stopLoadingAnimation, 1000);
			}

			// --- 辅助：停止动画 ---
			function stopLoadingAnimation() {
				if (refreshLoader) refreshLoader.style.height = '0px';
				if (manualBtnIcon) manualBtnIcon.classList.remove('fa-spin');
				
				// 复原图标状态
				setTimeout(() => {
					if (refreshText) refreshText.innerText = "点击按钮刷新";
					if (refreshIcon) {
						refreshIcon.className = "fas fa-arrow-down";
						refreshIcon.classList.remove('fa-spin', 'fa-spinner');
					}
				}, 300);
			}
		}
		// ============================================================
		// 【完整版】朋友圈自动互动逻辑 (带加载动画 + 身份过滤)
		// ============================================================

		// --- 函数 1：批量生成互动 (总指挥) ---
		async function generateReactionsToUserPost(userPost) {
			// 1. 获取 DOM 元素 (加载条相关)
			const refreshLoader = document.getElementById('moments-refresh-loader');
			const refreshText = document.getElementById('moments-refresh-text');
			const refreshIcon = document.getElementById('moments-refresh-icon');
			const manualBtnIcon = document.querySelector('#manual-refresh-btn i');

			// 2. 启动动画
			if (refreshLoader) {
				refreshLoader.style.height = '50px'; // 展开
				refreshLoader.style.transition = 'height 0.3s ease';
			}
			if (refreshText) refreshText.innerText = "AI 正在查看你的动态...";
			if (refreshIcon) {
				refreshIcon.className = "fas fa-spinner fa-spin"; // 旋转图标
			}
			if (manualBtnIcon) manualBtnIcon.classList.add('fa-spin'); // 左上角按钮也旋转

			try {
				// A. 获取朋友圈设置中允许的角色列表
				const allowedIds = momentsSettings.postableCharacterIds || [];
				
				// B. 初步筛选：只看设置里允许的角色
				let candidateChars = characters.filter(c => {
					if (allowedIds.length > 0) return allowedIds.includes(c.id);
					return true;
				});

				// ============================================================
				// C. 【完美打通】严格的面具身份匹配
				// ============================================================
				const postSourceId = userPost.sourceId || 'global'; 

				candidateChars = candidateChars.filter(c => {
					if (postSourceId === 'global') {
						// 用户发的是全局朋友圈 -> 只有绑定了“全局默认”的角色能看见
						return !c.userMaskId || c.userMaskId === ''; 
					} else {
						// 用户使用的是特定马甲(Mask ID)发的朋友圈 -> 只有绑定了同一个 Mask ID 的角色能看见！
						return c.userMaskId === postSourceId;
					}
				});

				// 如果没有匹配的角色
				if (candidateChars.length === 0) {
					if (refreshText) refreshText.innerText = "暂无匹配角色互动";
					setTimeout(stopLoadingAnimation, 1500);
					return;
				}

				// D. 随机选 2-4 个角色
				const shuffled = [...candidateChars].sort(() => 0.5 - Math.random());
				const count = Math.min(Math.max(2, Math.floor(Math.random() * 3) + 2), shuffled.length);
				const selectedChars = shuffled.slice(0, count);

				console.log(`[Moments] 触发互动，选中: ${selectedChars.map(c => c.name).join(', ')}`);

				// E. 遍历生成互动
				for (let i = 0; i < selectedChars.length; i++) {
					const char = selectedChars[i];
					
					// 更新提示文字
					if (refreshText) refreshText.innerText = `${char.name} 正在输入... (${i + 1}/${selectedChars.length})`;
					
					// 随机延迟
					await new Promise(r => setTimeout(r, 800 + Math.random() * 1000));
					
					// 执行生成
					await generateSingleReaction(char, userPost);
				}

				// F. 全部完成
				if (refreshText) refreshText.innerText = "互动更新完毕";
				if (refreshIcon) refreshIcon.className = "fas fa-check";
				
				// 延迟收起
				setTimeout(stopLoadingAnimation, 1000);
				
				// 【新增】如果用户当前不在朋友圈页面，标记未读
				const currentPage = document.querySelector('.page.active');
				if (currentPage && currentPage.id !== 'moments-page') {
					setMomentsUnread(true);
				}

			} catch (error) {
				console.error("互动生成出错:", error);
				if (refreshText) refreshText.innerText = "生成出错";
				setTimeout(stopLoadingAnimation, 1000);
			}

			// 辅助函数：停止动画
			function stopLoadingAnimation() {
				if (refreshLoader) refreshLoader.style.height = '0px';
				if (manualBtnIcon) manualBtnIcon.classList.remove('fa-spin');
				
				// 复原图标状态
				setTimeout(() => {
					if (refreshText) refreshText.innerText = "点击按钮刷新";
					if (refreshIcon) {
						refreshIcon.className = "fas fa-arrow-down";
						refreshIcon.classList.remove('fa-spin', 'fa-spinner');
					}
				}, 300);
			}
		}

		// --- 函数 2：生成单个角色的互动 (干活的士兵 - 增加 NPC 脑补机制) ---
		async function generateSingleReaction(char, userPost) {
			const charName = char.name;
			
			// 【核心修复】获取该 AI 视角下，用户的正确名字和面具
			let targetUserName = userInfo.name;
			let userMaskDesc = userInfo.mask || "无设定";

			if (char.userMaskId) {
				const boundMask = userMasks.find(m => m.id === char.userMaskId);
				if (boundMask) {
					if (boundMask.name) targetUserName = boundMask.name;
					if (boundMask.mask) userMaskDesc = boundMask.mask;
				}
			} else if (char.userName && char.userName.trim()) {
				targetUserName = char.userName.trim();
				if (char.userMask) userMaskDesc = char.userMask;
			}
			const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);
			const ltm = (char.longTermMemories ||[]).join('; ');
			const lifeEvents = (char.lifeEvents ||[]).map(e => e.event).join('; ');
			const gifts = (char.giftList ||[]).map(g => g.name).join(',');
			const recentChat = (char.chatHistory ||[])
				.slice(-15)
				.map(m => {
					if (m.isHidden || m.isSystemMsg) return "";
					const role = m.type === 'sent' ? targetUserName : char.name;
					return `${role}: ${m.text}`;
				})
				.filter(Boolean)
				.join('\n');
				
			// 拦截 base64 污染 Prompt
			let promptImagesDesc = "";
			if (userPost.imageDescriptions && userPost.imageDescriptions.length > 0) {
				promptImagesDesc = userPost.imageDescriptions.join(', ');
			} else {
				promptImagesDesc = (userPost.images ||[]).map(img => img.startsWith('virtual_text::') ? img.replace('virtual_text::', '') : '[图片]').join(', ');
			}
			// 【新增】筛选出与当前发帖者身处同一面具圈层的所有角色 ID
			const postSourceId = char.userMaskId || 'global';
			const sameMaskCharIds = characters
				.filter(c => c.type !== 'group' && (c.userMaskId || 'global') === postSourceId)
				.map(c => c.id);
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(sameMaskCharIds) : "";
			// 【新增】获取所有的群聊名称，防止 AI 误将群名当作 NPC 名字
			const allGroupNames = characters.filter(c => c.type === 'group').map(g => g.name);
			const forbiddenNpcPrompt = allGroupNames.length > 0 
				? `\n\t\t\t4. **绝对严禁**使用以下群聊的名称作为NPC的名字：${allGroupNames.map(n => `"${n}"`).join('、')}。` 
				: "";
			const systemPrompt = `${wbBefore}
			你扮演角色 "${charName}"。你的好友 "${targetUserName}" 发了一条朋友圈。
			
			【用户设定】: ${userMaskDesc}
			【角色设定】: ${char.persona}
			【世界观背景】: ${wbAfter}
			【各角色当日运势参考】: ${fortuneContext}
			【记忆参考】
			- 长期记忆：${ltm || '暂无'}
			- 人生档案：${lifeEvents || '暂无'}
			- 近期聊天：${recentChat || '暂无聊天记录'}

			【用户朋友圈内容】
			"${userPost.content}"
			(图片: ${promptImagesDesc || '无'})

			【任务】
			1. 决定你(角色本人)是否给这条朋友圈点赞，并决定是否评论。
			2. 脑补并虚构 0~3 个可能的共同好友(NPC)为这条朋友圈点赞。
			3. 脑补并虚构 0~2 个可能的共同好友(NPC)在下面发表评论。
			4.${forbiddenNpcPrompt}
			
			【输出格式 JSON】
			{
				"like": true,
				"comment": "你的评论内容，不评论留空",
				"npc_likes": ["同事小王", "路人甲"],
				"npc_comments": [
					{"user": "同事小王", "content": "原来你今天去这玩了！"}
				]
			}
			`;

			const useSettings = (socialApiSettings && socialApiSettings.apiKey) ? socialApiSettings : chatApiSettings;

			try {
				const responseText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请根据以上信息，生成JSON格式的互动反馈。" }
				], useSettings);

				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const data = JSON.parse(jsonMatch[0]);
					
					if (!userPost.likes) userPost.likes =[];
					if (!userPost.comments) userPost.comments =[];

					// 1. 处理角色本人的点赞
					if (data.like && !userPost.likes.includes(charName)) {
						userPost.likes.push(charName);
					}

					// 2. 处理角色本人的评论
					if (data.comment && data.comment.trim() !== "") {
						userPost.comments.push({
							user: charName,
							content: data.comment.trim()
						});
					}

					// 3. 处理虚构的 NPC 点赞
					if (data.npc_likes && Array.isArray(data.npc_likes)) {
						data.npc_likes.forEach(npc => {
							if (npc && !userPost.likes.includes(npc) && npc !== targetUserName) {
								userPost.likes.push(npc);
							}
						});
					}

					// 4. 处理虚构的 NPC 评论
					if (data.npc_comments && Array.isArray(data.npc_comments)) {
						data.npc_comments.forEach(c => {
							if (c.user && c.content && c.user !== targetUserName) {
								userPost.comments.push({
									user: c.user,
									content: c.content.trim()
								});
							}
						});
					}

					// 保存并刷新
					saveMomentsToLocal();
					renderMomentsFeed();
				}
			} catch (e) {
				console.error(`生成互动失败 (${charName}):`, e);
			}
		}
		
		// ============================================================
		// 【修复】朋友圈设置页返回按钮逻辑
		// 修复返回后顶部被遮挡的问题
		// ============================================================
		if (momentsSettingBackBtn) {
			momentsSettingBackBtn.addEventListener('click', () => {
				// 1. 切换回朋友圈主页
				switchPage('moments-page');
				switchTopBar('moments-top');
				
				// 2. 重新渲染内容（确保数据最新）
				renderMomentsFeed();
				renderMomentsHeader(); // 刷新头部（万一改了封面/头像）

				// 3. 【核心修复】强制将内容区域顶到最上面
				// 因为朋友圈页面的 Header 是透明悬浮的，内容需要从 top:0 开始
				const contentArea = document.getElementById('main-content-area');
				if (contentArea) {
					contentArea.style.top = '0'; 
				}
			});
		}
		
		// ============================================================
		// 【紧急修复】导航跳转逻辑补丁 (万能点击版)
		// ============================================================

		document.body.addEventListener('click', function(e) {
			// --------------------------------------------------------
			// 1. 监听【个性化设置】入口按钮点击
			// --------------------------------------------------------
			const entryBtn = e.target.closest('#custom-style-btn');
			if (entryBtn) {
				// 防止默认行为干扰
				e.preventDefault(); 
				
				console.log("正在进入个性化设置页面...");

				// A. 尝试回显数据 (调用之前定义的函数)
				if (typeof fillInputsFromMemory === 'function') {
					fillInputsFromMemory();
				}

				// B. 切换页面内容
				// 如果你有全局的 switchPage 函数，优先使用它
				if (typeof switchPage === 'function') {
					switchPage('custom-style-page');
				} else {
					// 兜底方案：手动切换 class
					document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
					const targetPage = document.getElementById('custom-style-page');
					if (targetPage) targetPage.classList.add('active');
				}
				
				// C. 切换顶部栏 (Top Bar)
				// 先隐藏所有顶部栏
				document.querySelectorAll('.top-bar').forEach(b => b.style.display = 'none');
				// 再显示个性化页面的顶部栏
				const customTop = document.getElementById('custom-style-top');
				if (customTop) {
					customTop.style.display = 'flex';
				} else {
					console.error("未找到 id='custom-style-top' 的顶部栏元素，请检查 HTML");
				}
			}

			// --------------------------------------------------------
			// 2. 监听【个性化设置】页面的左上角返回按钮
			// --------------------------------------------------------
			// 查找位于 custom-style-top 里面的 .top-bar-back
			const backBtn = e.target.closest('#custom-style-top .top-bar-back');
			if (backBtn) {
				e.preventDefault();
				
				// A. 返回设置页
				if (typeof switchPage === 'function') {
					switchPage('setting-page');
				} else {
					document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
					document.getElementById('setting-page').classList.add('active');
				}
				
				// B. 恢复设置页顶部栏
				document.getElementById('custom-style-top').style.display = 'none';
				const settingTop = document.getElementById('setting-top');
				if (settingTop) {
					settingTop.style.display = 'flex';
				}
			}
		});
		// ============================================================
		// 【功能补全版】自定义美化管理器
		// ============================================================

		// ============================================================
		// 【功能补全版】自定义美化管理器 (已修复语法错误)
		// ============================================================

		const StyleManager = {
			settings: { globalBg: '', globalCss: '', bubbleCss: '', zoom: 100, fontUrl: '' },
			draft: {},
			presets:[
				{ 
					name: "暗黑模式", 
					data: { 
						globalBg: '', 
						globalCss: `
/* ============================================================ */
/* 【全局暗黑基础 - 使用伪元素避开聊天背景】 */
/* ============================================================ */
body, html { background-color: #111111 !important; color: #e0e0e0; }

/* 给页面容器设置相对定位，但不锁死聊天页 */
.page:not(#chat-detail-page) {
    position: relative;
    background-color: transparent !important; 
    z-index: 1; 
}

/* 使用 ::before 创建深色背景层，完美避开聊天页 */
.page:not(#chat-detail-page)::before {
    content: '';
    position: fixed; 
    top: 0;
    left: 0;
    width: 100vw; 
    height: 100vh; 
    background-color: #111111 !important; /* 暗黑底色 */
    z-index: -1; 
    will-change: transform; 
}

/* 确保外层容器也是透明的，让背景透出来 */
.content-area, .page-content {
    background-color: transparent !important;
    color: #e0e0e0;
}

/* 聊天页特别处理，保留透明度防止遮挡壁纸 (强制穿透级别) */
#chat-detail-page, 
#chat-detail-page .page-content,
#chat-message-container { 
    background: transparent !important; 
    background-color: transparent !important; 
}

/* ==================================== */
/* 【核心修复：文字颜色大清洗】 */
/* ==================================== */

/* 1. 基础标题、各种名字强制变白 */
h1, h2, h3, h4, h5, h6, 
.form-label, .api-setting-label, .menu-btn-text, .setting-btn-text, 
.user-name, .chat-name, .top-bar-title, .top-bar-main-title,
.d-char-name, .wb-card-title, .group-title, 
.file-name-text, .gift-list-name, .forum-at-name, .pp-name, 
.delivery-title, .shop-card-title, .search-result-name { 
    color: #e0e0e0 !important; 
}

/* ★ 论坛标题强制纯白护航 */
.fpc-title, .fd-title { color: #ffffff !important; font-weight: bold !important; }

/* 2. 状态、时间、副标题强制变亮灰 (防止看不清) */
.user-status, .chat-last-msg, .chat-time, 
.d-char-desc, .fd-author-time, .fpc-time, .fri-time, 
.gift-list-desc, .shop-card-desc, .file-size-text, .pp-mask { 
    color: #aaaaaa !important; 
}

/* 3. 论坛与朋友圈的微信蓝昵称提亮 (防止原本的深蓝色融入黑底) */
.post-author, .moment-user-blue, .fri-name, .moment-likes, .moment-likes i { 
    color: #8299c2 !important; 
}

/* 4. 核弹级反转：只要代码里内联写了深色字的，全部强行漂白！ */
[style*="color: #333"],[style*="color:#333"],[style*="color: #444"],[style*="color:#444"],[style*="color: #555"],[style*="color:#555"],[style*="color: rgb(51, 51, 51)"],[style*="color: rgb(68, 68, 68)"],[style*="color: rgb(85, 85, 85)"] {
    color: #e0e0e0 !important;
}

.top-bar, .bottom-nav { background-color: #191919 !important; border-color: #2a2a2a !important; }
.nav-item { color: #888; }

/* ==================================== */
/* 修复：各种卡片、按钮、头像容器彻底变黑 */
/* ==================================== */
.chat-card, .user-info-card, .menu-btn, .setting-btn, .user-info-edit-btn,
.form-section.character-info-card, .switch-container,
.api-preset-bar, .gift-list-item, .fav-card, 
.search-bar-container, .search-result-item, .wb-card, .emoticon-card,
.moment-virtual-card, .diary-char-card, .diary-box, .transaction-item,
.shopping-tabs, .shopping-control-panel, .forum-post-card, .forum-detail-main, .forum-reply-item,
.character-avatar-uploader, .avatar-preview, .user-avatar, .d-char-avatar, .fav-avatar, .search-result-avatar, .msg-avatar {
    background-color: #191919 !important;
    border-color: #2a2a2a !important;
    color: #e0e0e0 !important;
}

/* ==================================== */
/* 强制核弹级拦截：所有内联白色的元素背景 (兼容 rgb 格式) */
/* ==================================== */
[style*="background: #fff"],[style*="background:#fff"],[style*="background-color: #fff"],[style*="background-color:#fff"],
[style*="background: #fdfdfd"],[style*="background: #f9f9f9"],[style*="background-color: #f8f8f8"],[style*="background: #f8f8f8"],
[style*="background-color: #f7f7f7"],[style*="background: #f7f7f7"],[style*="background-color: #f5f5f5"],[style*="background: #f5f5f5"],[style*="rgb(255, 255, 255)"],[style*="rgb(249, 249, 249)"],[style*="rgb(253, 253, 253)"], [style*="rgb(245, 245, 245)"] {
    background-color: #191919 !important;
    border-color: #333 !important;
    color: #e0e0e0 !important;
}

/* ==================================== */
/* 表单、容器与按钮暗色化 */
/* ==================================== */
input, textarea, select, .form-input, .form-textarea, .forum-bar-input, .form-select, .name-input, .mask-input, .api-setting-input, .center-modal-input, #setting-character-bg-url, .code-input, .chat-bar-input { 
    background-color: #2c2c2c !important; border-color: #444 !important; color: #fff !important; 
}

/* 覆盖特定的卡片、开关、各种设置项 */
.scroll-select-box, 
.ltm-item textarea,
.ltm-counter,
.ltm-action-btn,
.gift-status-input {
    background-color: #191919 !important; 
    border-color: #333 !important; 
    color: #e0e0e0 !important; 
}

/* ★ 修复下拉框内的分组标题(专门拦截 rgb 格式) */
.scroll-select-box > div {
    background-color: #222222 !important; 
    color: #aaaaaa !important; 
    border-top: 1px solid #333 !important;
}

/* 多选框及列表 */
.checkbox-item { border-bottom-color: #2a2a2a !important; }
.checkbox-item span { color: #e0e0e0 !important; } /* 世界书/角色复选框文字白化 */
.custom-check-circle { background-color: #2c2c2c !important; border-color: #555 !important; }

/* 按钮专属修正 */
.batch-btn, .add-event-btn, .shop-buy-btn { background-color: #2c2c2c !important; color: #e0e0e0 !important; border-color: #444 !important; }
.batch-btn.batch-delete { color: #ff3b30 !important; }

/* 针对带有内联蓝边的导出角色按钮，单独提权黑化 */
#setting-export-character-btn { background-color: #1a2a3a !important; border-color: #1565c0 !important; color: #409eff !important; }

/* 聊天框基础样式 */
.chat-input-bar { background-color: #191919 !important; border-top: 1px solid #2a2a2a !important; }
.chat-msg-row.left .msg-bubble { background-color: #2c2c2c !important; border: 1px solid #333 !important; color: #e0e0e0 !important; }
.chat-msg-row.right .msg-bubble { background-color: #2ba245 !important; border-color: #2ba245 !important; color: #fff !important; }
.msg-quote-card { background-color: rgba(255, 255, 255, 0.08) !important; color: #aaa !important; }
.chat-msg-row.right .msg-quote-card { background-color: rgba(0, 0, 0, 0.2) !important; color: #ddd !important; }

/* 弹窗与菜单 */
.upload-modal-content, .center-modal-content, .chat-menu-dropdown, .function-panel-content, .emoticon-picker-content { background-color: #252525 !important; color: #e0e0e0 !important; border-color: #333 !important; }
.chat-menu-item { color: #e0e0e0; border-bottom-color: #333 !important; }
.chat-menu-item:hover { background-color: #333 !important; }

/* 修复图片气泡透明 */
.chat-msg-row.left .msg-bubble.image-bubble, .chat-msg-row.right .msg-bubble.image-bubble, .chat-msg-row.left .msg-bubble.is-image, .chat-msg-row.right .msg-bubble.is-image { background-color: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
.msg-image-content { background-color: transparent !important; }

/* ==================================== */
/* ★ 订单卡片 / 转账卡片下半截强制变黑 */
/* ==================================== */
.payment-footer { background-color: #222222 !important; color: #aaaaaa !important; border-top: 1px solid #333 !important; }
.msg-bubble.is-order-card > div { background-color: #222222 !important; border: 1px solid #444 !important; }
.msg-bubble.is-order-card > div > div:first-child { border-bottom-color: #444 !important; }
.msg-bubble.is-order-card > div > div:last-child { background-color: #111111 !important; color: #ff4d4f !important; }

/* ==================================== */
/* ★ 外卖悬浮窗彻底变黑 */
/* ==================================== */
.delivery-card { background-color: rgba(30, 30, 30, 0.95) !important; border: 1px solid #444 !important; }
.delivery-card .delivery-title { color: #ffffff !important; }

/* ==================================== */
/* ★ 购物商城页面适配 */
/* ==================================== */
.shop-card { background-color: #222222 !important; border: 1px solid #444 !important; }
.shop-card-img { background-color: #111111 !important; color: #999999 !important; }
.shop-card-comments { background-color: #1a1a1a !important; color: #ccc !important; }

/* ==================================== */
/* 1. 朋友圈 (Moments) */
/* ==================================== */
.moment-post { background-color: #111 !important; border-bottom: 1px solid #2a2a2a !important; }
.post-content { color: #e0e0e0 !important; }
.moment-interactions { background-color: #1e1e1e !important; } /* 稍微提亮一点背景区分层次 */
.moment-interactions::before { border-bottom-color: #1e1e1e !important; }
.moment-likes { border-bottom: 1px solid #333 !important; color: #8299c2 !important; } /* 线条改成深灰，不再刺眼 */
.moment-comment-content { color: #ffffff !important; } 
.moment-comment-item { color: #cccccc !important; } 
.post-action-btn { background-color: #2c2c2c !important; color: #999 !important; border: 1px solid #444 !important; } 
#moments-comment-modal .upload-modal-content { background-color: #191919 !important; }
#moments-comment-modal select, #moments-like-modal select { background-color: #2c2c2c !important; color: #e0e0e0 !important; border-color: #444 !important; }

/* ==================================== */
/* 4. 论坛 (Forum) */
/* ==================================== */
.forum-tabs-wrapper { background-color: #191919 !important; border-color: #2a2a2a !important; }
.forum-tab { color: #888 !important; }
.forum-tab.active { color: #07c160 !important; }
.forum-board-action-bar { background-color: #191919 !important; border-color: #2a2a2a !important; }
.forum-reply-header { background-color: #111 !important; color: #999 !important; border-color: #2a2a2a !important; }
.forum-input-bar { background-color: #191919 !important; border-top: 1px solid #2a2a2a !important; }
.fpc-content-preview, .fd-content { color: #aaa !important; }
.fri-content { color: #e0e0e0 !important; }

/* ==================================== */
/* 5. 手账日记 & 人生档案 & Ta的一天 */
/* ==================================== */
#diary-detail-page .page-content, #their-day-detail-page .page-content { background-color: transparent !important; } /* 交给伪元素处理 */
.diary-wrapper { background-color: #191919 !important; }
.diary-header { color: #e0e0e0 !important; }
.diary-box { background-color: #2c2c2c !important; border-color: #333 !important; }
.diary-box-title { color: #888 !important; }
.diary-box-content { color: #e0e0e0 !important; }
.timeline-time { background-color: #2c2c2c !important; color: #e0e0e0 !important; border-color: #444 !important; }
.timeline-content { background-color: #2c2c2c !important; border-color: #333 !important; color: #ccc !important; }
.diary-dots-line { opacity: 0.3; }

/* Ta的一天 页面暗黑适配 */
#their-day-detail-page .page-content > div[style*="background: #fff"],
#their-day-schedule-container { 
    background-color: #191919 !important; 
    border: 1px solid #2a2a2a !important; 
    color: #e0e0e0 !important; 
    box-shadow: none !important;
}
#their-day-detail-page .page-content > div[style*="background: #fff"] > div:first-child > div:first-child {
    color: #e0e0e0 !important;
}

/* ★ 人生档案修复：容器背景与字体 */
.life-event-item { background-color: #222222 !important; border: 1px solid #444 !important; }
.life-event-item .date { background-color: #111111 !important; color: #aaaaaa !important; }
.life-event-item textarea { color: #ffffff !important; background-color: transparent !important; }
.life-event-item textarea:focus { background-color: #333333 !important; }

/* ==================================== */
/* 6. 经期记录 (Period Tracking) */
/* ==================================== */
#period-tracking-page .page-content { background-color: transparent !important; }
#period-tracking-page .page-content > div[style*="background: #fff"], 
#period-tracking-page .page-content > div[style*="background:#fff"] { 
    background-color: #191919 !important; 
    box-shadow: none !important; 
    border: 1px solid #2a2a2a !important; 
    color: #e0e0e0 !important; 
}
#period-tracking-page .page-content > div[style*="background: linear-gradient"] { background: linear-gradient(135deg, #592430 0%, #4a273b 100%) !important; box-shadow: none !important; border: 1px solid #333; }
#period-status-display { color: #fff !important; text-shadow: none !important; }
#period-calendar-grid > div { color: #e0e0e0 !important; background: #2c2c2c !important; }
#period-calendar-grid > div[style*="background: #fff"] { background: #2c2c2c !important; color: #ccc !important; }
#period-calendar-grid > div[style*="background: #f6ffed"] { background: #1a3320 !important; color: #6fc87e !important; }
#period-calendar-grid > div[style*="background: #f3e8ff"] { background: #281a3d !important; color: #b185e5 !important; }
#period-calendar-grid > div[style*="background: #ffccc7"] { background: #3d1a1b !important; color: #ff6b81 !important; }
#period-calendar-grid > div[style*="background: #ff4d4f"] { background: #a1232b !important; color: #fff !important; }

/* ==================================== */
/* 7. 查手机 (Check Phone) */
/* ==================================== */
.reaction-area { background-color: #191919 !important; border-color: #333 !important; }
.reaction-bubble { background-color: #2c2c2c !important; color: #e0e0e0 !important; }
.reaction-bubble::before { border-color: transparent #2c2c2c transparent transparent !important; }
.screen-app { background-color: #111 !important; }
.app-header { background-color: #191919 !important; color: #e0e0e0 !important; border-color: #333 !important; }
.app-back, .app-title { color: #e0e0e0 !important; }
.sim-sms-item, .sim-wechat-item { background-color: #191919 !important; }
#wechat-chat-view { background-color: #111 !important; }
#wechat-chat-view > div[style*="background:#fff"] { background-color: #191919 !important; border-color: #333 !important; }
.sim-chat-bubble-row.left .sim-chat-bubble { background-color: #2c2c2c !important; color: #e0e0e0 !important; border-color: #444 !important; }
.sim-chat-bubble-row.right .sim-chat-bubble { background-color: #2ba245 !important; color: #fff !important; border-color: #2ba245 !important; }
#cp-app-content > div[style*="background:#fff"], #rcp-app-content > div[style*="background:#fff"] { background-color: #191919 !important; }
.rcp-br-item, .rcp-call-item, .rcp-wallet-item { border-bottom-color: #333 !important; }
.rcp-br-item div[style*="background:#f9f9f9"], .rcp-call-item div[style*="background:#f9f9f9"] { background-color: #2c2c2c !important; }
.sim-tiktok-item { background-color: #191919 !important; border: 1px solid #333 !important; }

/* ==================================== */
/* 8. 收藏 (Favorites) & 表情包 (Emoticons) */
/* ==================================== */
.fav-content { background-color: #2c2c2c !important; color: #ccc !important; }
.fav-content.is-voice { background-color: #2c2c2c !important; border-color: #444 !important; color:#fff !important;}

.emoticon-tabs, .emoticon-picker-tabs { background-color: #191919 !important; border-color: #333 !important; }
.emoticon-tab-item { color: #888 !important; }
.emoticon-tab-item.active { color: #07c160 !important; }
.emoticon-desc { color: #ccc !important; background-color: #191919 !important; border-top-color: #333 !important; }
.emoticon-img-box { background-color: transparent !important; }
.emoticon-picker-card { background-color: #2c2c2c !important; border-color: #444 !important; }
.emoticon-picker-desc { color: #aaa !important; }

/* ==================================== */
/* 10. 杂项补全与钱包修复 */
/* ==================================== */
.func-icon { background-color: #2c2c2c !important; color: #aaa !important; border-color: #444 !important; }
.func-icon i { color: #aaa !important; }
.func-text { color: #888 !important; }
.search-bar-container input { background-color: #2c2c2c !important; color: #fff !important; }

/* ★ 钱包与账单明细文字强制清晰化 */
.transaction-section { background-color: transparent !important; } /* 让伪元素接管 */
.transaction-title { border-bottom-color: #333 !important; color: #ffffff !important; }
.transaction-item { border-color: #333 !important; }
.trans-desc, .trans-left { color: #e0e0e0 !important; }
/* 重点：原本是黑色的支出数字，强行提亮为白色 */
.trans-right.negative { color: #ffffff !important; }
.trans-time { color: #aaaaaa !important; }
#wallet-page .page-content { background-color: transparent !important; }

/* 针对原版 CSS 中没覆盖到的白底元素统一补全 */
.top-bar, .bottom-nav, .chat-input-bar, .forum-input-bar, .batch-action-bar, .forum-tabs-wrapper, .forum-tabs-actions {
    background-color: #151515 !important;
    border-color: #222 !important;
}

/* 底部防遮挡 */
#chat-list-page .page-content, #contact-page .page-content, #discover-page .page-content, #me-page .page-content { padding-bottom: 80px !important; box-sizing: border-box !important; }

/* ==================================== */
/* 11. 心声面板专属暗黑护眼适配 */
/* ==================================== */
#inner-status-modal { 
    background-color: #1e1e1e !important; 
    border-color: #333 !important; 
    box-shadow: 0 8px 30px rgba(0,0,0,0.8) !important; 
}
.status-label { color: #999 !important; }
.status-value { color: #e0e0e0 !important; }
.os-item { 
    background-color: #2d2614 !important;  
    border-left-color: #cda028 !important; 
}
.os-item .status-label { color: #8a7b53 !important; } 
.os-item .status-value { color: #e0c888 !important; } 
.jealousy-bar-container { background-color: #333 !important; }
`, 
						bubbleCss: '', 
						zoom: 100, 
						fontUrl: '' 
					} 
				}
			],

			init: async function() {
				// 获取内置的最新版暗黑模式预设作为基准
				const builtinDark = this.presets.find(pre => pre.name === "暗黑模式");

				// 1. 读取设置 (含抢救逻辑)
				let s = await localforage.getItem('nnPhoneStyleSettings');
				if (!s) {
					const oldS = localStorage.getItem('nnPhoneStyleSettings');
					if (oldS) {
						try { s = JSON.parse(oldS); localforage.setItem('nnPhoneStyleSettings', s); } catch(e){}
					}
				}
				if (s) {
					// 【核心后门 1：安全热更新】
					if (s.globalCss && s.globalCss.includes('/* 【全局暗黑基础】 */') && !s.globalCss.includes('伪元素避开')) {
						if (builtinDark) {
							// 重点：仅仅只替换 globalCss 字符串！
							// 用户的 s.globalBg (通用壁纸), s.fontUrl (字体) 完全不会被触碰。
							s.globalCss = builtinDark.data.globalCss;
							
							localforage.setItem('nnPhoneStyleSettings', s);
							localStorage.setItem('nnPhoneStyleSettings_Sync', JSON.stringify(s)); 
							console.log("[StyleManager] 发现旧版暗黑模式，已安全修复全局CSS，用户的背景图未受影响！");
						}
					}
					this.settings = { ...this.settings, ...s };
				}

				// 2. 读取预设 (含抢救逻辑)
				let p = await localforage.getItem('nnPhoneStylePresets');
				if (!p) {
					const oldP = localStorage.getItem('nnPhoneStylePresets');
					if (oldP) {
						try { p = JSON.parse(oldP); localforage.setItem('nnPhoneStylePresets', p); } catch(e){}
					}
				}
				if (p) {
					// 【核心后门 2：安全升级预设库】
					const localDark = p.find(pre => pre.name === "暗黑模式");
					if (builtinDark && localDark) {
						if (localDark.data.globalCss !== builtinDark.data.globalCss) {
							// 同样只覆盖预设里的 globalCss
							localDark.data.globalCss = builtinDark.data.globalCss;
							localforage.setItem('nnPhoneStylePresets', p);
						}
					} else if (builtinDark && !localDark) {
						p.unshift(JSON.parse(JSON.stringify(builtinDark)));
						localforage.setItem('nnPhoneStylePresets', p);
					}
					this.presets = p;
				}

				this.initListeners();
				this.applyStyles();
				this.checkBg();
			},

			applyStyles: function() {
				let styleTag = document.getElementById('custom-style-tag');
				if (!styleTag) {
					styleTag = document.createElement('style');
					styleTag.id = 'custom-style-tag';
					document.head.appendChild(styleTag);
				}     
                let css = '';
				if (this.settings.fontUrl) {
					// 【修改点】：将 swap 改为了 block
					css += `@font-face { font-family: 'UserFont'; src: url('${this.settings.fontUrl}'); font-display: block; } *:not(.fas):not(.far):not(.fab):not(.fa) { font-family: 'UserFont', sans-serif !important; }`;
				}
                css += this.settings.globalCss || '';
				css += this.settings.bubbleCss || '';
				styleTag.textContent = css;
				const zoomVal = (this.settings.zoom || 100) + '%';
				document.querySelectorAll('.page-content, .msg-input-area').forEach(el => el.style.zoom = zoomVal);
				document.body.style.zoom = '100%'; 
				syncStatusBarColor();
			},

            checkBg: function() {
                const contentArea = document.getElementById('main-content-area');
                const chatPage = document.getElementById('chat-detail-page');
                if (!chatPage || !chatPage.classList.contains('active')) {
                    document.body.style.backgroundImage = '';
                    if (contentArea) contentArea.style.background = '';
                    return;
                }
                let bgUrl = '';
                if (typeof activeChatId !== 'undefined' && typeof characters !== 'undefined' && activeChatId) {
                    const char = characters.find(c => c.id == activeChatId);
                    if (char && char.backgroundImage && char.backgroundImage.trim() !== '') bgUrl = char.backgroundImage;
                }
                if (!bgUrl && this.settings.globalBg && this.settings.globalBg.trim() !== '') bgUrl = this.settings.globalBg;
                
                if (bgUrl) {
                    document.body.style.backgroundImage = `url('${bgUrl}')`;
                    document.body.style.backgroundSize = 'cover';
                    document.body.style.backgroundPosition = 'center';
                    document.body.style.backgroundRepeat = 'no-repeat';
                    document.body.style.backgroundAttachment = 'fixed';
                    if (contentArea) contentArea.style.background = 'transparent';
                    if (chatPage) chatPage.style.background = 'transparent';
                } else {
                    document.body.style.backgroundImage = '';
                    if (contentArea) contentArea.style.background = ''; 
                }
            },

			save: async function() {
				this.readFromUI();
				await localforage.setItem('nnPhoneStyleSettings', this.settings);
				// 【新增】：同步保存一份到 localStorage，供下一次刷新时首屏瞬间读取
				localStorage.setItem('nnPhoneStyleSettings_Sync', JSON.stringify(this.settings));
				this.applyStyles();
				this.checkBg();
				alert('保存成功');
				const back = document.querySelector('#custom-style-top .top-bar-back');
				if(back) back.click();
			},

			readFromUI: function() {
				this.settings.globalCss = document.getElementById('custom-css-global').value;
				this.settings.bubbleCss = document.getElementById('custom-css-bubble').value;
				this.settings.fontUrl = document.getElementById('custom-font-url').value;
				this.settings.zoom = document.getElementById('global-font-size-range').value;
				const urlInput = document.getElementById('global-bg-url-input').value;
				if(urlInput) this.settings.globalBg = urlInput;
			},
			
			updateUI: function() {
				if(document.getElementById('custom-css-global')) document.getElementById('custom-css-global').value = this.settings.globalCss || '';
				if(document.getElementById('custom-css-bubble')) document.getElementById('custom-css-bubble').value = this.settings.bubbleCss || '';
				if(document.getElementById('custom-font-url')) document.getElementById('custom-font-url').value = this.settings.fontUrl || '';
				
				const z = this.settings.zoom || 100;
				if(document.getElementById('global-font-size-range')) {
					document.getElementById('global-font-size-range').value = z;
					document.getElementById('font-size-val').textContent = z + '%';
				}
				
				const preview = document.getElementById('global-bg-preview');
				const uploaderDiv = document.querySelector('#global-bg-uploader div');
				const urlInput = document.getElementById('global-bg-url-input');
				
				if (this.settings.globalBg) {
					if(preview) { preview.src = this.settings.globalBg; preview.style.display = 'block'; }
					if(uploaderDiv) uploaderDiv.style.display = 'none';
					if(urlInput && !this.settings.globalBg.startsWith('data:')) urlInput.value = this.settings.globalBg;
				} else {
					if(preview) preview.style.display = 'none';
					if(uploaderDiv) uploaderDiv.style.display = 'flex';
					if(urlInput) urlInput.value = '';
				}
			},
			

			renderPresets: function() {
				const select = document.getElementById('style-preset-selector');
				if (!select) return;
				select.innerHTML = '<option value="">-- 选择一个预设自动填入 --</option>';
				this.presets.forEach(p => {
					const opt = document.createElement('option');
					opt.value = p.name;
					opt.textContent = p.name;
					select.appendChild(opt);
				});
			},

			initListeners: function() {
				// 1. 劫持 switchPage
				if (typeof window.switchPage === 'function') {
					const originalSwitchPage = window.switchPage;
					window.switchPage = function(pageId) {
						originalSwitchPage(pageId);
						setTimeout(() => {
							StyleManager.checkBg(); 
						}, 50);
					};
				}

				// 2. 入口按钮
				const openBtn = document.getElementById('custom-style-btn');
				if(openBtn) {
					const newBtn = openBtn.cloneNode(true);
					openBtn.parentNode.replaceChild(newBtn, openBtn);
					newBtn.addEventListener('click', () => {
						this.updateUI();
						this.renderPresets(); 
						if(typeof switchPage === 'function') switchPage('custom-style-page');
						document.querySelectorAll('.top-bar').forEach(b => b.style.display = 'none');
						const top = document.getElementById('custom-style-top');
						if(top) top.style.display = 'flex';
					});
				}

				// 3. 全局点击委托 (核心部分)
				document.body.addEventListener('click', (e) => {
					// 保存主配置
					if (e.target.closest('#custom-style-save-btn') || e.target.closest('#save-custom-style-btn')) {
						this.save();
					}
					// 保存预设
					if (e.target.closest('#save-style-preset-btn')) {
						const name = prompt("请输入新预设的名称：");
						if (name) {
							this.readFromUI(); 
							this.presets.push({ name: name, data: JSON.parse(JSON.stringify(this.settings)) });
							localforage.setItem('nnPhoneStylePresets', this.presets);
							this.renderPresets(); 
							alert(`预设 "${name}" 已保存`);
						}
					}
					// 删除预设
					if (e.target.closest('#manage-style-presets-btn')) {
						const list = this.presets.map((p, i) => `${i+1}. ${p.name}`).join('\n');
						const idx = prompt(`输入序号删除预设:\n${list}`);
						if (idx && this.presets[idx-1]) {
							if(confirm(`删除 "${this.presets[idx-1].name}"？`)) {
								this.presets.splice(idx-1, 1);
								localforage.setItem('nnPhoneStylePresets', this.presets);
								this.renderPresets();
								alert("删除成功");
							}
						}
					}
					// 恢复默认字体
					if (e.target.closest('#clear-font-btn')) {
						this.settings.fontUrl = '';
						document.getElementById('custom-font-url').value = '';
						alert("字体设置已重置 (需点击保存)");
					}
					// 上传背景图
					if (e.target.closest('#global-bg-uploader')) {
						const input = document.createElement('input');
						input.type = 'file'; input.accept = 'image/*';
						input.onchange = (evt) => {
							const reader = new FileReader();
							reader.onload = (r) => {
								this.settings.globalBg = r.target.result;
								document.getElementById('global-bg-preview').src = r.target.result;
								document.getElementById('global-bg-preview').style.display = 'block';
								document.querySelector('#global-bg-uploader div').style.display = 'none';
							};
							reader.readAsDataURL(evt.target.files[0]);
						};
						input.click();
					}
					// 清除背景图
					if (e.target.closest('#clear-global-bg-btn')) {
						this.settings.globalBg = '';
						document.getElementById('global-bg-url-input').value = '';
						document.getElementById('global-bg-preview').style.display = 'none';
						document.querySelector('#global-bg-uploader div').style.display = 'flex';
					}
					// 导出
					// 导出
					if (e.target.closest('#export-style-btn')) {
						this.readFromUI();
						// 【核心修改】去掉了 presets: this.presets，只导出当前主界面的美化设定
						const exportData = { type: 'NN_PHONE_STYLE_CONFIG', version: 1.0, timestamp: Date.now(), settings: this.settings };
						const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
						const url = URL.createObjectURL(blob);
						const a = document.createElement('a');
						a.href = url;
						a.download = `NN_Theme_${Date.now()}.json`; // 下载文件名也顺便改成了更贴切的主题名称
						document.body.appendChild(a); a.click(); document.body.removeChild(a);
						URL.revokeObjectURL(url);
					}
					// 导入
					if (e.target.closest('#import-style-btn')) {
						const fileInput = document.getElementById('import-style-file');
						if (fileInput) fileInput.click();
					}
					// 重置
					if (e.target.closest('#reset-style-btn')) {
						if (confirm("⚠️ 确定重置美化配置为默认状态？")) {
							this.settings = { globalBg: '', globalCss: '', bubbleCss: '', zoom: 100, fontUrl: '' };
							localforage.setItem('nnPhoneStyleSettings', this.settings).then(() => {
								// 【新增】：清空同步缓存
								localStorage.removeItem('nnPhoneStyleSettings_Sync');
								this.updateUI(); this.applyStyles(); this.checkBg();
								alert("已重置默认状态！");
							});
						}
					}
				});

				// 导入监听
				const importInput = document.getElementById('import-style-file');
				if (importInput) {
					const newInput = importInput.cloneNode(true);
					importInput.parentNode.replaceChild(newInput, importInput);
					newInput.addEventListener('change', (evt) => {
						const file = evt.target.files[0];
						if (!file) return;
						const reader = new FileReader();
						reader.onload = async (e) => {
							try {
								const data = JSON.parse(e.target.result);
								if (!data.settings && !data.presets) throw new Error("格式错误");
								if (confirm(`确认导入配置？`)) {
									if (data.settings) this.settings = data.settings;
									if (data.presets) this.presets = data.presets;
									await localforage.setItem('nnPhoneStyleSettings', this.settings);
									localStorage.setItem('nnPhoneStyleSettings_Sync', JSON.stringify(this.settings));
									await localforage.setItem('nnPhoneStylePresets', this.presets);
									this.updateUI(); this.renderPresets(); this.applyStyles(); this.checkBg();
									alert("导入成功！");
								}
							} catch (err) { alert("导入失败: " + err.message); } finally { newInput.value = ''; }
						};
						reader.readAsText(file);
					});
				}

				// 预设选择
				const presetSelect = document.getElementById('style-preset-selector');
				if (presetSelect) {
					presetSelect.addEventListener('change', (e) => {
						const name = e.target.value;
						if (!name) return;
						const target = this.presets.find(p => p.name === name);
						if (target) {
							// 判定是否是暗黑模式
							const isDarkMode = (name === "暗黑模式");
							const confirmMsg = isDarkMode 
								? `加载预设 "${name}"？\n(注：此官方预设将自动保留您当前设置的聊天背景图)`
								: `加载预设 "${name}"？\n(警告：此操作将完整替换当前的样式、字体，以及该主题配套的背景图)`;

							if(confirm(confirmMsg)) {
								// 提前暂存用户当前的背景图
								const savedBg = this.settings.globalBg;
								
								// 完全应用预设数据（此时包括背景图也被预设覆盖了）
								this.settings = JSON.parse(JSON.stringify(target.data));
								
								// 【核心逻辑】如果用户选的是"暗黑模式"，我们把原来的壁纸塞回去；否则保留主题自带的壁纸！
								if (isDarkMode) {
									this.settings.globalBg = savedBg;
								}
								
								this.updateUI();
							}
							e.target.value = "";
						}
					});
				}

				// 滑块
				const range = document.getElementById('global-font-size-range');
				if(range) {
					range.addEventListener('input', (e) => {
						const val = e.target.value + '%';
						document.getElementById('font-size-val').textContent = val;
						document.querySelectorAll('.page-content, .msg-input-area').forEach(el => el.style.zoom = val);
					});
				}
			}
		};

		// 启动
		document.addEventListener('DOMContentLoaded', () => StyleManager.init());
		
		// ============================================================
		// 【新增】语音 API 设置逻辑 (Minimax)
		// ============================================================

		const voiceApiSettingBtn = document.getElementById('voice-api-setting-btn');
		const voiceApiSaveBtn = document.getElementById('voice-api-save-btn');
		const voiceApiBackBtn = document.querySelector('#voice-api-setting-top .top-bar-back');
		const voiceGroupIdInput = document.getElementById('voice-group-id-input');
		const voiceApiKeyInput = document.getElementById('voice-api-key-input');
		const voiceUserIdInput = document.getElementById('voice-user-id-input'); 
		// 1. 进入设置页
		if (voiceApiSettingBtn) {
			voiceApiSettingBtn.addEventListener('click', () => {
				// 回显数据
				voiceGroupIdInput.value = voiceApiSettings.groupId || '';
				voiceApiKeyInput.value = voiceApiSettings.apiKey || '';
				if(voiceUserIdInput) voiceUserIdInput.value = voiceApiSettings.userVoiceId || '';
				switchPage('voice-api-setting-page');
				switchTopBar('voice-api-setting-top');
			});
		}

		// 2. 返回按钮
		if (voiceApiBackBtn) {
			voiceApiBackBtn.addEventListener('click', () => {
				switchPage('contact-page');
				switchTopBar('contact-top');
			});
		}

		// 3. 保存按钮
		if (voiceApiSaveBtn) {
			voiceApiSaveBtn.addEventListener('click', () => {
				voiceApiSettings.groupId = voiceGroupIdInput.value.trim();
				voiceApiSettings.apiKey = voiceApiKeyInput.value.trim();
				if(voiceUserIdInput) voiceApiSettings.userVoiceId = voiceUserIdInput.value.trim();
				saveVoiceApiSettingsToLocal();
				alert('语音 API 设置已保存！');
				voiceApiBackBtn.click(); // 自动返回
			});
		}
		// ============================================================
		// 【新增】语音输入逻辑
		// ============================================================
		const btnFuncVoice = document.getElementById('btn-func-voice-msg');
		const voiceModal = document.getElementById('voice-input-modal');
		const voiceInput = document.getElementById('voice-text-input');
		const voiceCancel = document.getElementById('voice-input-cancel');
		const voiceConfirm = document.getElementById('voice-input-confirm');

		// 1. 打开弹窗
		if (btnFuncVoice) {
			btnFuncVoice.addEventListener('click', () => {
				// 关闭底部面板
				const funcPanel = document.getElementById('function-panel-modal');
				if (funcPanel) funcPanel.classList.remove('show');
				
				// 显示弹窗
				voiceInput.value = '';
				voiceModal.classList.add('show');
				setTimeout(() => voiceInput.focus(), 100);
			});
		}

		// 2. 取消
		if (voiceCancel) {
			voiceCancel.addEventListener('click', () => {
				voiceModal.classList.remove('show');
			});
		}

		// 3. 确认发送
		if (voiceConfirm) {
			voiceConfirm.addEventListener('click', () => {
				const text = voiceInput.value.trim();
				if (!text) {
					alert("请输入内容");
					return;
				}

				// 简单算法：每3个字算1秒，最少1秒，最多60秒
				let duration = Math.ceil(text.length / 3);
				if (duration < 1) duration = 1;
				if (duration > 60) duration = 60;

				// 发送语音消息
				// 我们利用 saveAndRenderMessage 的参数扩展性，或者手动构建对象
				// 这里为了兼容性，我们修改 saveAndRenderMessage 或手动调用底层逻辑
				// 为了方便，我们直接调用 saveAndRenderMessage 并传入特殊标记，
				// 但由于 saveAndRenderMessage 参数有限，我们直接操作 characters 数组更灵活。
				
				sendVoiceMessage(text, duration);

				voiceModal.classList.remove('show');
			});
		}

		// 专门的发送语音函数
		function sendVoiceMessage(text, duration) {
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
			if (!char) return;

			const newMsg = {
				text: text, // 语音转文字的内容
				type: 'sent',
				timestamp: Date.now(),
				isRead: true,
				isVoice: true, // 【核心标记】
				voiceDuration: duration // 【核心数据】
			};

			if (!char.chatHistory) char.chatHistory = [];
			char.chatHistory.push(newMsg);
			saveCharactersToLocal();

			renderMessageToScreen(newMsg);
			scrollToBottom();
			renderChatList();
		}
		
		// ============================================================
		// 【新增】十六进制字符串转 Blob 的辅助函数
		// ============================================================
		function hexStringToBlob(hexString) {
			try {
				// 确保是偶数长度，如果不是则前面补0
				if (hexString.length % 2 !== 0) {
					hexString = '0' + hexString;
				}
				
				// 创建一个足够大的 ArrayBuffer
				const bytes = new Uint8Array(hexString.length / 2);
				
				// 遍历十六进制字符串，每两个字符转换成一个字节
				for (let i = 0; i < hexString.length; i += 2) {
					bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
				}
				
				// 用转换后的字节数组创建一个 Blob 对象，并指定 MIME 类型
				return new Blob([bytes], { type: 'audio/mp3' });
			} catch (e) {
				console.error("十六进制转 Blob 失败:", e);
				return null; // 转换失败返回 null
			}
		}
		
		// ============================================================
		// 【新增】收藏页面功能逻辑 (包含搜索过滤系统)
		// ============================================================

		const myFavoritesBtn = document.getElementById('my-favorites-btn');
		const favoritesSaveBtn = document.getElementById('favorites-save-btn');
		const favoritesTopBack = document.querySelector('#favorites-top .top-bar-back');
		const favoritesContainer = document.getElementById('favorites-list-container');

		// 搜索栏相关的 DOM
		const favSearchInput = document.getElementById('fav-search-input');
		const favSearchClear = document.getElementById('fav-search-clear');
		let currentFavSearchKeyword = '';

		// 1. 进入收藏页面
		if (myFavoritesBtn) {
			myFavoritesBtn.addEventListener('click', () => {
				// 每次进入重置搜索状态
				currentFavSearchKeyword = '';
				if (favSearchInput) favSearchInput.value = '';
				if (favSearchClear) favSearchClear.style.display = 'none';

				renderFavoritesList();
				switchPage('favorites-page');
				switchTopBar('favorites-top');
			});
		}

		// 2. 搜索框监听逻辑
		if (favSearchInput) {
			favSearchInput.addEventListener('input', (e) => {
				currentFavSearchKeyword = e.target.value.trim();
				if (currentFavSearchKeyword.length > 0) {
					favSearchClear.style.display = 'block';
				} else {
					favSearchClear.style.display = 'none';
				}
				renderFavoritesList();
			});
		}

		// 3. 搜索框清空按钮逻辑
		if (favSearchClear) {
			favSearchClear.addEventListener('click', () => {
				currentFavSearchKeyword = '';
				favSearchInput.value = '';
				favSearchClear.style.display = 'none';
				renderFavoritesList();
				favSearchInput.focus();
			});
		}

		// 4. 返回按钮
		if (favoritesTopBack) {
			favoritesTopBack.addEventListener('click', () => {
				switchPage('me-page');
				switchTopBar(''); // 首页没有 top bar ID
			});
		}

		// 5. 保存按钮
		if (favoritesSaveBtn) {
			favoritesSaveBtn.addEventListener('click', () => {
				saveFavoritesToLocal();
				alert('收藏列表已保存');
				favoritesTopBack.click();
			});
		}

		// 6. 渲染列表核心函数 (支持高亮与过滤)
		function renderFavoritesList() {
			if (!favoritesContainer) return;
			favoritesContainer.innerHTML = '';

			// --- 数据过滤 ---
			let listToRender = favoriteMessages;
			if (currentFavSearchKeyword) {
				const keyword = currentFavSearchKeyword.toLowerCase();
				listToRender = favoriteMessages.filter(item => {
					const textMatch = item.text && item.text.toLowerCase().includes(keyword);
					const nameMatch = item.name && item.name.toLowerCase().includes(keyword);
					return textMatch || nameMatch;
				});
			}

			// --- 空状态处理 ---
			if (listToRender.length === 0) {
				favoritesContainer.innerHTML = `
					<div style="text-align:center; padding: 40px; color: #999;">
						<i class="fas fa-star" style="font-size: 32px; margin-bottom: 10px; color: #ddd;"></i>
						<p>${currentFavSearchKeyword ? '未找到相关收藏' : '暂无收藏内容'}</p>
					</div>
				`;
				return;
			}

			// --- 遍历渲染 ---
			listToRender.forEach((item, index) => {
				// 时间格式化
				const timeToDisplay = item.originalTimestamp || item.timestamp;
				const dateStr = getChatHistoryTime(timeToDisplay); 
				
				// 头像处理
				const avatarHtml = item.avatar 
					? `<img src="${item.avatar}">` 
					: `<i class="fas fa-user"></i>`;

				// 名字与文本的高亮处理
				let displayName = item.name;
				let displayText = item.text || '';

				if (currentFavSearchKeyword) {
					// 忽略大小写正则
					const highlightRegex = new RegExp(`(${currentFavSearchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
					displayName = displayName.replace(highlightRegex, '<span class="highlight-text">$1</span>');
					displayText = formatTextForDisplay(displayText).replace(highlightRegex, '<span class="highlight-text">$1</span>');
				} else {
					displayText = formatTextForDisplay(displayText);
				}

				// 内容处理
				let contentHtml = '';
				
				if (item.isVoice) {
					// --- 语音消息 ---
					contentHtml = `
						<div class="fav-content is-voice" onclick="playFavoriteVoice('${item.id}')">
							<i class="fas fa-rss" style="transform: rotate(45deg);"></i> 
							<span>${item.voiceDuration || 1}" (点击播放)</span>
							<div style="font-size:12px; color:#666; margin-left:10px;">${displayText || '语音'}</div>
						</div>
					`;
				} else if (item.image) {
					// --- 图片/表情包 ---
					if (item.text && item.text.startsWith('[表情包：')) {
						contentHtml = `<div class="fav-content" style="background:transparent; padding:0;">
							<img src="${item.image}" style="max-width: 120px;">
							<div style="font-size:12px; color:#999; margin-top:5px;">${displayText}</div>
						</div>`;
					} else {
						contentHtml = `<div class="fav-content" style="padding:0;">
							<img src="${item.image}" style="width:100%; border-radius:6px;">
							${item.text && item.text !== '[图片]' ? `<div style="padding:8px;">${displayText}</div>` : ''}
						</div>`;
					}
				} else if (item.isVirtual) {
					// --- 虚拟图片 ---
					contentHtml = `
						<div class="fav-content">
							<i class="fas fa-image" style="color:#aaa; margin-right:5px;"></i> [虚拟图片] ${displayText}
						</div>
					`;
				} else if (item.text && item.text.match(/^\[文件：(.*?)\|(.*?)\]$/s)) {
					// --- 模拟文件 ---
					// 这里重新匹配原文本防止高亮后正则失败
					const match = item.text.match(/^\[文件：(.*?)\|(.*?)\]$/s);
					let fileName = match[1];
					let fileDesc = match[2];
					
					// 文件名和描述局部高亮
					if (currentFavSearchKeyword) {
						const highlightRegex = new RegExp(`(${currentFavSearchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
						fileName = fileName.replace(highlightRegex, '<span class="highlight-text">$1</span>');
						fileDesc = fileDesc.replace(highlightRegex, '<span class="highlight-text">$1</span>');
					}

					contentHtml = `
						<div class="fav-content">
							<i class="fas fa-file-alt" style="color:#4183c4; margin-right:5px;"></i> [文件] ${fileName}
							<div style="font-size:12px; color:#888; margin-top:4px;">${fileDesc}</div>
						</div>
					`;	
				} else {
					// --- 普通文本 ---
					contentHtml = `<div class="fav-content">${displayText}</div>`;
				}

				// 构建卡片 HTML
				const card = document.createElement('div');
				card.className = 'fav-card';
				card.innerHTML = `
					<div class="fav-header">
						<div class="fav-avatar">${avatarHtml}</div>
						<div class="fav-info">
							<div class="fav-name">${displayName}</div>
							<div class="fav-time">发送于 ${dateStr}</div>
						</div>
						<button class="fav-delete-btn" onclick="deleteFavorite('${item.id}')">
							<i class="fas fa-trash"></i>
						</button>
					</div>
					${contentHtml}
				`;
				favoritesContainer.appendChild(card);
			});
		}

		// 7. 删除收藏
		window.deleteFavorite = function(favId) {
			if (confirm('确定移除这条收藏吗？')) {
				favoriteMessages = favoriteMessages.filter(item => item.id !== favId);
				saveFavoritesToLocal();
				renderFavoritesList();
			}
		};

		// 8. 播放收藏的语音
		window.playFavoriteVoice = function(favId) {
			const item = favoriteMessages.find(i => i.id === favId);
			if (!item) return;

			if (!item.voiceId) {
				alert('该语音缺少角色声音配置，无法播放。');
				return;
			}

			// 调用现有的 TTS 播放函数
			// playMinimaxTTS(text, voiceId)
			// 提示：确保 playMinimaxTTS 函数在 app.js 中是可用的
			if (typeof playMinimaxTTS === 'function') {
				// 给个提示
				const btn = event.currentTarget; // 获取点击的 div
				const originalIcon = btn.innerHTML;
				
				// 简单的加载状态
				btn.style.opacity = '0.7';
				
				playMinimaxTTS(item.text, item.voiceId)
					.then(() => {
						btn.style.opacity = '1';
					})
					.catch(e => {
						btn.style.opacity = '1';
						alert('播放失败: ' + e.message);
					});
			} else {
				alert('语音播放组件未加载');
			}
		};
		
		// ============================================================
		// 【新增】通话系统核心逻辑 (V5 - 融合语音与视频通话)
		// ============================================================

		const VideoCallSystem = {
			// 状态变量
			state: {
				isCalling: false,
				isMinimized: false,
				startTime: 0,
				timerInterval: null,
				currentChatLogs: [],
				initiator: 'user',
				charId: null,
				callType: 'video', // 新增：'video' 或 'voice'
			},

			// DOM 元素缓存
			dom: {
				page: document.getElementById('video-call-page'),
				float: document.getElementById('mini-call-float'),
				timerDisplay: document.getElementById('call-timer-display'),
				miniTimer: document.getElementById('mini-call-timer'),
				textStream: document.getElementById('call-text-stream'),
				input: document.getElementById('call-input-text'),
				bgPlaceholder: document.getElementById('video-bg-placeholder'),
				incomingModal: document.getElementById('incoming-call-modal'),
				incomingAvatar: document.getElementById('incoming-call-avatar'),
				incomingName: document.getElementById('incoming-call-name'),
			},

			openSharedEditModal: function(initialText, onSave) {
				const modal = document.getElementById('video-edit-modal');
				const input = document.getElementById('video-edit-input');
				const saveBtn = document.getElementById('video-edit-save');
				const cancelBtn = document.getElementById('video-edit-cancel');

				if (!modal || !input || !saveBtn || !cancelBtn) return;
				input.value = initialText;
				modal.style.zIndex = '10005'; 
				modal.classList.add('show');
				setTimeout(() => input.focus(), 100);

				const closeModal = () => {
					modal.classList.remove('show');
					modal.style.zIndex = ''; 
					saveBtn.onclick = null;
					cancelBtn.onclick = null;
				};

				cancelBtn.onclick = closeModal;
				saveBtn.onclick = () => {
					const newText = input.value.trim();
					if (newText) onSave(newText);
					closeModal(); 
				};
			},
			
            initiateUserCall: async function(callType = 'video') {
                if (!activeChatId) return;
                const char = characters.find(c => c.id == activeChatId);
                if (!char) return;

				this.state.callType = callType; // 记录通话类型
				const typeName = callType === 'video' ? '视频' : '语音';

                const statusEl = document.getElementById('chat-detail-status');
                const originalStatus = statusEl ? statusEl.textContent : "在线";
                if (statusEl) statusEl.textContent = `正在发起${typeName}呼叫...`;
                
                const refreshLoader = document.getElementById('moments-refresh-loader');
                if (refreshLoader) refreshLoader.style.height = '50px';
                const refreshText = document.getElementById('moments-refresh-text');
                if (refreshText) refreshText.innerText = "正在等待对方接听...";

                try {
                    const charName = char.name;
                    const persona = char.persona || "无设定";
                    // 【修复】通话系统：呼叫判断时代入预设面具
					let userName = userInfo.name;
					let userMask = userInfo.mask || "无设定";
					if (char.userMaskId) {
						const boundMask = userMasks.find(m => m.id === char.userMaskId);
						if (boundMask) {
							if (boundMask.name) userName = boundMask.name;
							if (boundMask.mask) userMask = boundMask.mask;
						}
					} else {
						if (char.userName && char.userName.trim()) userName = char.userName.trim();
						if (char.userMask && char.userMask.trim()) userMask = char.userMask.trim();
					}

                    const ltmText = (char.longTermMemories || []).join('\n');
                    const lifeEventsText = (char.lifeEvents || []).map(e => `[${e.date}] ${e.event}`).join('\n');
					// --- 新增：世界书、经期、天气上下文 ---
                    const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);

                    let periodContext = "";
                    if (typeof window.getPeriodStatusForAi === 'function' && typeof periodData !== 'undefined' && periodData.syncCharIds && periodData.syncCharIds.includes(char.id)) {
                        const periodAiInstruction = window.getPeriodStatusForAi();
                        if (periodAiInstruction) {
                            periodContext = periodAiInstruction;
                        }
                    }

                    let weatherContext = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(char.id) : "";
					let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(char.id) : ""; // <--- 获取日程
                    const recentChatText = (char.chatHistory || []).slice(-15).map(m => {
                        const role = m.type === 'sent' ? userName : charName;
                        let content = m.text || "";
                        content = content.replace(/\[.*?\]/g, ""); 
                        return `${role}: ${content}`;
                    }).join('\n');

                    const systemPrompt = `${wbBefore}
                    你扮演角色 "${charName}"。
                    【你的核心设定】
					${persona}
					【世界观与设定资料】
					${wbAfter}${weatherContext}${theirDayContext}
                    【用户 "${userName}" 的设定】
					${userMask} ${periodContext}
                    【你们的共同回忆】
					${ltmText || "暂无"}
                    【近期对话】
					${recentChatText}

                    【输出格式 - 严格执行】
                    必须且只能输出JSON：{"accept": true} 或 {"accept": false}
                    `;

                    // 将动作事件拆分为 user 消息，防止 Gemini 等严格 API 报错
                    const userPrompt = `【当前事件】\n用户 "${userName}" 刚刚向你发起了【${typeName}通话】请求。\n请基于以上记忆，决定是否接听，并严格按照要求的 JSON 格式输出结果。`;

                    const messages = [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt }
                    ];
                    const useSettings = (char.apiSettings && char.apiSettings.baseUrl) ? char.apiSettings : chatApiSettings;
                    
                    const response = await callOpenAiApi(messages, useSettings);

                    let result = { accept: true }; 
                    try {
                        const jsonMatch = response.match(/\{[\s\S]*?"accept"[\s\S]*?\}/);
                        if (jsonMatch) result = JSON.parse(jsonMatch[0]);
                        else if (response.includes("false") || response.includes("拒绝")) result.accept = false;
                    } catch (e) {
                        console.error("解析失败，默认接听");
                    }

                    if (result.accept) {
                        if (refreshText) refreshText.innerText = "对方已接听";
                        setTimeout(() => {
                            if (refreshLoader) refreshLoader.style.height = '0';
                            this.startCall('user', char, callType);
                        }, 800);
                    } else {
                        if (refreshText) refreshText.innerText = `对方拒绝了${typeName}通话`;
                        setTimeout(() => { if (refreshLoader) refreshLoader.style.height = '0'; }, 1000);

                        const sysMsg = {
                            text: `对方拒绝了你的${typeName}通话请求`,
                            type: 'received', 
                            timestamp: Date.now(),
                            isRead: true,
                            isCallRecord: true, 
                        };
                        
                        if (!char.chatHistory) char.chatHistory = [];
                        char.chatHistory.push(sysMsg);
                        saveCharactersToLocal();
                        renderMessageToScreen(sysMsg);
                        scrollToBottom();
                    }
                } catch (error) {
                    console.error("呼叫请求失败", error);
                    alert("无法连接到对方 (API错误)");
                    if (refreshLoader) refreshLoader.style.height = '0';
                } finally {
                    if (statusEl) statusEl.textContent = originalStatus;
                }
            },
			
			// --- 1. 发起/接听逻辑 ---
			startCall: function(initiator, character, callType = 'video') {
				if (this.state.isCalling) return;
				this.state.isCalling = true;
				this.state.isMinimized = false;
				this.state.initiator = initiator;
				this.state.charId = character.id;
				this.state.callType = callType;
				this.state.currentChatLogs = [];
				this.state.startTime = Date.now();
				
				// 【修复】统一背景渲染逻辑 (语音和视频都用背景图+半透明蒙版)
				let bgUrl = '';
				if (character.backgroundImage && character.backgroundImage.trim() !== '') {
					bgUrl = character.backgroundImage;
				} else if (typeof StyleManager !== 'undefined' && StyleManager.settings.globalBg) {
					bgUrl = StyleManager.settings.globalBg;
				}
				
				if (bgUrl) {
					this.dom.bgPlaceholder.style.backgroundImage = `url('${bgUrl}')`;
					this.dom.bgPlaceholder.innerHTML = ''; // 有背景图就不显示中心图标
				} else {
					this.dom.bgPlaceholder.style.backgroundImage = 'none';
					// 如果没有背景图，按类型显示默认图标
					if (callType === 'voice') {
						this.dom.bgPlaceholder.innerHTML = '<i class="fas fa-phone-volume"></i><span>语音通话中</span>';
					} else {
						this.dom.bgPlaceholder.innerHTML = '<i class="fas fa-video-slash"></i><span>对方摄像头画面</span>';
					}
				}
				// 统一调整透明度，让界面看起来像蒙版
				this.dom.bgPlaceholder.style.opacity = '0.4';
				this.dom.bgPlaceholder.style.backgroundColor = 'transparent';

				this.dom.page.classList.add('active');
				switchTopBar(null);
				this.dom.float.style.display = 'none';
				
				this.dom.textStream.innerHTML = '';
				const typeName = callType === 'video' ? '视频' : '语音';
				if (initiator === 'user') {
					this.addSystemMessage(`你发起了${typeName}通话`);
					setTimeout(() => this.triggerAiResponse(true), 500);
				} else {
					this.addSystemMessage(`对方邀请你进行${typeName}通话`);
				}
				this.startTimer();
			},

			triggerIncomingCall: function(character, callType = 'video') {
				if (this.state.isCalling) return;
				
				this.dom.incomingName.textContent = character.name;
				if (character.avatar) {
					this.dom.incomingAvatar.innerHTML = `<img src="${character.avatar}">`;
				} else {
					this.dom.incomingAvatar.innerHTML = `<i class="fas fa-user"></i>`;
				}
				
				// --- 新增：动态修改来电提示文字和接听按钮图标 ---
				const typeText = callType === 'voice' ? '语音' : '视频';
				const typeEl = document.querySelector('.incoming-type');
				if (typeEl) typeEl.textContent = `邀请你进行${typeText}通话...`;

				const acceptIcon = document.querySelector('#accept-call-btn i');
				if (acceptIcon) {
					acceptIcon.className = callType === 'voice' ? 'fas fa-phone' : 'fas fa-video';
				}
				// ------------------------------------------------

				this.dom.incomingModal.classList.add('show');
				
				const acceptBtn = document.getElementById('accept-call-btn');
				const rejectBtn = document.getElementById('reject-call-btn');
				
				const newAccept = acceptBtn.cloneNode(true);
				acceptBtn.parentNode.replaceChild(newAccept, acceptBtn);
				const newReject = rejectBtn.cloneNode(true);
				rejectBtn.parentNode.replaceChild(newReject, rejectBtn);

				newAccept.onclick = () => {
					this.dom.incomingModal.classList.remove('show');
					this.startCall('ai', character, callType); // 传入正确的类型
				};

				newReject.onclick = () => {
					this.dom.incomingModal.classList.remove('show');
					const sysMsg = {
						type: 'sent',
						text: `你拒绝了对方的${typeText}通话请求`, // 动态文字
						timestamp: Date.now(),
						isRead: true,
						isCallRecord: true,
					};
					if (!character.chatHistory) character.chatHistory = [];
					character.chatHistory.push(sysMsg);
					saveCharactersToLocal();
					renderMessageToScreen(sysMsg);
					scrollToBottom();
					renderChatList();
				};
			},

			startTimer: function() {
				clearInterval(this.state.timerInterval);
				this.updateTimerUI();
				this.state.timerInterval = setInterval(() => this.updateTimerUI(), 1000);
			},

			updateTimerUI: function() {
				const diff = Math.floor((Date.now() - this.state.startTime) / 1000);
				const m = Math.floor(diff / 60).toString().padStart(2, '0');
				const s = (diff % 60).toString().padStart(2, '0');
				const timeStr = `${m}:${s}`;
				this.dom.timerDisplay.textContent = timeStr;
				this.dom.miniTimer.innerHTML = this.state.callType === 'voice' 
					? `<i class="fas fa-phone"></i> ${timeStr}` 
					: `<i class="fas fa-video"></i> ${timeStr}`;
			},

			addSystemMessage: function(text) {
				const div = document.createElement('div');
				div.className = 'call-sys-msg';
				div.textContent = text;
				this.dom.textStream.appendChild(div);
				this.scrollToBottom();
			},

			addBubble: function(role, text) {
				const timestamp = Date.now();
				const div = document.createElement('div');
				div.className = `call-bubble ${role}`;
				div.id = `v-bubble-${timestamp}`;
				div.innerHTML = text.replace(/\n/g, '<br>');
				div.onclick = (e) => this.showBubbleMenu(e, timestamp, role);
				this.dom.textStream.appendChild(div);
				this.scrollToBottom();
				this.state.currentChatLogs.push({
					id: timestamp,
					role: role === 'user' ? 'user' : 'assistant',
					content: text,
					timestamp: timestamp
				});
			},

			showBubbleMenu: function(e, msgId, role) { /* 保持原样 */
				e.stopPropagation();
				const bubble = document.getElementById(`v-bubble-${msgId}`);
				if (!bubble) return;
				const isAlreadyOpen = bubble.querySelector('.v-bubble-menu');
				
				// 【修复层级遮挡】在打开新菜单前，恢复其他所有气泡的层级
				document.querySelectorAll('.call-bubble').forEach(el => el.style.zIndex = '');
				document.querySelectorAll('.v-bubble-menu').forEach(el => el.remove());
				
				if (isAlreadyOpen) return;

				// 【修复层级遮挡】临时拔高当前被点击气泡的层级，防止被下面的气泡覆盖
				bubble.style.zIndex = '100';

				const menu = document.createElement('div');
				menu.className = 'v-bubble-menu show';
				// 强制菜单自身也置顶
				menu.style.zIndex = '101'; 

				const editBtn = document.createElement('div');
				editBtn.className = 'v-menu-item';
				editBtn.textContent = '编辑';
				editBtn.addEventListener('click', (ev) => {
					ev.stopPropagation();
					this.editBubble(msgId);
					menu.remove();
					bubble.style.zIndex = ''; // 恢复层级
				});
				menu.appendChild(editBtn);
				if (role === 'ai') {
					const lastLog = this.state.currentChatLogs[this.state.currentChatLogs.length - 1];
					if (lastLog && lastLog.id === msgId) {
						const rerollBtn = document.createElement('div');
						rerollBtn.className = 'v-menu-item';
						rerollBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 重试';
						rerollBtn.addEventListener('click', (ev) => {
							ev.stopPropagation();
							this.rerollBubble(msgId);
							menu.remove();
							bubble.style.zIndex = ''; // 恢复层级
						});
						menu.appendChild(rerollBtn);
					}
				}
				const delBtn = document.createElement('div');
				delBtn.className = 'v-menu-item delete';
				delBtn.textContent = '删除';
				delBtn.addEventListener('click', (ev) => {
					ev.stopPropagation();
					bubble.remove();
					const idx = this.state.currentChatLogs.findIndex(l => l.id === msgId);
					if (idx > -1) this.state.currentChatLogs.splice(idx, 1);
					menu.remove();
				});
				menu.appendChild(delBtn);
				bubble.appendChild(menu);
			},

			editBubble: function(msgId) { /* 保持原样 */
				const logIndex = this.state.currentChatLogs.findIndex(l => l.id === msgId);
				if (logIndex === -1) return;
				const log = this.state.currentChatLogs[logIndex];
				this.openSharedEditModal(log.content, (newText) => {
					log.content = newText;
					const bubble = document.getElementById(`v-bubble-${msgId}`);
					if (bubble) {
						const oldMenu = bubble.querySelector('.v-bubble-menu');
						if (oldMenu) oldMenu.remove();
						bubble.innerHTML = newText.replace(/\n/g, '<br>');
					}
				});
			},

			rerollBubble: function(msgId) { /* 保持原样 */
				const logIndex = this.state.currentChatLogs.findIndex(l => l.id === msgId);
				if (logIndex === -1) return;
				this.state.currentChatLogs.splice(logIndex, 1);
				const bubble = document.getElementById(`v-bubble-${msgId}`);
				if (bubble) bubble.remove();
				this.triggerAiResponse(false);
			},

			scrollToBottom: function() {
				requestAnimationFrame(() => {
					if (this.dom.textStream) {
						this.dom.textStream.scrollTop = this.dom.textStream.scrollHeight;
					}
				});
			},

			handleUserSend: function() {
				const text = this.dom.input.value.trim();
				if (!text) return;
				this.addBubble('user', text);
				this.dom.input.value = '';
				this.dom.input.focus();
				this.triggerAiResponse();
			},

			// ============================================================
            // 【核心分支】AI 生成逻辑 (区分视频与语音)
            // ============================================================
            triggerAiResponse: async function(isIntro = false) {
                const char = characters.find(c => c.id == this.state.charId);
                if (!char) return;
               // 【修复】通话系统：连线生成回复时代入预设面具
                let currentUserName = userInfo.name;
                let userMask = userInfo.mask || "无设定";
                if (char.userMaskId) {
                    const boundMask = userMasks.find(m => m.id === char.userMaskId);
                    if (boundMask) {
                        if (boundMask.name) currentUserName = boundMask.name;
                        if (boundMask.mask) userMask = boundMask.mask;
                    }
                } else {
                    if (char.userName && char.userName.trim()) currentUserName = char.userName.trim();
                    if (char.userMask && char.userMask.trim()) userMask = char.userMask.trim();
                }
                const longTermMem = (char.longTermMemories || []).join('\n');
                const lifeEvents = (char.lifeEvents || []).map(e => e.event).join('\n');
				// --- 新增：世界书、经期、天气上下文 ---
                const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);

                let periodContext = "";
                if (typeof window.getPeriodStatusForAi === 'function' && typeof periodData !== 'undefined' && periodData.syncCharIds && periodData.syncCharIds.includes(char.id)) {
                    const periodAiInstruction = window.getPeriodStatusForAi();
                    if (periodAiInstruction) {
                        periodContext = periodAiInstruction;
                    }
                }

                let weatherContext = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(char.id) : "";
				let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(char.id) : ""; // <--- 获取日程
                const hangupInstruction = `
                【自主挂断指令】
                参考日程"${theirDayContext}"，如果你觉得话题已经结束，或者你想主动结束通话（例如要去忙），请在回复的**最后**加上 [HANGUP] 标记。
                系统识别到此标记会自动帮你挂断电话。示例：拜拜！[HANGUP]`;

				// --- 核心：根据通话类型设定 Prompt ---
				let systemPrompt = '';
				if (this.state.callType === 'voice') {
					systemPrompt = `${wbBefore}【模式：纯语音通话模式】
					你(${char.name})正在与"${currentUserName}"进行实时的手机语音通话。
					${char.persona || ''}
					
					【严格指令】
					1. **纯对话输出**：必须直接输出你想说的话。**严禁**包含任何形式的动作、神态、心理活动或环境描写（绝对禁止出现类似 *笑了笑*、(叹气) 等括号或星号包裹的文字）。
					2. **口语化**：语气要自然、松弛，就像真人在打电话一样，可以适度包含口语语气词。
					3. **长度控制**：单次回复请简短自然，避免长篇大论背诵。
					${hangupInstruction}
					
					【用户资料】
					${currentUserName} (${userInfo.gender || '未知'})
					${userMask}
					${wbAfter}
					${periodContext}
					${weatherContext}
					${theirDayContext}
					【记忆】
					${longTermMem}
					${lifeEvents}`;
				} else {
					systemPrompt = `${wbBefore}【模式：视频连线 RP】
					你(${char.name})正在与"${currentUserName}"进行视频通话。
					${char.persona || ''}
					
					【指令】
					1. **画面感**：回复中必须包含对你面部表情、动作及背景环境的描写。
					2. **格式**：**请合理分段**。
					3. **风格**：口语化，自然流畅。
					${hangupInstruction}
					【用户资料】
					${currentUserName} (${userInfo.gender || '未知'})
					${userMask}
					${wbAfter}
					${periodContext}
					${weatherContext}
					${theirDayContext}
					【记忆】\n${longTermMem}
					${lifeEvents}`;
				}
                
                const messages = [{ role: "system", content: systemPrompt }];
                
                const recentChat = (char.chatHistory || []).slice(-10).map(m => {
                    const safeContent = m.text ? m.text.substring(0, 300) : " ... ";
                    const role = m.type === 'sent' ? 'user' : 'assistant';
                    return { role: role, content: `[历史记录] ${safeContent}` };
                });
                messages.push(...recentChat);
                
                this.state.currentChatLogs.forEach(log => {
                    messages.push({ role: log.role, content: log.content });
                });

                if (isIntro) {
					const introText = this.state.callType === 'voice' 
						? `(系统提示：电话已接通。请直接开口说话，向"${currentUserName}"打个招呼。)`
						: `(系统提示：用户"${currentUserName}"接通了视频。请看着镜头，描述你现在的样子，并向他打招呼。)`;
                    messages.push({ role: "user", content: introText });
                } else if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                    messages.push({ role: "user", content: "(请继续)" });
                }

                try {
                    const settingsToUse = (char.apiSettings && char.apiSettings.baseUrl) ? char.apiSettings : chatApiSettings;
                    const response = await callOpenAiApi(messages, settingsToUse);
                    
                    if (response) {
                        let cleanText = response.replace(/^\[.*?\]/, '').trim();
                        let isHangup = false;
						
                        if (cleanText.includes('[HANGUP]')) {
                            cleanText = cleanText.replace(/\[HANGUP\]/g, '').trim();
							isHangup = true;
                        }

                        this.addBubble('ai', cleanText);

						// --- 【新增】如果是语音模式，触发 Minimax TTS 播放 ---
						if (this.state.callType === 'voice' && char.voice && char.voice.id) {
							// 自动触发语音播放
							playMinimaxTTS(cleanText, char.voice.id);
						}

						// 处理挂断逻辑
						if (isHangup) {
							console.log("AI 请求挂断电话");
                            this.addSystemMessage("对方准备挂断电话...");
							// 语音模式下，留足时间听完语音再挂断 (约每秒3字 + 1.5秒缓冲)
							let hangupDelay = 2500;
							if (this.state.callType === 'voice') {
								hangupDelay = Math.max(3000, (cleanText.length / 3) * 1000 + 1500);
							}
                            setTimeout(() => { this.handleAiHangup(); }, hangupDelay);
						}
                    }
                } catch (e) {
                    console.error("Call AI Error:", e);
                    this.addSystemMessage(`(连接中断: ${e.message})`);
                }
            },

            handleAiHangup: async function() {
                const char = characters.find(c => c.id == this.state.charId);
                if (!char) { this.cleanup(); return; }

                clearInterval(this.state.timerInterval);
                const durationText = this.dom.timerDisplay.textContent;
                this.addSystemMessage("对方已挂断，正在生成通话总结...");
                
                const logsToSave = JSON.parse(JSON.stringify(this.state.currentChatLogs));
                const timestamp = Date.now();
                let summary = "通话总结生成失败";
                
                try {
                    summary = await this.generateSummary(char, logsToSave);
                } catch (e) {}

				const typeName = this.state.callType === 'video' ? '视频' : '语音';
                const callEndMsg = {
                    type: 'received', 
                    isCallRecord: true,
                    text: `对方结束了${typeName}通话，时长 ${durationText}`,
                    timestamp: timestamp,
                    isRead: true,
                    callDuration: durationText,
                    callLogs: logsToSave,
                    summary: summary,
                };

                if (!char.chatHistory) char.chatHistory = [];
                char.chatHistory.push(callEndMsg);
                saveCharactersToLocal();

                this.cleanup();
                renderMessageToScreen(callEndMsg); 
                scrollToBottom();
                renderChatList();
            },
			
			hangup: async function() {
				const typeName = this.state.callType === 'video' ? '视频' : '语音';
				if (!confirm(`确定要挂断${typeName}通话吗？`)) return;
				const char = characters.find(c => c.id == this.state.charId);
				if (!char) { this.cleanup(); return; }
				
				clearInterval(this.state.timerInterval);
				const durationText = this.dom.timerDisplay.textContent;
				this.addSystemMessage("通话结束，正在保存记录...");
				
				const logsToSave = JSON.parse(JSON.stringify(this.state.currentChatLogs));
				const timestamp = Date.now();
				let summary = "通话总结生成失败";
				try {
					summary = await this.generateSummary(char, logsToSave);
				} catch (e) {}
				
				const callEndMsg = {
					type: 'received', // 此处沿用，让它渲染在右侧或居中
					isCallRecord: true,
					text: `${typeName}通话已结束，通话时长 ${durationText}`,
					timestamp: timestamp,
					isRead: true,
					callDuration: durationText,
					callLogs: logsToSave,
					summary: summary,
				};
				if (!char.chatHistory) char.chatHistory = [];
				char.chatHistory.push(callEndMsg);
				saveCharactersToLocal();
				this.cleanup();
			},

			generateSummary: async function(char, logs) {
				if (logs.length === 0) return "无通话内容";
				const textFlow = logs.map(l => `${l.role === 'user' ? '用户' : char.name}: ${l.content}`).join('\n');
				const typeName = this.state.callType === 'video' ? '视频' : '语音';
				const prompt = [
					{ role: "system", content: `你是一个助手，负责总结${typeName}通话内容。请简要概括这次通话发生的事情、讨论的话题以及双方的情感状态。100字以内。` },
					{ role: "user", content: `请总结以下通话记录：\n${textFlow}` }
				];
				const settingsToUse = (char.apiSettings && char.apiSettings.baseUrl) ? char.apiSettings : chatApiSettings;
				return await callOpenAiApi(prompt, settingsToUse);
			},

			cleanup: function() {
				// 【新增】清理播放中的音频
				if (typeof currentAudioPlayer !== 'undefined' && currentAudioPlayer) {
					currentAudioPlayer.pause();
					currentAudioPlayer.currentTime = 0;
					currentAudioPlayer = null;
				}

				this.state.isCalling = false;
				this.state.isMinimized = false;
				clearInterval(this.state.timerInterval);
				this.dom.page.classList.remove('active');
				this.dom.float.style.display = 'none';
				this.dom.textStream.innerHTML = '';
				this.dom.input.value = '';
				this.dom.timerDisplay.textContent = '00:00';
				if (activeChatId === this.state.charId) {
					enterChat(this.state.charId);
				}
			},

			minimize: function() {
				this.state.isMinimized = true;
				this.dom.page.classList.remove('active');
				this.dom.float.style.display = 'flex';
				switchTopBar('chat-detail-top');
			},

			restore: function() {
				this.state.isMinimized = false;
				this.dom.page.classList.add('active');
				this.dom.float.style.display = 'none';
				switchTopBar(null);
			},

			showLogDetails: function(callMsg) {
				const modal = document.getElementById('call-log-modal');
				const list = document.getElementById('call-log-detail-list');
				list.innerHTML = '';

				if (callMsg.summary) {
					const summaryDiv = document.createElement('div');
					summaryDiv.style.cssText = "padding: 10px; margin-bottom: 15px; background-color: #f9f9f9; border-radius: 6px; font-size: 14px; color: #333; position: relative; border-left: 4px solid #07c160;";
					const headerHtml = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;"><strong style="color:#07c160;">通话总结</strong><button id="edit-summary-btn" style="border:none; background:transparent; color:#576b95; cursor:pointer; font-size:12px;"><i class="fas fa-edit"></i> 编辑</button></div>`;
					const contentHtml = `<div id="summary-content-text" style="white-space: pre-wrap; line-height: 1.5;">${callMsg.summary}</div>`;
					summaryDiv.innerHTML = headerHtml + contentHtml;
					list.appendChild(summaryDiv);

					setTimeout(() => {
						const editBtn = document.getElementById('edit-summary-btn');
						if (editBtn) {
							editBtn.onclick = () => {
								this.openSharedEditModal(callMsg.summary, (newSummary) => {
									callMsg.summary = newSummary;
									saveCharactersToLocal();
									const contentEl = document.getElementById('summary-content-text');
									if (contentEl) contentEl.textContent = newSummary;
								});
							};
						}
					}, 0);
				}

				if (callMsg.callLogs && callMsg.callLogs.length > 0) {
					callMsg.callLogs.forEach(log => {
						const item = document.createElement('div');
						item.className = `call-log-bubble ${log.role === 'user' ? 'user' : 'ai'}`;
						const date = new Date(log.timestamp);
						const timeStr = `${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`;
						const roleName = log.role === 'user' ? '我' : '对方';
						item.innerHTML = `<span class="call-log-timestamp">${roleName} ${timeStr}</span><div>${log.content.replace(/\n/g, '<br>')}</div>`;
						list.appendChild(item);
					});
				} else {
					list.innerHTML += '<div style="text-align:center; padding:20px; color:#999;">无详细记录</div>';
				}

				modal.classList.add('show');
			},
		};
		
		// ============================================================
		// 【最终修复】全局强制绑定视频通话事件监听
		// ============================================================
		document.addEventListener('DOMContentLoaded', () => {

			// 1. 强制绑定【缩小】按钮
			const minimizeBtn = document.getElementById('call-minimize-btn');
			if (minimizeBtn) {
				minimizeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					// 直接调用 VideoCallSystem 上的方法
					if (typeof VideoCallSystem !== 'undefined' && VideoCallSystem.minimize) {
						VideoCallSystem.minimize();
					} else {
						console.error("VideoCallSystem.minimize() not found!");
					}
				});
			} else {
				console.error("无法找到缩小按钮 #call-minimize-btn");
			}

			// 2. 强制绑定【悬浮窗恢复】按钮
			const floatWindow = document.getElementById('mini-call-float');
			if (floatWindow) {
				floatWindow.addEventListener('click', () => {
					if (typeof VideoCallSystem !== 'undefined' && VideoCallSystem.restore) {
						VideoCallSystem.restore();
					} else {
						console.error("VideoCallSystem.restore() not found!");
					}
				});
			}

			// 3. 强制绑定【挂断】按钮
			const hangupBtn = document.getElementById('call-hangup-btn');
			if (hangupBtn) {
				hangupBtn.addEventListener('click', () => {
					if (typeof VideoCallSystem !== 'undefined' && VideoCallSystem.hangup) {
						VideoCallSystem.hangup();
					}
				});
			}

			// 4. 强制绑定【发送】按钮和输入框回车
			const callSendBtn = document.getElementById('call-send-btn');
			const callInput = document.getElementById('call-input-text');
			if (callSendBtn && callInput) {
				callSendBtn.addEventListener('click', () => {
					if (typeof VideoCallSystem !== 'undefined' && VideoCallSystem.handleUserSend) {
						VideoCallSystem.handleUserSend();
					}
				});
				callInput.addEventListener('keypress', (e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						if (typeof VideoCallSystem !== 'undefined' && VideoCallSystem.handleUserSend) {
							VideoCallSystem.handleUserSend();
						}
					}
				}); // [修复点：正确闭合 keypress 回调]
			} // [修复点：正确闭合 if]

			// 5. 强制绑定【关闭通话记录】弹窗
			const closeLogBtn = document.getElementById('close-call-log-btn');
			if (closeLogBtn) {
				closeLogBtn.addEventListener('click', () => {
					const logModal = document.getElementById('call-log-modal');
					if (logModal) {
						logModal.classList.remove('show');
					}
				});
			}

			// ============================================================
			// 【修复版】钱包系统、转账红包与文件编辑核心逻辑
			// ============================================================

			// --- 1. 钱包页面渲染与导航 ---
			const walletPageBtn = document.getElementById('my-wallet-btn'); 
			const walletBackBtn = document.getElementById('wallet-back-btn');

			if (walletPageBtn) {
				const newWalletBtn = walletPageBtn.cloneNode(true);
				walletPageBtn.parentNode.replaceChild(newWalletBtn, walletPageBtn);
				
				newWalletBtn.addEventListener('click', () => {
					renderWalletPage();
					switchPage('wallet-page');
					switchTopBar(null); // 传入 null 隐藏所有的 TopBar
				});
			}

			if (walletBackBtn) {
				walletBackBtn.addEventListener('click', () => {
					switchPage('me-page');
					switchTopBar('');
				});
			}

			function renderWalletPage() {
				document.getElementById('wallet-balance-val').textContent = walletData.balance.toFixed(2);
				const listContainer = document.getElementById('transaction-list-container');
				listContainer.innerHTML = '';

				if (walletData.transactions.length === 0) {
					listContainer.innerHTML = '<div style="text-align:center; padding: 40px; color: #999;">暂无交易记录</div>';
					return;
				}

				// 倒序展示
				const sortedTrans = [...walletData.transactions].sort((a, b) => b.timestamp - a.timestamp);
				sortedTrans.forEach(t => {
					const timeStr = getChatHistoryTime(t.timestamp);
					const sign = t.amount >= 0 ? '+' : '';
					const colorClass = t.amount >= 0 ? 'positive' : 'negative';
					
					listContainer.innerHTML += `
						<div class="transaction-item">
							<div class="trans-left">
								<div class="trans-desc">${t.desc}</div>
								<div class="trans-time">${timeStr}</div>
							</div>
							<div class="trans-right ${colorClass}">${sign}${t.amount.toFixed(2)}</div>
						</div>
					`;
				});
			}

			// --- 2. 发起转账/红包交互 ---
			let currentPaymentType = 'transfer'; 

			const btnTransfer = document.getElementById('btn-func-transfer');
			if (btnTransfer) {
				const newBtn = btnTransfer.cloneNode(true);
				btnTransfer.parentNode.replaceChild(newBtn, btnTransfer);
				newBtn.addEventListener('click', () => {
					openSendPaymentModal('transfer');
				});
			}

			const btnRedpacket = document.getElementById('btn-func-redpacket');
			if (btnRedpacket) {
				const newBtn = btnRedpacket.cloneNode(true);
				btnRedpacket.parentNode.replaceChild(newBtn, btnRedpacket);
				newBtn.addEventListener('click', () => {
					openSendPaymentModal('redpacket');
				});
			}

			function openSendPaymentModal(type) {
				const funcPanel = document.getElementById('function-panel-modal');
				if (funcPanel) funcPanel.classList.remove('show');

				currentPaymentType = type;
				const modal = document.getElementById('send-payment-modal');
				const title = document.getElementById('send-payment-title');
				const btn = document.getElementById('confirm-payment-btn');
				const descInput = document.getElementById('send-payment-desc');

				title.textContent = type === 'transfer' ? '发起转账' : '发红包';
				btn.style.backgroundColor = type === 'transfer' ? '#fa9d3b' : '#f0614d';
				descInput.placeholder = type === 'transfer' ? '添加备注 (如：转账给你)' : '恭喜发财，大吉大利';
				
				document.getElementById('current-balance-display').textContent = walletData.balance.toFixed(2);
				document.getElementById('send-payment-amount').value = '';
				descInput.value = '';

				modal.classList.add('show');
			}

			// [新增修复] 取消和确认发送的逻辑 (增加 ?. 防止找不到元素报错)
			document.getElementById('cancel-payment-btn')?.addEventListener('click', () => {
				document.getElementById('send-payment-modal')?.classList.remove('show');
			});

			document.getElementById('confirm-payment-btn')?.addEventListener('click', () => {
				const amount = parseFloat(document.getElementById('send-payment-amount').value);
				if (isNaN(amount) || amount <= 0) {
					alert('请输入正确的金额！');
					return;
				}
				if (amount > walletData.balance) {
					alert('余额不足！');
					return;
				}

				const descInput = document.getElementById('send-payment-desc').value.trim();
				const desc = descInput || (currentPaymentType === 'transfer' ? '转账给你' : '恭喜发财，大吉大利');

				// 【修复】获取当前角色名字
				let charName = "角色";
				if (activeChatId) {
					const char = characters.find(c => c.id == activeChatId);
					if (char) charName = char.name;
				}

				// 扣除余额并记录交易 (加上角色名)
				const payId = 'pay_' + Date.now();
				addTransaction(-amount, `发给${charName}${currentPaymentType === 'transfer' ? '转账' : '红包'}`, payId);

				// 隐藏弹窗
				document.getElementById('send-payment-modal')?.classList.remove('show');

				// 保存消息到聊天记录
				if (typeof window.savePaymentMessage === 'function') {
					window.savePaymentMessage(amount, desc, currentPaymentType, 'sent', activeChatId, payId);
				}
			});

			// --- 保存支付消息并触发AI ---
			window.savePaymentMessage = function(amount, desc, paymentType, msgType, charId, predefinedPayId = null) {
				const char = characters.find(c => c.id == charId);
				if (!char) return;

				const paymentId = predefinedPayId || ('pay_' + Date.now());
				const newMsg = {
					text: `[${paymentType === 'transfer' ? '转账' : '红包'}：${amount}元]`,
					type: msgType,
					timestamp: Date.now(),
					isRead: true,
					isPayment: true,
					paymentType: paymentType,
					amount: amount,
					paymentDesc: desc,
					paymentState: 'pending', 
					paymentId: paymentId
				};

				if (!char.chatHistory) char.chatHistory = [];
				char.chatHistory.push(newMsg);
				saveCharactersToLocal();

				if (activeChatId === charId) {
					renderMessageToScreen(newMsg);
					scrollToBottom();
				}
				renderChatList();
			};

			async function triggerAiPaymentResponse(charId, paymentMsg) {
				const char = characters.find(c => c.id == charId);
				if (!char) return;

				const paymentInstruction = `
				系统提示：用户刚刚给你发送了一个【${paymentMsg.paymentType === 'transfer' ? 'NN转账' : 'NN红包'}】，金额为 ${paymentMsg.amount} 元，备注是：“${paymentMsg.paymentDesc}”。
				请在回复中表现出你收到钱的反应，并**必须**在回复末尾附带指令决定是否收下这笔钱：
				收下请加：[ACCEPT_PAY:${paymentMsg.paymentId}]
				退还请加：[REJECT_PAY:${paymentMsg.paymentId}]
				`;

				const messages = prepareMessagesForApi(char);
				messages.push({ role: "user", content: paymentInstruction }); // 使用 user 角色发送指令，防止 400 错误

				updateChatStatus(charId, "对方正在输入中…");

				try {
					const settingsToUse = (char.apiSettings && char.apiSettings.baseUrl) ? char.apiSettings : chatApiSettings;
					const responseText = await callOpenAiApi(messages, settingsToUse);

					let cleanText = responseText;
					let actionType = 'ACCEPT_PAY';
					let payId = paymentMsg.paymentId;

					if (cleanText.includes(`[ACCEPT_PAY:${payId}]`)) {
						actionType = 'ACCEPT_PAY';
						cleanText = cleanText.replace(`[ACCEPT_PAY:${payId}]`, '').trim();
					} else if (cleanText.includes(`[REJECT_PAY:${payId}]`)) {
						actionType = 'REJECT_PAY';
						cleanText = cleanText.replace(`[REJECT_PAY:${payId}]`, '').trim();
					}

					cleanText = cleanText.replace(/\[.*?\]/g, '').trim();
					
					// 如果 AI 返回文本包含换行，可能被误判，我们确保清理彻底
					if (cleanText.includes('NN_INNER_STATUS::')) {
						cleanText = cleanText.substring(0, cleanText.lastIndexOf('NN_INNER_STATUS::')).trim();
					}

					window.processAiPaymentAction(charId, payId, actionType);

					if (cleanText) {
						saveAiMessageInternal(cleanText, charId, 'round_' + Date.now(), null, false);
					}

				} catch (error) {
					console.error("AI 处理转账出错:", error);
				} finally {
					updateChatStatus(charId, false);
				}
					
				
			}

			// --- 3. AI 处理我发出的转账/红包 ---
			window.processAiPaymentAction = function(charId, payId, actionType) {
				const char = characters.find(c => c.id == charId);
				if (!char || !char.chatHistory) return;

				const msg = char.chatHistory.find(m => m.paymentId === payId && m.type === 'sent');
				if (!msg || msg.paymentState !== 'pending') return;

				if (actionType === 'ACCEPT_PAY') {
					msg.paymentState = 'accepted';
				} else if (actionType === 'REJECT_PAY') {
					msg.paymentState = 'rejected';
					addTransaction(msg.amount, `角色退还${msg.paymentType === 'transfer' ? '转账' : '红包'}`, payId);
				}

				saveCharactersToLocal();

				if (activeChatId === charId) {
					const row = document.getElementById(`row-${msg.timestamp}`);
					if (row) row.outerHTML = generateMessageHTML(msg, false); 
				}
			}

			// ============================================================
			// 收款弹窗交互与详情页逻辑
			// ============================================================
			let currentInteractPaymentId = null;

			window.handlePaymentClick = function(event, timestamp) {
				event.stopPropagation();
				if(typeof closeAllBubbleMenus === 'function') closeAllBubbleMenus();

				const char = characters.find(c => c.id == activeChatId);
				if (!char || !char.chatHistory) return;

				const msg = char.chatHistory.find(m => m.timestamp == timestamp);
				if (!msg) return;

				// 如果是我发出的，只提示状态
				if (msg.type === 'sent') {
					let statusText = "等待对方接收中...";
					if (msg.paymentState === 'accepted') statusText = "对方已接收";
					if (msg.paymentState === 'rejected') statusText = "对方已退还";
					alert(statusText);
					return;
				}

				if (msg.type === 'received') {
					// 转账：处理被退还的情况
					if (msg.paymentType === 'transfer' && msg.paymentState === 'rejected') {
						alert("你已退还此款项。");
						return;
					}

					currentInteractPaymentId = msg.paymentId;
					const modal = document.getElementById('receive-payment-modal');
					
					const rpContainer = document.getElementById('rp-ui-container'); // 未拆红包
					const rpOpenedContainer = document.getElementById('rp-opened-container'); // 已拆红包详情
					const tfContainer = document.getElementById('tf-ui-container'); // 转账

					// 初始隐藏所有
					if (rpContainer) rpContainer.style.display = 'none';
					if (rpOpenedContainer) rpOpenedContainer.style.display = 'none';
					if (tfContainer) tfContainer.style.display = 'none';

					// 【核心修复：智能识别发送者的身份（兼容群聊）】
					const actualSenderName = (msg.isGroupMsg && msg.senderName) ? msg.senderName : char.name;
					const senderNameText = actualSenderName + (msg.paymentType === 'transfer' ? '的转账' : '的红包');
					
					const actualAvatar = (msg.isGroupMsg && msg.senderAvatar) ? msg.senderAvatar : char.avatar;
					const charAvatarHtml = actualAvatar ? `<img src="${actualAvatar}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-user"></i>`;
					const descText = msg.paymentDesc || '恭喜发财，大吉大利';

					if (msg.paymentType === 'redpacket') {
						// === 1. 红包逻辑 ===
						if (msg.paymentState === 'accepted') {
							// 已经领过了，直接显示详情页，展示金额
							if (rpOpenedContainer) rpOpenedContainer.style.display = 'flex';
							document.getElementById('rp-opened-avatar').innerHTML = charAvatarHtml;
							document.getElementById('rp-opened-name').textContent = senderNameText;
							document.getElementById('rp-opened-desc').textContent = descText;
							document.getElementById('rp-opened-amount-val').textContent = parseFloat(msg.amount).toFixed(2);
						} else {
							// 还没领，显示“開”的界面
							if (rpContainer) rpContainer.style.display = 'flex';
							document.getElementById('rp-sender-avatar').innerHTML = charAvatarHtml;
							document.getElementById('rp-sender-name').textContent = senderNameText;
							document.getElementById('rp-desc').textContent = descText;
							
							// 重置開按钮动画
							const openBtn = document.getElementById('rp-open-btn');
							if (openBtn) openBtn.classList.remove('spin-anim');
						}
					} else {
						// === 2. 转账逻辑 ===
						if (msg.paymentState === 'accepted') {
							alert("你已领取过此转账。");
							return;
						}
						if (tfContainer) tfContainer.style.display = 'flex';
						document.getElementById('tf-amount').textContent = parseFloat(msg.amount).toFixed(2);
						document.getElementById('tf-desc').textContent = msg.paymentDesc || '转账给你';
					}

					if (modal) modal.classList.add('show');
				}
			};

			// --- 弹窗按钮事件绑定 (带防呆检查) ---
			
			// 1. 关闭未拆的红包弹窗
			document.getElementById('rp-close-btn')?.addEventListener('click', () => {
				document.getElementById('receive-payment-modal')?.classList.remove('show');
			});

			// 2. 关闭已拆详情的红包弹窗
			document.getElementById('rp-opened-close-btn')?.addEventListener('click', () => {
				document.getElementById('receive-payment-modal')?.classList.remove('show');
			});

			// 3. 点击“開”红包动画与入账逻辑
			document.getElementById('rp-open-btn')?.addEventListener('click', function() {
				if (!currentInteractPaymentId || !activeChatId) return;
				
				// 开启金币旋转动画
				this.classList.add('spin-anim');
				
				// 模拟拆红包的短暂延迟
				setTimeout(() => {
					// 隐藏未拆开界面
					const rpContainer = document.getElementById('rp-ui-container');
					if (rpContainer) rpContainer.style.display = 'none';
					
					// 显示详情界面
					const rpOpenedContainer = document.getElementById('rp-opened-container');
					if (rpOpenedContainer) rpOpenedContainer.style.display = 'flex';
					
					// 填充详情界面的金额数据
					const char = characters.find(c => c.id == activeChatId);
					const msg = char.chatHistory.find(m => m.paymentId === currentInteractPaymentId);
					if (msg) {
						document.getElementById('rp-opened-amount-val').textContent = parseFloat(msg.amount).toFixed(2);
						const charAvatarHtml = char.avatar ? `<img src="${char.avatar}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-user"></i>`;
						document.getElementById('rp-opened-avatar').innerHTML = charAvatarHtml;
						document.getElementById('rp-opened-name').textContent = char.name + '的红包';
						document.getElementById('rp-opened-desc').textContent = msg.paymentDesc || '恭喜发财，大吉大利';

						// 真正执行入账操作（但不关闭弹窗，让用户看余额）
						completeUserPaymentAction('accepted', false); 
					}
				}, 800); // 0.8秒后开出
			});

			// 4. 转账：收下
			document.getElementById('tf-accept-btn')?.addEventListener('click', () => {
				completeUserPaymentAction('accepted', true); // 收下转账，直接关闭弹窗
			});

			// 5. 转账：退还
			document.getElementById('tf-reject-btn')?.addEventListener('click', () => {
				completeUserPaymentAction('rejected', true);
			});

			// --- 执行收钱/退钱核心函数 ---
			// 增加一个 closeModal 参数，红包因为要看详情，所以传 false 不关闭
			function completeUserPaymentAction(state, closeModal = true) {
				if (closeModal) {
					document.getElementById('receive-payment-modal')?.classList.remove('show');
				}
				
				if (!currentInteractPaymentId || !activeChatId) return;

				const char = characters.find(c => c.id == activeChatId);
				const msg = char.chatHistory.find(m => m.paymentId === currentInteractPaymentId);
				if (!msg) return;

				msg.paymentState = state;
				
				// 写入钱包流水
				const typeName = msg.paymentType === 'transfer' ? '转账' : '红包';
				if (state === 'accepted') {
					addTransaction(msg.amount, `收到${char.name}${typeName}`, msg.paymentId);
				} else {
					addTransaction(0, `已退还${char.name}${typeName}`, msg.paymentId);
				}

				// 【核心修正：后台记录给 AI，不生成UI气泡】
				const actualSenderName = (msg.isGroupMsg && msg.senderName) ? msg.senderName : char.name;
				const systemInstruction = state === 'accepted' 
					? `[系统记录：用户收下了 ${actualSenderName} 发送的 ${msg.amount} 元${typeName}]` 
					: `[系统记录：用户退还了 ${actualSenderName} 发送的 ${msg.amount} 元${typeName}]`;

				char.chatHistory.push({
					text: systemInstruction,
					type: 'system',
					isHidden: true,
					relatedPayId: msg.paymentId, // 关键：在这里埋入关联 ID
					timestamp: Date.now()
				});

				// 保存数据并重新渲染当前消息卡片（改变颜色和“已被领取”字样）
				saveCharactersToLocal();
				const row = document.getElementById(`row-${msg.timestamp}`);
				if (row) row.outerHTML = generateMessageHTML(msg, false);

				// 如果点击的是转账（需要立刻结束的），把 ID 置空；如果是红包还要看详情，暂时不置空
				if (closeModal) {
					currentInteractPaymentId = null;
				}
			}

			// ============================================================
			// --- 5. 文件消息独立编辑逻辑 ---
			// ============================================================
			let currentEditingFileMsgId = null;

			const originalHandleMenuAction = handleMenuAction;
			handleMenuAction = function(action, msgId) {
				if (action === 'edit') {
					const char = characters.find(c => c.id == activeChatId);
					const msgObj = char.chatHistory.find(m => m.timestamp == msgId);
					
					const isFileMatch = msgObj && msgObj.text && !msgObj.isVirtual && !msgObj.image && !msgObj.isVoice ? msgObj.text.match(/^\[文件：(.*?)\.(.*?)\|(.*?)\]$/s) || msgObj.text.match(/^\[文件：(.*?)\|(.*?)\]$/s) : null;
					
					if (isFileMatch) {
						event.stopPropagation();
						closeAllBubbleMenus();
						
						currentEditingFileMsgId = msgId;
						let name = isFileMatch[1];
						let ext = '';
						let desc = '';
						
						if (isFileMatch.length === 4) { 
							ext = isFileMatch[2];
							desc = isFileMatch[3];
						} else { 
							const parts = name.split('.');
							if (parts.length > 1) {
								ext = parts.pop();
								name = parts.join('.');
							}
							desc = isFileMatch[2];
						}

						document.getElementById('edit-file-name').value = name;
						document.getElementById('edit-file-ext').value = ext;
						document.getElementById('edit-file-desc').value = desc;
						
						document.getElementById('edit-file-modal').classList.add('show');
						return; 
					}
				}
				originalHandleMenuAction.apply(this, arguments);
			};

			document.getElementById('cancel-edit-file-btn').addEventListener('click', () => {
				document.getElementById('edit-file-modal').classList.remove('show');
				currentEditingFileMsgId = null;
			});

			document.getElementById('confirm-edit-file-btn').addEventListener('click', () => {
				if (!currentEditingFileMsgId || !activeChatId) return;
				
				let name = document.getElementById('edit-file-name').value.trim() || '未命名文档';
				let ext = document.getElementById('edit-file-ext').value.trim() || 'txt';
				let desc = document.getElementById('edit-file-desc').value.trim();

				if (!desc) { alert('描述不能为空'); return; }
				ext = ext.replace(/^\.+/, '');

				const char = characters.find(c => c.id == activeChatId);
				if (char && char.chatHistory) {
					const msg = char.chatHistory.find(m => m.timestamp == currentEditingFileMsgId);
					if (msg) {
						msg.text = `[文件：${name}.${ext}|${desc}]`;
						saveCharactersToLocal();
						
						const row = document.getElementById(`row-${currentEditingFileMsgId}`);
						if (row) row.outerHTML = generateMessageHTML(msg, false);
					}
				}

				document.getElementById('edit-file-modal').classList.remove('show');
				currentEditingFileMsgId = null;
			});		

		}); 
		
		// ============================================================
		// 【新增】聊天记录搜索系统
		// ============================================================

		const chatSearchBtn = document.getElementById('chat-search-btn');
		const chatSearchBackBtn = document.getElementById('chat-search-back-btn');
		const chatSearchInput = document.getElementById('chat-search-input');
		const chatSearchResults = document.getElementById('chat-search-results');
		const chatSearchClear = document.getElementById('chat-search-clear');

		// 1. 打开搜索页面
		if (chatSearchBtn) {
			chatSearchBtn.addEventListener('click', () => {
				// 重置界面
				chatSearchInput.value = '';
				chatSearchResults.innerHTML = '<div style="text-align:center; color:#999; margin-top:50px;">输入关键字搜索记录</div>';
				chatSearchClear.style.display = 'none';
				
				switchPage('chat-search-page');
				switchTopBar('chat-search-top');
				
				// 延迟聚焦拉起键盘
				setTimeout(() => {
					chatSearchInput.focus();
				}, 300);
			});
		}

		// 2. 返回聊天页面
		if (chatSearchBackBtn) {
			chatSearchBackBtn.addEventListener('click', () => {
				switchPage('chat-detail-page');
				switchTopBar('chat-detail-top');
			});
		}

		// 3. 监听输入框搜索
		if (chatSearchInput) {
			// 使用 input 事件实时搜索
			chatSearchInput.addEventListener('input', (e) => {
				const keyword = e.target.value.trim();
				
				// 控制清除按钮的显示
				if (keyword.length > 0) {
					chatSearchClear.style.display = 'block';
				} else {
					chatSearchClear.style.display = 'none';
					chatSearchResults.innerHTML = '<div style="text-align:center; color:#999; margin-top:50px;">输入关键字搜索记录</div>';
					return;
				}

				performChatSearch(keyword);
			});
		}

		// 4. 清除输入框
		if (chatSearchClear) {
			chatSearchClear.addEventListener('click', () => {
				chatSearchInput.value = '';
				chatSearchClear.style.display = 'none';
				chatSearchResults.innerHTML = '<div style="text-align:center; color:#999; margin-top:50px;">输入关键字搜索记录</div>';
				chatSearchInput.focus();
			});
		}

		// 5. 执行搜索核心逻辑
		function performChatSearch(keyword) {
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.chatHistory) return;

			// 过滤聊天记录
			const results = char.chatHistory.filter(msg => {
				// 排除隐藏信息、通话记录和空文本
				if (msg.isHidden || msg.isCallRecord || !msg.text) return false;
				// 排除表情包和虚拟图片占位符
				if (msg.isVirtual || (msg.image && !msg.text.startsWith('[表情包：'))) return false;
				
				// 忽略大小写匹配
				return msg.text.toLowerCase().includes(keyword.toLowerCase());
			});

			if (results.length === 0) {
				chatSearchResults.innerHTML = '<div style="text-align:center; color:#999; margin-top:50px;">没有找到相关的聊天记录</div>';
				return;
			}

			// 将结果倒序（最新的在最上面）
			results.reverse();

			let html = '';
			results.forEach(msg => {
				// 判断发送者信息 (兼容群聊)
				let senderName = '';
				let senderAvatarHtml = '';
				
				if (msg.type === 'sent') {
					senderName = (char.userName && char.userName.trim()) ? char.userName.trim() : userInfo.name;
					senderAvatarHtml = char.userAvatar 
						? `<img src="${char.userAvatar}">` 
						: (userInfo.avatar ? `<img src="${userInfo.avatar}">` : `<i class="${userInfo.avatarIcon || 'fas fa-user'}"></i>`);
				} else {
					senderName = (msg.isGroupMsg && msg.senderName) ? msg.senderName : char.name;
					const actualAvatar = (msg.isGroupMsg && msg.senderAvatar) ? msg.senderAvatar : char.avatar;
					senderAvatarHtml = actualAvatar ? `<img src="${actualAvatar}">` : `<i class="fas fa-user"></i>`;
				}

				const timeStr = getChatHistoryTime(msg.timestamp);

				// 处理关键字高亮 (防止 XSS 攻击)
				let displayRawText = formatTextForDisplay(msg.text); // 转义HTML防止注入
				// 正则替换高亮，忽略大小写
				const highlightRegex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
				const highlightedText = displayRawText.replace(highlightRegex, '<span class="highlight-text">$1</span>');

				html += `
					<div class="search-result-item" onclick="jumpToChatContext(${msg.timestamp})">
						<div class="search-result-avatar">${senderAvatarHtml}</div>
						<div class="search-result-content">
							<div class="search-result-header">
								<span class="search-result-name">${senderName}</span>
								<span class="search-result-time">${timeStr}</span>
							</div>
							<div class="search-result-text">${highlightedText}</div>
						</div>
					</div>
				`;
			});

			chatSearchResults.innerHTML = html;
		}
		// 6. 【新增】点击引用卡片跳转到原消息
		window.jumpToQuotedMessage = function(event, targetTimestamp) {
			if (event) {
				event.stopPropagation(); // 阻止冒泡，防止触发气泡操作菜单
			}
			
			const targetRow = document.getElementById(`row-${targetTimestamp}`);
			
			if (targetRow) {
				// 如果原消息已经在当前 DOM 中，直接平滑滚动到它并加上呼吸高亮闪烁
				targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
				targetRow.classList.add('msg-highlight-anim');
				setTimeout(() => {
					targetRow.classList.remove('msg-highlight-anim');
				}, 2000);
			} else {
				// 如果已经被下拉刷新折叠了（不在 DOM 中），询问是否重新加载上下文
				if (confirm("原消息处于较早的历史记录中，需要重新加载上下文吗？")) {
					// 完美复用下面已有的搜索跳转上下文逻辑
					window.jumpToChatContext(targetTimestamp);
				}
			}
		};
		// 7. 点击跳转到上下文逻辑
		window.jumpToChatContext = function(targetTimestamp) {
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.chatHistory) return;

			// 找到目标消息在数组中的索引
			const targetIndex = char.chatHistory.findIndex(m => m.timestamp == targetTimestamp);
			if (targetIndex === -1) return;

			// A. 切换回聊天页面
			switchPage('chat-detail-page');
			switchTopBar('chat-detail-top');

			// B. 清空当前容器，重新计算渲染范围
			const msgContainer = document.getElementById('chat-message-container');
			const scrollParent = document.getElementById('main-content-area');
			msgContainer.innerHTML = '';
			removeLoader(); // 移除现有的下拉加载器
			
			// 逻辑：渲染从 (目标 - 15条) 直到 最新 的所有消息。这样既能看到上文，也能看到后续内容
			let startIndex = Math.max(0, targetIndex - 15);
			const totalMsgs = char.chatHistory.length;
			
			// 获取需要渲染的数据切片
			const batchData = char.chatHistory.slice(startIndex, totalMsgs);
			
			let batchHtml = '';
			let tempLastTime = startIndex > 0 ? char.chatHistory[startIndex - 1].timestamp : 0;

			// 生成 HTML
			batchData.forEach((msg, index) => {
				let showTime = false;
				if (index === 0 || (msg.timestamp - tempLastTime > 300000)) showTime = true;
				batchHtml += generateMessageHTML(msg, showTime);
				tempLastTime = msg.timestamp;
			});

			// 插入 DOM
			msgContainer.innerHTML = batchHtml;
			
			// 同步渲染计数器，确保向上滑动能继续加载旧记录
			currentRenderedCount = totalMsgs - startIndex;
			checkLoaderState(totalMsgs); // 检查是否需要添加下拉提示

			// C. 滚动到目标元素，并添加闪烁动画
			// 需要短暂延迟，确保 DOM 已经渲染并且图片占位符已生效
			setTimeout(() => {
				const targetRow = document.getElementById(`row-${targetTimestamp}`);
				if (targetRow) {
					// 平滑滚动到视口中央
					targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
					
					// 添加高亮闪烁 CSS 类
					targetRow.classList.add('msg-highlight-anim');
					
					// 动画播放完毕后移除类，防止再次滚动过来时继续闪
					setTimeout(() => {
						targetRow.classList.remove('msg-highlight-anim');
					}, 2000);
				}
			}, 150);
		};
		// ============================================================
		// 【新增】其他API设置逻辑
		// ============================================================
		const otherApiSettingBtn = document.getElementById('other-api-setting-btn');
		const otherApiSettingTopBack = document.querySelector('#other-api-setting-top .top-bar-back');
		const otherApiSaveBtn = document.getElementById('other-api-save-btn');
		const otherApiUrlInput = document.getElementById('other-api-url-input');
		const otherApiKeyInput = document.getElementById('other-api-key-input');
		const otherModelSelect = document.getElementById('other-model-select');
		const otherApiTempInput = document.getElementById('other-api-temp-input');
		const otherFetchModelsBtn = document.getElementById('other-fetch-models-btn');

		if (otherApiSettingBtn) {
			otherApiSettingBtn.addEventListener('click', () => {
				otherApiUrlInput.value = otherApiSettings.baseUrl || '';
				otherApiKeyInput.value = otherApiSettings.apiKey || '';
				otherApiTempInput.value = otherApiSettings.temperature || '';
				if (otherApiSettings.model) {
					otherModelSelect.innerHTML = `<option value="${otherApiSettings.model}" selected>${otherApiSettings.model}</option>`;
				} else {
					otherModelSelect.innerHTML = `<option value="">请先拉取或手动输入</option>`;
				}
				populatePresetDropdown();
				switchPage('other-api-setting-page');
				switchTopBar('other-api-setting-top');
			});
		}
		if (otherApiSettingTopBack) {
			otherApiSettingTopBack.addEventListener('click', () => {
				switchPage('contact-page');
				switchTopBar('contact-top');
			});
		}
		if (otherApiSaveBtn) {
			otherApiSaveBtn.addEventListener('click', () => {
				otherApiSettings.baseUrl = otherApiUrlInput.value.trim();
				otherApiSettings.apiKey = otherApiKeyInput.value.trim();
				otherApiSettings.model = otherModelSelect.value;
				const tempVal = parseFloat(otherApiTempInput.value);
				otherApiSettings.temperature = isNaN(tempVal) ? '' : tempVal;
				saveOtherApiSettingsToLocal();
				alert('其他API设置已保存！');
				otherApiSettingTopBack.click();
			});
		}
		if (otherFetchModelsBtn) {
			otherFetchModelsBtn.addEventListener('click', () => {
				fetchModelsForApi(otherApiUrlInput, otherApiKeyInput, otherModelSelect, otherFetchModelsBtn, otherApiSettings);
			});
		}

		// ============================================================
		// 【新增】购物/外卖页面逻辑
		// ============================================================
		const shoppingEntryBtn = document.getElementById('shopping-entry-btn');
		const shoppingTopBack = document.querySelector('#shopping-top .top-bar-back');
		let currentShopMode = 'shopping'; // 'shopping' 或 'delivery'

		if (shoppingEntryBtn) {
			shoppingEntryBtn.addEventListener('click', () => {
				switchPage('shopping-page');
				switchTopBar('shopping-top');
			});
		}

		if (shoppingTopBack) {
			shoppingTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		// Tab 切换逻辑
		const shopTabs = document.querySelectorAll('.shop-tab');
		shopTabs.forEach(tab => {
			tab.addEventListener('click', (e) => {
				shopTabs.forEach(t => t.classList.remove('active'));
				e.target.classList.add('active');
				currentShopMode = e.target.dataset.mode;
				// 切换Tab后清空并修改提示
				const container = document.getElementById('shopping-result-container');
				const modeText = currentShopMode === 'shopping' ? '商品' : '外卖';
				container.innerHTML = `
					<div class="shop-empty-state">
						<i class="fas ${currentShopMode === 'shopping' ? 'fa-store' : 'fa-hamburger'}"></i>
						<p>输入关键词，让AI为你生成专属${modeText}列表</p>
					</div>
				`;
			});
		});

		// 生成逻辑
		const shopGenerateBtn = document.getElementById('shop-generate-btn');
		if (shopGenerateBtn) {
			shopGenerateBtn.addEventListener('click', async () => {
				const keyword = document.getElementById('shop-keyword-input').value.trim();
				if (!keyword) {
					alert("请输入想要搜索的关键词！");
					return;
				}
				
				const minPrice = document.getElementById('shop-min-price').value.trim() || '不限';
				const maxPrice = document.getElementById('shop-max-price').value.trim() || '不限';
				const modeText = currentShopMode === 'shopping' ? '电商购物商品' : '外卖美食菜品';

				// 决定使用哪个 API
				const useSettings = (otherApiSettings && otherApiSettings.apiKey && otherApiSettings.baseUrl) ? otherApiSettings : chatApiSettings;

				if (!useSettings.apiKey) {
					alert("请先配置聊天API或专属的其他API！");
					return;
				}

				// 锁定按钮 UI
				shopGenerateBtn.disabled = true;
				shopGenerateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 搜索中';
				
				const container = document.getElementById('shopping-result-container');
				container.innerHTML = `
					<div style="text-align:center; padding: 40px; color:#888;">
						<i class="fas fa-spinner fa-spin" style="font-size:30px; margin-bottom:10px;"></i>
						<p>AI正在全网搜罗${keyword}...</p>
					</div>
				`;

				const systemPrompt = `
				你是一个虚拟${modeText}平台的数据生成器。
				用户的搜索词是：“${keyword}”。
				用户的期望价格区间是：${minPrice} 到 ${maxPrice}。
				
				【任务】
				请发挥创造力，为用户生成 4 到 6 个符合条件的虚拟${modeText}。
				
				【输出格式】
				必须且仅输出严格的 JSON 格式数据（不要带 markdown 标记，不要有任何其他说明文本），结构如下：
				{
					"items":[
						{
							"title": "商品/菜品名称",
							"description": "吸引人的简短描述卖点",
							"price": 88.5,
							"imageDesc": "一张展示该商品的图片描述，如：一份热气腾腾的炸鸡",
							"comments":[
								{"user": "买家A", "content": "味道很不错，好评！"},
								{"user": "买家B", "content": "有点贵，但质量可以。"}
							]
						}
					]
				}
				`;

				try {
					const responseText = await callOpenAiApi([
						{ role: "system", content: systemPrompt },
						{ role: "user", content: "请生成数据。" }
					], useSettings);

					// 解析 JSON
					const jsonMatch = responseText.match(/\{[\s\S]*\}/);
					if (!jsonMatch) throw new Error("API未返回有效的JSON格式");
					
					const data = JSON.parse(jsonMatch[0]);
					
					if (!data.items || data.items.length === 0) {
						container.innerHTML = '<div class="shop-empty-state"><p>未找到符合条件的商品，换个词试试吧</p></div>';
						return;
					}

					// 渲染 HTML
					let html = '';
					data.items.forEach(item => {
						let commentsHtml = '';
						if (item.comments && item.comments.length > 0) {
							const commentsList = item.comments.map(c => 
								`<div class="shop-comment-item"><span class="shop-comment-user">${c.user}:</span><span style="color:#666;">${c.content}</span></div>`
							).join('');
							commentsHtml = `<div class="shop-card-comments">${commentsList}</div>`;
						}

						html += `
							<div class="shop-card">
								<div class="shop-card-img">
									<div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
										<i class="fas fa-image" style="font-size:24px; color:#ccc;"></i>
										<span>[虚拟图片] ${item.imageDesc || '商品图'}</span>
									</div>
								</div>
								<div class="shop-card-body">
									<div class="shop-card-title">${item.title}</div>
									<div class="shop-card-desc">${item.description}</div>
									<div class="shop-card-price">${parseFloat(item.price).toFixed(2)}</div>
									<button class="shop-buy-btn" data-item='${encodeURIComponent(JSON.stringify(item))}'>购买送给...</button>
									${commentsHtml}
								</div>
							</div>
						`;
					});
					container.innerHTML = html;

				} catch (error) {
					console.error("生成购物内容失败:", error);
					container.innerHTML = `<div class="shop-empty-state" style="color:#ff3b30;"><i class="fas fa-exclamation-triangle"></i><p>生成失败: ${error.message}</p></div>`;
				} finally {
					shopGenerateBtn.disabled = false;
					shopGenerateBtn.innerHTML = '<i class="fas fa-magic"></i> AI 搜索';
				}
			});
		}
		// ============================================================
        // 【外卖卡片系统 (UI 刷新逻辑)】
        // ============================================================
        function renderDeliveryCards() {
            const container = document.getElementById('delivery-cards-container');
            if (!container) return;

            // 只有当用户在看某个具体的聊天页面时，才显示外卖卡片
            const chatPage = document.getElementById('chat-detail-page');
            if (!activeChatId || !chatPage.classList.contains('active')) {
                container.innerHTML = '';
                return;
            }

            const char = characters.find(c => c.id == activeChatId);
            if (!char || !char.activeDeliveries || char.activeDeliveries.length === 0) {
                container.innerHTML = '';
                return;
            }

            let html = '';
            const now = Date.now();

            char.activeDeliveries.forEach(d => {
                let statusClass = '';
                let statusText = '';
                let btnHtml = '';

                // 判断是否已送达
                const isArrived = now >= d.actualDeliveryTime;

                if (isArrived) {
                    // --- 状态3：已送达 ---
                    statusClass = 'arrived';
                    statusText = `<i class="fas fa-check-circle"></i> 已送达 (点击关闭)`;
                    
                    // 【关键】送达后显示 "X" 按钮 -> 绑定 closeDelivery (只关闭不退款)
                    // 这里的样式类 delivery-close-btn 我们在 CSS 里定义过，通常是一个灰色的叉
                    btnHtml = `<button class="delivery-close-btn" onclick="closeDelivery('${d.id}')" title="签收/移除浮窗" style="display:block;">
                                    <i class="fas fa-times-circle"></i>
                               </button>`;
							   // 【修复1】自动同步聊天记录中气泡卡片的状态为“已送达”
                    const orderMsg = char.chatHistory.find(m => m.isOrderCard && m.relatedDeliveryId === d.id);
                    if (orderMsg && orderMsg.status !== '已送达') {
                        orderMsg.status = '已送达';
                        saveCharactersToLocal();
                        // 局部刷新聊天流中的该卡片 UI
                        const row = document.getElementById(`row-${orderMsg.timestamp}`);
                        if (row) row.outerHTML = generateMessageHTML(orderMsg, false);
					}	
                } else {
                    // --- 状态1 & 2：配送中/超时 ---
                    if (now < d.etaTime) {
                        const diff = Math.floor((d.etaTime - now) / 1000);
                        const m = Math.floor(diff / 60).toString().padStart(2, '0');
                        const s = (diff % 60).toString().padStart(2, '0');
                        statusText = `<i class="fas fa-motorcycle"></i> 预计送达: ${m}:${s}`;
                    } else {
                        statusClass = 'overdue';
                        const diff = Math.floor((now - d.etaTime) / 1000);
                        const m = Math.floor(diff / 60).toString().padStart(2, '0');
                        const s = (diff % 60).toString().padStart(2, '0');
                        statusText = `<i class="fas fa-exclamation-triangle"></i> 已超时: ${m}:${s}`;
                    }
					 // 加速按钮：橙色闪电图标
					const speedUpBtn = `<button onclick="speedUpDelivery('${d.id}')" style="background:none; border:1px solid #ff9800; color:#ff9800; border-radius:4px; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; cursor:pointer; margin-right:8px;" title="钞能力加速">
                                <i class="fas fa-bolt"></i>
                           </button>`;
					   // 取消按钮
					const cancelBtn = `<button onclick="cancelDelivery('${d.id}')" style="background:none; border:1px solid #ff3b30; color:#ff3b30; border-radius:4px; padding:2px 6px; font-size:12px; cursor:pointer; white-space:nowrap;">
									取消
							   </button>`;

					// 将两个按钮横向排列
					btnHtml = `<div style="display:flex; align-items:center;">${speedUpBtn}${cancelBtn}</div>`;
				}

                html += `
                    <div class="delivery-card ${statusClass}">
                        <div class="delivery-info">
                            <span class="delivery-title">${d.name}</span>
                            <span class="delivery-status">${statusText}</span>
                        </div>
                        ${btnHtml}
                    </div>
                `;
            });

            container.innerHTML = html;
        }
		// ============================================================
		// 【新增】钞能力：外卖 3 分钟闪送逻辑 (带系统通知 & 不退款提示)
		// ============================================================
		window.speedUpDelivery = function(deliveryId) {
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.activeDeliveries) return;

			// 1. 找到对应的外卖订单
			const delivery = char.activeDeliveries.find(d => d.id === deliveryId);
			if (!delivery) return;

			// 2. 弹窗询问 (增加不可退款提示)
			if (!confirm("是否启用3分钟闪送？\n（将扣除100元服务费，此费用不可退款）")) {
				return; // 选否，退出，无事发生
			}

			// 3. 检查余额
			if (walletData.balance < 100) {
				alert("余额不足，无法使用钞能力！");
				return;
			}

			// 4. 执行扣费 (这里是独立流水，取消外卖时不会退还这笔钱)
			const cost = 100;
			window.addTransaction(-cost, `外卖闪送加速: ${delivery.name}`);

			// 5. 修改时间逻辑 (重置为3分钟后)
			const now = Date.now();
			const threeMinutes = 3 * 60 * 1000;
			
			delivery.etaTime = now + threeMinutes;
			delivery.actualDeliveryTime = now + threeMinutes; // 保证准时送达，不再晚点

			// 6. 后台注入隐藏系统消息 (给 AI 看的，带延时防冲突)
			char.chatHistory.push({
				text: `[系统动作：用户使用了钞能力（花费100元），外卖平台已响应，外卖小哥保证3分钟内送达"${delivery.name}"。请对此做出反应，表现出惊讶或期待。]`,
				type: 'sent', // 标记为用户发送的动作
				isHidden: true, // 隐藏消息，仅 AI 可见
				isRead: true,
				timestamp: now + 10, 
				relatedDeliveryId: deliveryId, // 绑定外卖ID
				subEventType: 'speed_up' // 【新增】子事件标签：只代表加速
			});

			// 7. 【新增】注入一条可见的系统消息 (给用户看的)
			const sysMsg = {
				text: `你使用了钞能力，外卖[${delivery.name}]将加速在3分钟内送达。`,
				type: 'system',
				timestamp: now + 20, // 稍微延后一点保证顺序
				isRead: true,
				isSystemMsg: true,
				relatedDeliveryId: deliveryId, // 绑定外卖ID
				subEventType: 'speed_up' // 【新增】子事件标签：只代表加速
			};
			char.chatHistory.push(sysMsg);

			// 8. 更新聊天记录中的卡片状态文字
			const orderMsg = char.chatHistory.find(m => m.isOrderCard && m.relatedDeliveryId === deliveryId);
			if (orderMsg) {
				orderMsg.status = '⚡ 极速配送中';
				// 如果当前在聊天窗口，刷新这张卡片
				const row = document.getElementById(`row-${orderMsg.timestamp}`);
				if (row) {
					row.outerHTML = generateMessageHTML(orderMsg, false);
				}
			}

			// 9. 保存并刷新界面
			saveCharactersToLocal();
			
			if (activeChatId === char.id) {
				renderMessageToScreen(sysMsg); // 【新增】立即渲染这条给用户看的系统消息
				scrollToBottom();              // 滚到底部
			}
			
			renderDeliveryCards(); // 立即刷新浮窗倒计时
			alert("已启用闪送，预计3分钟后送达！");
		};
		// ============================================================
		// 【恢复】用户手动叉掉外卖卡片 (只关闭浮窗，不影响聊天记录)
		// ============================================================
		window.closeDelivery = function(deliveryId) {
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.activeDeliveries) return;

			// 仅仅从悬浮窗列表(activeDeliveries)中移除该外卖
			char.activeDeliveries = char.activeDeliveries.filter(d => d.id !== deliveryId);
			
			// 保存并刷新
			saveCharactersToLocal();
			renderDeliveryCards();
		};
		// ============================================================
		// 【修复版】取消外卖逻辑 (区分收发方 + 通知 AI)
		// ============================================================
		window.cancelDelivery = function(deliveryId) {
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
			if (!char || !char.activeDeliveries) return;

			// 找到相关数据
			const targetDelivery = char.activeDeliveries.find(d => d.id === deliveryId);
			const isAiToUser = targetDelivery && targetDelivery.direction === 'to_user';
			const orderMsg = char.chatHistory.find(m => m.isOrderCard && m.relatedDeliveryId === deliveryId);

			// 1. 执行退款 (只针对用户自己购买的)
			if (!isAiToUser && orderMsg && orderMsg.price) {
				const refundAmount = parseFloat(orderMsg.price);
				window.addTransaction(refundAmount, `取消外卖退款: ${orderMsg.title}`);
				alert(`订单已取消，退款 ¥${refundAmount.toFixed(2)} 已到账`);
			} else {
				alert("订单已取消");
			}

			// 2. 更新聊天卡片的状态文字
			if (orderMsg) {
				orderMsg.status = '已取消';
				const row = document.getElementById(`row-${orderMsg.timestamp}`);
				if (row) row.outerHTML = generateMessageHTML(orderMsg, false);
			}

			// 3. 从悬浮窗列表移除
			char.activeDeliveries = char.activeDeliveries.filter(d => d.id !== deliveryId);

			// 4. 给 AI 的后台指令处理
			if (isAiToUser) {
				// 如果是AI点给用户的，用户取消后，发个暗消息告诉 AI，让 AI 做出反应
				char.chatHistory.push({
					text: `[系统通知：用户取消了你为TA点的外卖 "${orderMsg ? orderMsg.title : ''}"]`,
					type: 'sent', 
					isHidden: true,
					isRead: true,
					timestamp: Date.now(),
					relatedDeliveryId: deliveryId,
					subEventType: 'cancel' // 【新增】子事件标签
				});
			} else {
				// 如果是用户点给AI的，清除等待收货的隐藏指令即可
				char.chatHistory = char.chatHistory.filter(m => m.relatedDeliveryId !== deliveryId || !m.isHidden);
			}

			// 5. 插入给用户看的系统提示
			const cancelSysMsg = {
				text: `[系统通知] 你取消了外卖订单。`,
				type: 'system',
				timestamp: Date.now() + 10,
				isRead: true,
				isSystemMsg: true,
				relatedDeliveryId: deliveryId,
				subEventType: 'cancel' // 【新增】子事件标签
			};
			char.chatHistory.push(cancelSysMsg);

			// 6. 保存并刷新界面
			saveCharactersToLocal();
			if (activeChatId === char.id) {
				renderMessageToScreen(cancelSysMsg); // 【修复】直接渲染该条提示，而不是干等刷新
			}
			renderDeliveryCards(); // 刷新浮窗 (浮窗会消失)
			scrollToBottom();      // 滚到底部看系统提示
		};
		// 启动全局心跳，每秒刷新一次 UI
		setInterval(renderDeliveryCards, 1000);
		// ============================================================
		// 【购买系统与礼物清单逻辑】
		// ============================================================
		let pendingPurchaseItem = null;

		// 使用事件委托处理商城的购买按钮点击
		document.addEventListener('click', (e) => {
			if (e.target.classList.contains('shop-buy-btn')) {
				const itemStr = e.target.getAttribute('data-item');
				if (itemStr) {
					pendingPurchaseItem = JSON.parse(decodeURIComponent(itemStr));
					openPurchaseModal();
				}
			}
		});

		function openPurchaseModal() {
			if (!pendingPurchaseItem) return;
			
			const modal = document.getElementById('purchase-modal');
			document.getElementById('purchase-item-name').textContent = pendingPurchaseItem.title;
			document.getElementById('purchase-item-price').textContent = pendingPurchaseItem.price;
			
			// 渲染角色列表
			const charList = document.getElementById('purchase-char-list');
			charList.innerHTML = '';
			const validChars = characters.filter(c => c.type !== 'group'); // 排除群聊
			validChars.forEach(c => {
				charList.innerHTML += `
					<label class="checkbox-item" style="margin-bottom: 5px;">
						<input type="checkbox" value="${c.id}" class="purchase-char-cb">
						<span class="custom-check-circle"></span>
						<div style="display:flex; align-items:center;">
							<img src="${c.avatar || ''}" style="width:24px; height:24px; border-radius:4px; margin-right:8px; object-fit:cover; background:#eee;">
							<span>${c.name}</span>
						</div>
					</label>
				`;
			});

			// 动态计算总价
			const cbs = modal.querySelectorAll('.purchase-char-cb');
			const totalEl = document.getElementById('purchase-total-price');
			totalEl.textContent = '0.00';
			
			cbs.forEach(cb => {
				cb.addEventListener('change', () => {
					const selectedCount = modal.querySelectorAll('.purchase-char-cb:checked').length;
					totalEl.textContent = (selectedCount * parseFloat(pendingPurchaseItem.price)).toFixed(2);
				});
			});

			modal.classList.add('show');
		}

		document.getElementById('purchase-cancel-btn').addEventListener('click', () => {
			document.getElementById('purchase-modal').classList.remove('show');
			pendingPurchaseItem = null;
		});

		document.getElementById('purchase-confirm-btn').addEventListener('click', () => {
			const selectedCbs = document.querySelectorAll('.purchase-char-cb:checked');
			if (selectedCbs.length === 0) {
				alert('请至少选择一个接收对象');
				return;
			}

			const totalPrice = selectedCbs.length * parseFloat(pendingPurchaseItem.price);
			if (totalPrice > walletData.balance) {
				alert('余额不足！');
				return;
			}

			// 扣费并记录流水
			walletData.balance -= totalPrice;
			walletData.transactions.push({
				id: 'trans_' + Date.now(),
				amount: -totalPrice,
				desc: `商城消费: ${pendingPurchaseItem.title} x${selectedCbs.length}`,
				timestamp: Date.now()
			});
			saveWalletToLocal();

			// 【修复 2】生成 YYYY-MM-DD 格式的时间给礼物卡片
            const now = new Date();
            const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;

            selectedCbs.forEach(cb => {
                const charId = cb.value;
                const char = characters.find(c => c.id === charId);
                if (!char) return;

                if (!char.chatHistory) char.chatHistory =[];

                if (currentShopMode === 'shopping') {
                    if (!char.giftList) char.giftList =[];
					// 1. 生成唯一 Gift ID
					const uniqueGiftId = 'gift_' + Date.now() + Math.random().toString(36).substr(2, 5);

                    char.giftList.push({
                        id: uniqueGiftId, // 使用生成的 ID
                        name: pendingPurchaseItem.title,
                        desc: pendingPurchaseItem.description,
                        date: dateStr, // 使用修正后的短日期
                        status: '完好/未使用'
                    });
                    
                    const orderMsg = {
                        type: 'sent',
                        timestamp: Date.now(),
                        isRead: true,
                        isOrderCard: true, 
                        orderType: 'gift',
                        title: pendingPurchaseItem.title,
                        price: pendingPurchaseItem.price,
                        desc: pendingPurchaseItem.description,
                        status: '已赠送',
						relatedGiftId: uniqueGiftId 
                    };
                    char.chatHistory.push(orderMsg);
                    
                    // 【修复 4】将 type 改为 'sent'，让 AI 知道这是用户发出的动作
                    char.chatHistory.push({
                        text: `[系统动作：用户为你购买了商品：“${pendingPurchaseItem.title}”，详情：${pendingPurchaseItem.description}。商品已收录进礼物清单，你需要对此做出反应。]`,
                        type: 'sent', 
                        isHidden: true,
						isRead: true,						
                        timestamp: Date.now() + 100,
						relatedGiftId: uniqueGiftId 						
                    });

                } else {
                    // --- 逻辑2：外卖商品 ---
                    if (!char.activeDeliveries) char.activeDeliveries = [];
                    
                    const orderTime = Date.now();
                    const etaDuration = Math.floor(Math.random() * (40 - 10 + 1) + 10) * 60 * 1000;
                    const etaTime = orderTime + etaDuration;
                    
                    const isLate = Math.random() < 0.1;
                    const lateDuration = isLate ? Math.floor(Math.random() * (3 - 1 + 1) + 1) * 60 * 1000 : 0;
                    const actualDeliveryTime = etaTime + lateDuration;

                    // 生成唯一 ID
                    const deliveryId = 'del_' + Date.now() + Math.random().toString(36).substr(2,5);

                    // 1. 存入外卖列表 (控制浮窗和AI提示)
                    char.activeDeliveries.push({
                        id: deliveryId,
                        name: pendingPurchaseItem.title,
                        orderTime: orderTime,
                        etaTime: etaTime,
                        actualDeliveryTime: actualDeliveryTime
                    });

                    // 2. 插入外卖卡片 (界面可见)
                    const orderMsg = {
                        type: 'sent',
                        timestamp: Date.now(),
                        isRead: true,
                        isOrderCard: true, 
                        orderType: 'delivery',
                        title: pendingPurchaseItem.title,
                        price: pendingPurchaseItem.price,
                        desc: pendingPurchaseItem.description,
                        status: '等待送达',
                        relatedDeliveryId: deliveryId // 绑定 ID
                    };
                    char.chatHistory.push(orderMsg);

                    // 3. 插入给 AI 看的后台系统指令 (界面隐藏)
                    char.chatHistory.push({
                        text: `[系统动作：用户为你点了一份外卖：“${pendingPurchaseItem.title}”，大概 ${Math.round(etaDuration/60000)} 分钟后送到。暂时还没到，请耐心等待。你需要对此做出反应。]`,
                        type: 'sent',
                        isHidden: true,
						isRead: true,
                        timestamp: Date.now() + 100,
                        relatedDeliveryId: deliveryId // 【修改】这里也绑定 ID，方便一起删！
                    });
                }
			}); 	

			saveCharactersToLocal();
			document.getElementById('purchase-modal').classList.remove('show');
			pendingPurchaseItem = null;
			alert('购买成功！');
			
			// 刷新列表以显示最新消息概览
			if (typeof renderChatList === 'function') renderChatList();
		});

		// ============================================================
		// 【礼物清单管理页面】
		// ============================================================
		const menuGiftListBtn = document.getElementById('menu-gift-list-btn');
		const giftListTopBack = document.querySelector('#gift-list-top .top-bar-back');
		const giftListSaveBtn = document.getElementById('gift-list-save-btn');

		if (menuGiftListBtn) {
			menuGiftListBtn.addEventListener('click', () => {
				document.getElementById('chat-menu-dropdown').classList.remove('show');
				renderGiftListPage();
				switchPage('gift-list-page');
				switchTopBar('gift-list-top');
			});
		}

		if (giftListTopBack) {
			giftListTopBack.addEventListener('click', () => {
				switchPage('chat-detail-page');
				switchTopBar('chat-detail-top');
				scrollToBottom(); // 【修复 3】增加滚动到底部
			});
		}

		if (giftListSaveBtn) {
			giftListSaveBtn.addEventListener('click', () => {
				const char = characters.find(c => c.id == activeChatId);
				if (char && char.giftList) {
					// 遍历所有输入框并更新状态
					document.querySelectorAll('.gift-status-input').forEach(input => {
						const id = input.getAttribute('data-id');
						const targetGift = char.giftList.find(g => g.id === id);
						if (targetGift) {
							targetGift.status = input.value.trim();
						}
					});
					saveCharactersToLocal();
					alert('礼物状态已更新！');
					giftListTopBack.click();
				}
			});
		}

		function renderGiftListPage() {
			const container = document.getElementById('gift-list-container');
			if (!activeChatId) return;
			const char = characters.find(c => c.id == activeChatId);
					
            // ============================================================
            // 【修复】强制添加滚动样式
            // ============================================================
            container.style.height = 'calc(100vh - 44px)'; // 减去顶部导航栏高度
            container.style.overflowY = 'auto';            // 允许垂直滚动
            container.style.paddingBottom = '50px';        // 底部留白，防止被遮挡
            container.style.boxSizing = 'border-box';
            // ============================================================
			if (!char || !char.giftList || char.giftList.length === 0) {
				container.innerHTML = '<div style="text-align:center; padding: 50px; color:#999;"><i class="fas fa-box-open" style="font-size:40px; margin-bottom:10px;"></i><p>尚未赠送任何礼物</p></div>';
				return;
			}

			let html = '';
			char.giftList.forEach(gift => {
				html += `
					<div class="gift-list-item" id="gift-card-${gift.id}">
						<div class="gift-list-header">
							<span>赠送时间：${gift.date}</span>
							<span style="font-size:10px; color:#ccc;">ID:${gift.id}</span>
						</div>
						<div class="gift-list-name"><i class="fas fa-gift" style="color:#ff4d4f;"></i> ${gift.name}</div>
						<div class="gift-list-desc" style="margin-bottom:8px;">${gift.desc}</div>
						<!-- 新增状态输入框 -->
						<div style="display:flex; align-items:center; font-size:12px;">
							<span style="color:#888; width:40px;">状态:</span>
							<input type="text" class="gift-status-input" data-id="${gift.id}" value="${gift.status || '完好/未使用'}" style="flex:1; border:1px solid #eee; padding:4px 8px; border-radius:4px; font-size:12px; outline:none;">
						</div>
						<button class="gift-delete-btn" onclick="deleteGift('${gift.id}')"><i class="fas fa-trash-alt"></i></button>
					</div>
				`;
			});
			container.innerHTML = html;
		}

		window.deleteGift = function(giftId) {
			if (!confirm('确定要从清单中移除该礼物吗？')) return;
			const char = characters.find(c => c.id == activeChatId);
			if (char && char.giftList) {
				char.giftList = char.giftList.filter(g => g.id !== giftId);
				saveCharactersToLocal();
				renderGiftListPage();
			}
		};
		
		// ============================================================
		// 【新增】论坛回复输入框的优化 (回车发送 & 阻止键盘闪退)
		// ============================================================
		document.addEventListener('DOMContentLoaded', () => {
			const forumReplyInput = document.getElementById('forum-reply-input');
			const forumSendReplyBtn = document.getElementById('forum-send-reply-btn');

			if (forumSendReplyBtn && forumReplyInput) {
				// 1. 在 mousedown 阶段阻止按钮的默认获取焦点行为，防止手机端点击时键盘收起
				forumSendReplyBtn.addEventListener('mousedown', function(e) {
					e.preventDefault();
				});

				// 2. 监听输入框的回车键，按下回车即触发发送
				forumReplyInput.addEventListener('keypress', function(e) {
					if (e.key === 'Enter') {
						e.preventDefault(); // 阻止回车产生换行或默认提交
						forumSendReplyBtn.click(); // 主动触发发送按钮的点击事件
					}
				});
			}
		});
		
		// ============================================================
		// 【新增】手账日记系统逻辑
		// ============================================================
		
		let currentDiaryCharId = null;

		const diaryEntryBtn = document.getElementById('diary-entry-btn');
		const diaryListTopBack = document.querySelector('#diary-list-top .top-bar-back');
		const diaryDetailTopBack = document.querySelector('#diary-detail-top .top-bar-back');
		const diaryRefreshBtn = document.getElementById('diary-refresh-btn');
		const diaryExportBtn = document.getElementById('diary-export-action-btn');

		// 1. 从发现页进入日记列表页
		if (diaryEntryBtn) {
			diaryEntryBtn.addEventListener('click', () => {
				renderDiaryList();
				switchPage('diary-list-page');
				switchTopBar('diary-list-top');
			});
		}

		// 2. 列表页返回
		if (diaryListTopBack) {
			diaryListTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		// 3. 详情页返回
		if (diaryDetailTopBack) {
			diaryDetailTopBack.addEventListener('click', () => {
				currentDiaryCharId = null;
				renderDiaryList(); // 刷新一下时间
				switchPage('diary-list-page');
				switchTopBar('diary-list-top');
			});
		}

		// 4. 渲染可写日记的角色列表 (仅私聊角色)
		function renderDiaryList() {
			const container = document.getElementById('diary-list-container');
			container.innerHTML = '';

			const validChars = characters.filter(c => c.type !== 'group');
			
			if (validChars.length === 0) {
				container.innerHTML = '<div style="text-align:center; padding:50px; color:#999;">暂无私聊角色</div>';
				return;
			}

			validChars.forEach(char => {
				const avatarHtml = char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user" style="font-size:24px; color:#ccc; line-height:44px; text-align:center; display:block;"></i>`;
				
				// 检查是否有日记记录
				let statusText = "暂无日记，点击生成";
				if (char.diaryData && char.diaryData.timestamp) {
					statusText = `上次记录: ${getSmartTime(char.diaryData.timestamp)}`;
				}

				container.innerHTML += `
					<div class="diary-char-card" onclick="openDiaryDetail('${char.id}')">
						<div class="d-char-avatar">${avatarHtml}</div>
						<div class="d-char-info">
							<div class="d-char-name">${char.name}</div>
							<div class="d-char-desc">${statusText}</div>
						</div>
						<i class="fas fa-chevron-right" style="color:#ccc;"></i>
					</div>
				`;
			});
		}

		// 5. 进入日记详情页
		window.openDiaryDetail = function(charId) {
			currentDiaryCharId = charId;
			const char = characters.find(c => c.id === charId);
			if (!char) return;

			document.getElementById('diary-detail-title').textContent = `${char.name} 的手账`;

			// 【新增】设置左上角头像
			const avatarDisplay = document.getElementById('diary-avatar-display');
			if (char.avatar) {
				avatarDisplay.innerHTML = `<img src="${char.avatar}">`;
			} else {
				avatarDisplay.innerHTML = `<i class="fas fa-user"></i>`;
			}

			// 【新增】设置右上角副标题为 "角色名 记录"
			document.getElementById('diary-lunar-display').textContent = `${char.name} 记录`;

			// 渲染现有数据，如果没有则显示占位符
			let displayDate = new Date();
			
			if (char.diaryData && char.diaryData.content) {
				fillDiaryDOM(char.diaryData.content);
				// 优先使用保存的目标日期
				if (char.diaryData.targetDate) {
					displayDate = new Date(char.diaryData.targetDate);
				} else if (char.diaryData.timestamp) {
					displayDate = new Date(char.diaryData.timestamp);
					if (displayDate.getHours() < 18) displayDate.setDate(displayDate.getDate() - 1);
				}
			} else {
				const emptyData = {
					sleep: "等待记录...", fit: "等待记录...", meal: "等待记录...",
					care: "等待记录...", buy: "等待记录...", book: "等待记录...",movie: "等待记录...",
					morning: "点击右上角刷新按钮生成日记...", afternoon: "", evening: ""
				};
				fillDiaryDOM(emptyData);
				// 空状态下计算目标日期
				if (displayDate.getHours() < 18) {
					displayDate.setDate(displayDate.getDate() - 1);
				}
			}

			updateDiaryDateUI(displayDate);

			switchPage('diary-detail-page');
			switchTopBar('diary-detail-top');
			
			const contentArea = document.getElementById('main-content-area');
			if(contentArea) contentArea.style.top = '44px';
		};


		// 6. 更新手账的日期 UI (增加目标日期传参)
		function updateDiaryDateUI(targetDateObj) {
			const d = targetDateObj || new Date();
			document.getElementById('diary-day-display').textContent = d.getDate();
			const weekdays =['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
			document.getElementById('diary-weekday-display').textContent = weekdays[d.getDay()];
		}

		// 7. 将 JSON 数据填入 DOM (移除 Mood)
		function fillDiaryDOM(data) {
			if (!data) return;
			document.getElementById('diary-sleep').textContent = data.sleep || '-';
			document.getElementById('diary-fit').textContent = data.fit || '-';
			document.getElementById('diary-meal').textContent = data.meal || '-';
			document.getElementById('diary-care').textContent = data.care || '-';
			document.getElementById('diary-buy').textContent = data.buy || '-';
			document.getElementById('diary-book').textContent = data.book || '-';
			document.getElementById('diary-movie').textContent = data.movie || '-'; 
			
			document.getElementById('diary-content-6').textContent = data.morning || '-';
			document.getElementById('diary-content-12').textContent = data.afternoon || '-';
			document.getElementById('diary-content-18').textContent = data.evening || '-';
		}

		// 8. 触发 AI 生成日记
		if (diaryRefreshBtn) {
			diaryRefreshBtn.addEventListener('click', async () => {
				if (!currentDiaryCharId) return;
				const char = characters.find(c => c.id === currentDiaryCharId);
				if (!char) return;

				const icon = diaryRefreshBtn.querySelector('i');
				icon.classList.add('fa-spin');
				diaryRefreshBtn.disabled = true;

				// 2. 用户信息 (支持面具系统)
				let userName = userInfo.name;
				let userMask = userInfo.mask || "无设定";

				if (char.userMaskId) {
					const boundMask = userMasks.find(m => m.id === char.userMaskId);
					if (boundMask) {
						if (boundMask.name) userName = boundMask.name;
						if (boundMask.mask) userMask = boundMask.mask;
					}
				} else {
					if (char.userName && char.userName.trim()) userName = char.userName.trim();
					if (char.userMask && char.userMask.trim()) userMask = char.userMask.trim();
				}
				
				const recentChat = (char.chatHistory ||[]).slice(-15).map(m => {
					if (m.isHidden || m.isSystemMsg) return "";
					// 带上时间戳以便于AI核对时间
					const timePrefix = char.timeAware ? `[${formatFullTime(m.timestamp)}] ` : "";
					const role = m.type === 'sent' ? userName : char.name;
					return `${timePrefix}${role}: ${m.text}`;
				}).filter(Boolean).join('\n');

				const ltm = (char.longTermMemories ||[]).join('; ');
				const lifeEvents = (char.lifeEvents ||[]).map(e => e.event).join('; ');
				const gifts = (char.giftList ||[]).map(g => g.name).join('、');
				// 【修复3】加载世界书上下文
				const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);
				let fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(char.id) : "";
				let weatherContext = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(char.id) : "";
				let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(char.id) : ""; // <--- 获取日程
				let recentMoments = "";
				if (typeof socialMoments !== 'undefined') {
					recentMoments = socialMoments
						.filter(m => m.authorName === char.name || (m.comments && m.comments.some(c => c.user === char.name)))
						.slice(0, 3)
						.map(m => `朋友圈: ${m.content}`)
						.join(' | ');
				}

				// ============================================================
				// 【新增】时间计算：18点前生成昨天，18点后生成今天
				// ============================================================
				const now = new Date();
				const targetDate = new Date(now);
				let dayType = "今天";
				
				if (now.getHours() < 18) {
					targetDate.setDate(targetDate.getDate() - 1);
					dayType = "昨天";
				}
				
				const targetDateStr = `${targetDate.getFullYear()}/${(targetDate.getMonth()+1).toString().padStart(2,'0')}/${targetDate.getDate().toString().padStart(2,'0')}`;
				const currentTimeStr = formatFullTime(now.getTime());

				// ============================================================
				// 【新增】时间感知严格指令与脑补指令
				// ============================================================
				let timeAwareInstruction = "";
				if (char.timeAware) {
					timeAwareInstruction = `
				【时间感知与事件对齐（严厉警告）】
				系统已开启时间感知。聊天记录中带有精确的时间戳。
				你必须严格比对时间戳：你现在要写的是【${targetDateStr}】的日记！
				绝不能把发生在其他日期的事件（即使是长期记忆里的事）当作【${targetDateStr}】当天发生的事写进去！
				如果【${targetDateStr}】当天没有发生任何值得记录的聊天或事件，你可以根据你的人设脑补/虚构一部分符合你日常生活的合理行为。`;
				} else {
					timeAwareInstruction = `如果当天没发生什么特别的事，可以根据你的人设脑补一部分符合你日常生活的合理琐事。`;
				}

				const systemPrompt = `${wbBefore}
				你现在是角色 "${char.name}"。你正在写手账日记。
				
				【时间信息】
				当前真实时间：${currentTimeStr}
				真实的天气信息： ${weatherContext}
				你要写的日记日期：【${targetDateStr}】 (${dayType}的日记)
				你当天的日程：${theirDayContext} 

				【你的设定】: ${char.persona || '无'}
				【用户(${userName})设定】: ${userMask}
				【当前世界观背景、人际关系和知识储备】: ${wbAfter}
				【当日运势】:  ${fortuneContext}
				【你们的共同记忆】: ${ltm}
				【人生大事】: ${lifeEvents}
				【拥有的物品/礼物】: ${gifts}
				【近期朋友圈互动】: ${recentMoments}
				【近期聊天上下文】: 
				${recentChat}

				【任务要求】
				请综合以上信息，以第一人称（“我”）写一篇高度结构化的手账日记。
				日记记录的是【${targetDateStr}】这一天发生的事情。
				${timeAwareInstruction}
				
				必须且仅输出严格的 JSON 格式（不要Markdown代码块），格式如下：
				{
					"sleep": "简述睡眠质量(如：熬夜、早起很困)",
					"fit": "当天的运动或身体状态简述",
					"meal": "当天吃了什么好吃的",
					"care": "护肤、打扮或自我照顾的简述",
					"buy": "当天花了什么钱，买了什么，或者想买什么",
					"book": "当天看了什么书/文章/听了什么音乐",
					"movie": "当天看了什么电影/剧集/视频",
					"morning": "上午发生的事件或内心的想法 (不少于50字)",
					"afternoon": "下午发生的事件或内心的想法 (不少于50字)",
					"evening": "晚上发生的事件或内心的想法 (不少于50字)"
				}
				`;

				try {
					// 【修改】API 优先级：朋友圈/论坛 API > 聊天 API
					const useSettings = (socialApiSettings && socialApiSettings.baseUrl && socialApiSettings.apiKey) 
										? socialApiSettings 
										: chatApiSettings;
					
					const responseText = await callOpenAiApi([
						{ role: "system", content: systemPrompt },
						{ role: "user", content: "请开始生成目标日期的手账日记JSON数据。" }
					], useSettings);

					const jsonMatch = responseText.match(/\{[\s\S]*\}/);
					if (jsonMatch) {
						const diaryDataContent = JSON.parse(jsonMatch[0]);
						
						// 【修改】同时保存生成的时间和目标日期
						char.diaryData = {
							timestamp: Date.now(),
							targetDate: targetDate.getTime(),
							content: diaryDataContent
						};
						saveCharactersToLocal();
						
						fillDiaryDOM(diaryDataContent);
						// 生成成功后同步更新UI的日期
						updateDiaryDateUI(targetDate);
						alert('日记生成完毕！');
					} else {
						throw new Error("AI 未返回合法的 JSON 格式");
					}

				} catch (err) {
					console.error("生成日记失败:", err);
					alert("生成日记失败: " + err.message);
				} finally {
					icon.classList.remove('fa-spin');
					diaryRefreshBtn.disabled = false;
				}
			});
		}

	// 9. 导出为图片逻辑 (最终样式替换版：修复分割线 + 修复图标 + 强制白底)
		if (diaryExportBtn) {
			diaryExportBtn.addEventListener('click', async () => {
				const realWrapper = document.getElementById('diary-export-wrapper');
				if (!realWrapper) return;

				const originalText = diaryExportBtn.innerHTML;
				diaryExportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 样式重绘中...';
				diaryExportBtn.disabled = true;

				// 1. 强制滚动顶部
				window.scrollTo(0, 0);

				// ============================================================
				// 【步骤 A】创建原地克隆 (保留父级上下文)
				// ============================================================
				const clone = realWrapper.cloneNode(true);
				
				clone.style.position = 'absolute';
				clone.style.left = realWrapper.offsetLeft + 'px';
				clone.style.top = realWrapper.offsetTop + 'px';
				clone.style.width = realWrapper.offsetWidth + 'px';
				clone.style.zIndex = '9999'; 
				clone.style.backgroundColor = '#ffffff'; // 强制白底
				clone.style.margin = '0';
				clone.style.padding = '20px'; // 补一点内边距防止边缘被切
				clone.style.boxSizing = 'border-box';

				// 移除导出按钮
				const btnInClone = clone.querySelector('#diary-export-action-btn');
				if (btnInClone) btnInClone.remove();
				
				realWrapper.parentNode.appendChild(clone);

				// ============================================================
				// 【步骤 B】核心修复：强制替换为“截图友好型”样式
				// html2canvas 对 SVG背景 和 字体图标 支持很差，我们这里手动降级
				// ============================================================
				
				// --- 修复 1：分割线 (将 SVG 背景换成 CSS 边框) ---
				// 你的 CSS 用的是 background-image svg，这在截图时极易丢失
				// 这里我们将它强制改为 border-bottom，虽然样式略有不同，但保证可见！
				const lines = clone.querySelectorAll('.diary-dots-line');
				lines.forEach(line => {
					// 移除导致问题的背景图
					line.style.backgroundImage = 'none'; 
					// 使用最原始的边框代替
					line.style.border = 'none'; // 先清空
					line.style.borderBottom = '6px dotted #4a5c7b'; // 蓝色圆点/方点虚线
					line.style.height = '0px'; // 边框不需要高度
					line.style.opacity = '1';
					line.style.marginTop = '10px';
					line.style.marginBottom = '20px';
					line.style.display = 'block';
				});

				// --- 修复 2：图标 (Font Awesome) ---
				// iOS 上图标消失通常是因为 display 或字体加载问题
				const icons = clone.querySelectorAll('i.fas, i.far, i.fab, i.fa');
				icons.forEach(icon => {
					// 强制显示属性
					icon.style.display = 'inline-block';
					icon.style.visibility = 'visible';
					icon.style.fontStyle = 'normal';
					// 尝试加上文字阴影，有时能强制渲染引擎绘制
					icon.style.textShadow = '0 0 0 rgba(0,0,0,0)'; 
					// 稍微调大一点层级
					icon.style.position = 'relative';
					icon.style.zIndex = '10';
				});

				// --- 修复 3：图片 (跨域清洗) ---
				const urlToBase64 = (url) => {
					return new Promise((resolve) => {
						if (!url || url.startsWith('data:') || url === 'none') { resolve(url); return; }
						const img = new Image();
						img.crossOrigin = 'Anonymous'; 
						img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
						img.onload = () => {
							const canvas = document.createElement('canvas');
							canvas.width = img.width; canvas.height = img.height;
							canvas.getContext('2d').drawImage(img, 0, 0);
							resolve(canvas.toDataURL('image/jpeg', 0.9));
						};
						img.onerror = () => resolve(null);
					});
				};

				// 清洗所有图片
				const imgNodes = clone.querySelectorAll('img');
				const imgTasks = Array.from(imgNodes).map(async (img) => {
					img.style.display = 'block'; 
					const safeData = await urlToBase64(img.src);
					if (safeData) img.src = safeData;
					else img.style.visibility = 'hidden';
				});
				
				// 清洗背景图
				const allNodes = clone.querySelectorAll('*');
				const bgTasks = Array.from(allNodes).map(async (node) => {
					const s = window.getComputedStyle(node);
					if (s.backgroundImage && s.backgroundImage.startsWith('url(') && !node.classList.contains('diary-dots-line')) {
						let url = s.backgroundImage.slice(4, -1).replace(/["']/g, "");
						const safeData = await urlToBase64(url);
						if (safeData) node.style.backgroundImage = `url('${safeData}')`;
					}
				});

				await Promise.all([...imgTasks, ...bgTasks]);

				// ============================================================
				// 【步骤 C】生成截图
				// ============================================================
				diaryExportBtn.innerHTML = '<i class="fas fa-paint-brush"></i> 正在绘制...';

				// 适当延时，给样式重绘留出时间
				setTimeout(() => {
					const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
					// 既然用了 Blob，Scale 可以大胆设为 2 或 3
					const scaleSetting = 2; 

					html2canvas(clone, {
						scale: scaleSetting,
						useCORS: true,
						allowTaint: false,
						logging: false,
						backgroundColor: '#ffffff', // 第三次强调白色背景
						windowWidth: document.documentElement.offsetWidth,
						width: clone.offsetWidth,
						height: clone.offsetHeight,
						// 禁用字体连字，修复部分图标乱码
						onclone: (doc) => {
							const el = doc.querySelector('.diary-wrapper');
							if(el) el.style.fontFeatureSettings = '"liga" 0';
						}
					}).then(canvas => {
						// 渲染完成后立即移除克隆体
						if (clone.parentNode) clone.parentNode.removeChild(clone);

						try {
							canvas.toBlob(function(blob) {
								if (!blob) throw new Error("生成失败");

								const url = URL.createObjectURL(blob);
								const a = document.createElement('a');
								a.href = url;
								a.download = `NN_Diary_${Date.now()}.jpg`;
								document.body.appendChild(a);
								a.click(); 
								document.body.removeChild(a);

								setTimeout(() => URL.revokeObjectURL(url), 2000);

								diaryExportBtn.innerHTML = originalText;
								diaryExportBtn.disabled = false;

							}, 'image/jpeg', 0.9);

						} catch (e) {
							alert("保存出错: " + e.message);
							diaryExportBtn.innerHTML = originalText;
							diaryExportBtn.disabled = false;
						}

					}).catch(err => {
						if (clone.parentNode) clone.parentNode.removeChild(clone);
						console.error(err);
						alert("渲染失败");
						diaryExportBtn.innerHTML = originalText;
						diaryExportBtn.disabled = false;
					});
				}, 500); 
			});
		}
		
		// ============================================================
		// 【云同步 UI 事件绑定】
		// ============================================================
		const cloudSettingEntryBtn = document.getElementById('cloud-setting-entry-btn');
		const cloudSettingTopBack = document.querySelector('#cloud-setting-top .top-bar-back');
		const cloudSettingSaveBtn = document.getElementById('cloud-setting-save-btn');

		const davProxyInput = document.getElementById('webdav-proxy-input'); // 新增
		const davUrlInput = document.getElementById('webdav-url-input');
		const davUserInput = document.getElementById('webdav-user-input');
		const davPassInput = document.getElementById('webdav-pass-input');

		// 1. 从设置页进入云同步页
		if (cloudSettingEntryBtn) {
			cloudSettingEntryBtn.addEventListener('click', () => {
				if(davProxyInput) davProxyInput.value = cloudSettings.proxy || '';
				if(davUrlInput) davUrlInput.value = cloudSettings.url || '';
				if(davUserInput) davUserInput.value = cloudSettings.username || '';
				if(davPassInput) davPassInput.value = cloudSettings.password || '';

				switchPage('cloud-setting-page');
				switchTopBar('cloud-setting-top');
			});
		}

		// 2. 返回设置页
		if (cloudSettingTopBack) {
			cloudSettingTopBack.addEventListener('click', () => {
				switchPage('setting-page');
				switchTopBar('setting-top');
			});
		}

		// 3. 顶部保存按钮
		if (cloudSettingSaveBtn) {
			cloudSettingSaveBtn.addEventListener('click', () => {
				cloudSettings.proxy = davProxyInput.value.trim();
				cloudSettings.url = davUrlInput.value.trim();
				cloudSettings.username = davUserInput.value.trim();
				cloudSettings.password = davPassInput.value.trim();
				saveCloudSettingsToLocal();
				alert('云端配置已保存！请点击测试连接确认。');
			});
		}

		// 4. 三大核心操作按钮
		document.getElementById('webdav-test-btn')?.addEventListener('click', () => {
			cloudSettings.proxy = davProxyInput.value.trim();
			cloudSettings.url = davUrlInput.value.trim();
			cloudSettings.username = davUserInput.value.trim();
			cloudSettings.password = davPassInput.value.trim();
			WebDAVClient.testConnection();
		});

		document.getElementById('cloud-upload-btn')?.addEventListener('click', () => {
			if(confirm("确定要将当前手机的所有数据上传并覆盖云端吗？")) {
				WebDAVClient.uploadData();
			}
		});

		document.getElementById('cloud-download-btn')?.addEventListener('click', () => {
			WebDAVClient.downloadData();
		});
		// ============================================================
		// 【终极版】生理期日历、状态推算与 AI 同步系统
		// ============================================================
		const periodEntryBtn = document.getElementById('period-entry-btn');
		const periodTopBack = document.querySelector('#period-tracking-top .top-bar-back');
		const periodSaveBtn = document.getElementById('period-save-btn');
		const periodUndoBtn = document.getElementById('period-undo-btn');

		let currentCalendarYear = new Date().getFullYear();
		let currentCalendarMonth = new Date().getMonth(); // 0-11

		// --- 辅助工具：格式化日期为 YYYY-MM-DD ---
		function formatToYYYYMMDD(dateObj) {
			const y = dateObj.getFullYear();
			const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
			const d = dateObj.getDate().toString().padStart(2, '0');
			return `${y}-${m}-${d}`;
		}

		// --- 核心算法：判断任意一天属于什么状态 (修复版 + 精准预测消除残留) ---
		function getDateType(dateStr) {
			// 归一化时间戳：只比较日期，忽略时分秒
			const targetTime = new Date(dateStr + "T00:00:00").getTime();
			const todayTime = new Date(formatToYYYYMMDD(new Date()) + "T00:00:00").getTime();

			// 1. 判断是否是【历史已保存的经期】
			for (let record of periodData.history) {
				const s = new Date(record.start + "T00:00:00").getTime();
				const e = new Date(record.end + "T00:00:00").getTime();
				if (targetTime >= s && targetTime <= e) return 'recorded';
			}

			// 2. 判断【当前正在进行中的经期】(实心红)
			if (periodData.activeStart) {
				const s = new Date(periodData.activeStart + "T00:00:00").getTime();
				if (targetTime >= s && targetTime <= todayTime) {
					return 'recorded';
				}
			}

			// 3. 【数学预测逻辑】(包含未来的经期、排卵、安全期)
			let latestStartObj = null;
			
			// 收集并标记所有的开始时间，明确它是来自历史还是当前正在进行中
			let allStarts = periodData.history.map(h => ({
				isHistory: true,
				time: new Date(h.start + "T00:00:00").getTime()
			}));
			if (periodData.activeStart) {
				allStarts.push({
					isHistory: false,
					time: new Date(periodData.activeStart + "T00:00:00").getTime()
				});
			}
			
			// 降序排列，找距离目标日期最近的一个基准点
			allStarts.sort((a,b) => b.time - a.time); 

			for (let obj of allStarts) {
				if (obj.time <= targetTime) {
					latestStartObj = obj;
					break;
				}
			}

			if (!latestStartObj) return 'unknown'; // 没有历史数据无法预测

			const latestStart = latestStartObj.time;
			const isHistoryBase = latestStartObj.isHistory;

			const cycleLength = parseInt(periodData.cycleLength) || 28;
			const duration = parseInt(periodData.duration) || 6;
			const cycleMs = cycleLength * 24 * 60 * 60 * 1000;
			const dayMs = 24 * 60 * 60 * 1000;

			// 计算推断周期
			const diffMs = targetTime - latestStart;
			const cyclesPassed = Math.floor(diffMs / cycleMs);
			const currentCycleStart = latestStart + cyclesPassed * cycleMs;
			const nextCycleStart = currentCycleStart + cycleMs;

			// A. 判断是否在预测的经期内
			const dayOfCycle = Math.floor((targetTime - currentCycleStart) / dayMs);
			
			// 【核心修正】：如果当前周期已经产生了历史记录(即已经结束了)，就不应再有残留的预测天数！
			const ignorePrediction = (cyclesPassed === 0 && isHistoryBase);

			if (!ignorePrediction && dayOfCycle >= 0 && dayOfCycle < duration) {
				return 'predicted-period';
			}

			// B. 判断排卵期 (下个周期开始前14天是排卵日，前5后4是排卵期)
			const ovulationDayMs = nextCycleStart - 14 * dayMs;
			const ovulationStartMs = ovulationDayMs - 5 * dayMs;
			const ovulationEndMs = ovulationDayMs + 4 * dayMs;

			if (targetTime >= ovulationStartMs && targetTime <= ovulationEndMs) return 'ovulation';

			// C. 其余都是安全期
			return 'safe';
		}

		// --- AI 专属状态文本生成 (注入到 Prompt) ---
		window.getPeriodStatusForAi = function() {
			const todayStr = formatToYYYYMMDD(new Date());
			const type = getDateType(todayStr); // 用于UI的判断

			if (type === 'unknown') return ""; // 无数据不同步

			// 计算距离下次大姨妈还有几天 (用于辅助文本)
			let daysToNext = 0;
			let latestStart = null;
			let allStarts = periodData.history.map(h => new Date(h.start + "T00:00:00").getTime());
			if (periodData.activeStart) allStarts.push(new Date(periodData.activeStart + "T00:00:00").getTime());
			allStarts.sort((a,b) => b-a);
			if (allStarts.length > 0) latestStart = allStarts[0];

			let isOverdue = false;
			let daysOverdue = 0;

			if (latestStart) {
				const cycleLength = parseInt(periodData.cycleLength) || 28;
				const cycleMs = cycleLength * 24 * 60 * 60 * 1000;
				const todayTime = new Date(todayStr + "T00:00:00").getTime();
				
				const diffMs = todayTime - latestStart;
				const cyclesPassed = Math.floor(diffMs / cycleMs);
				
				const nextCycleStart = latestStart + (cyclesPassed + 1) * cycleMs;
				daysToNext = Math.floor((nextCycleStart - todayTime) / (24 * 60 * 60 * 1000));
				
				// 真正推迟的天数，是基于上一次大姨妈 + 1个周期 算起的
				daysOverdue = Math.floor((todayTime - (latestStart + cycleMs)) / (24 * 60 * 60 * 1000));
				
				if (!periodData.activeStart && daysOverdue >= 0) {
					isOverdue = true;
				}
			}

			// 组装强制约束指令
			let statusDesc = "";
			let aiBehavior = "";

			if (type === 'recorded') {
				// 实际经期中
				let dayNum = 1;
				if (periodData.activeStart) {
					dayNum = Math.floor((new Date(todayStr + "T00:00:00").getTime() - new Date(periodData.activeStart + "T00:00:00").getTime()) / (24*60*60*1000)) + 1;
				}
				statusDesc = `【经期中】(当前是实际经期的第 ${dayNum} 天)`;
				aiBehavior = `用户目前正处于生理期。请在聊天中自然地表现出温柔、体贴和关心，可以偶尔提醒她多喝热水、注意保暖或早点休息。**严禁**向她建议剧烈运动或食用生冷食物。`;
			} else if (isOverdue) {
				// 已经推迟（预测经期但未记录）
				let dayNum = daysOverdue + 1; // 推迟的第一天算预测期的第1天
				statusDesc = `【预测经期】(根据健康APP提示，今天应该处于经期第 ${dayNum} 天，但用户没有记录来月经)`;
				
				if (dayNum > 15) {
					aiBehavior = `根据健康App提示，用户的大姨妈已经严重推迟超过半个月了（推迟了${dayNum}天）！你现在对她的身体状况感到非常焦虑和担忧，强烈怀疑她是否是怀孕了，或者身体出了什么严重的状况（如内分泌失调、妇科疾病等）。请在聊天中表现出极度的关切和焦急，严肃地劝导她立刻去医院就医检查，绝不能再拖延了！`;
				} else if (dayNum > 3) {
					aiBehavior = `根据健康App提示，用户的大姨妈已经误差/推迟超过3天了（推迟了${dayNum}天）。这可能意味着她的身体状态出现变化或经期不规律。请在聊天中表现出明显的关心、担忧，主动去询问她大姨妈是不是推迟了，身体有没有不舒服，让她注意身体并着重关注此事。`;
				} else {
					aiBehavior = `根据健康App预测，用户的经期应该就在这几天到来，但她目前还没有记录。你可以在聊天中自然地询问一句她“那个”是不是快来了/来了没有，以表达你的关心。如果用户说没来，安慰她不要着急。`;
				}
			} else if (type === 'ovulation') {
				statusDesc = `【排卵期/易孕期】(距离下次经期预估还有 ${daysToNext} 天)`;
				aiBehavior = `用户目前处于排卵期，可能受体内激素影响导致体温略高、情绪有细微波动。保持平稳温柔的日常互动即可，可在亲密关系互动中适当提及，但禁止在日常互动中频繁提及。`;
			} else {
				statusDesc = `【安全期】(距离下次经期预估还有 ${daysToNext} 天)`;
				aiBehavior = `用户目前处于安全期，身体和情绪状态相对平稳。请保持正常的角色扮演和日常互动，可在亲密关系互动中适当提及，但必须以用户的感受为优先。`;
			}

			return `\n【用户当前生理期状态 (内部隐藏设定)】\n当前状态：${statusDesc}\n互动约束：${aiBehavior}\n`;
		};

		// --- 渲染日历 UI ---
		function renderCalendar() {
			const grid = document.getElementById('period-calendar-grid');
			const monthYearTxt = document.getElementById('calendar-month-year');
			if (!grid || !monthYearTxt) return;

			grid.innerHTML = '';
			monthYearTxt.textContent = `${currentCalendarYear}年 ${currentCalendarMonth + 1}月`;

			const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1);
			const lastDay = new Date(currentCalendarYear, currentCalendarMonth + 1, 0);
			const startDayOfWeek = firstDay.getDay(); // 0(日) - 6(六)
			const daysInMonth = lastDay.getDate();

			// 填充前面的空白
			for (let i = 0; i < startDayOfWeek; i++) {
				grid.innerHTML += `<div></div>`;
			}

			// 填充日期
			for (let day = 1; day <= daysInMonth; day++) {
				const dateStr = formatToYYYYMMDD(new Date(currentCalendarYear, currentCalendarMonth, day));
				const type = getDateType(dateStr);
				
				let bgStyle = "background: #fff; color: #333;";
				if (type === 'recorded') bgStyle = "background: #ff4d4f; color: #fff; font-weight: bold; border-radius: 8px;";
				else if (type === 'predicted-period') bgStyle = "background: #ffccc7; color: #ff4d4f; border-radius: 8px;";
				else if (type === 'ovulation') bgStyle = "background: #f3e8ff; color: #722ed1; border-radius: 8px;";
				else if (type === 'safe') bgStyle = "background: #f6ffed; color: #52c41a; border-radius: 8px;";

				const isToday = dateStr === formatToYYYYMMDD(new Date());
				if (isToday && type !== 'recorded') bgStyle += " border: 2px solid #ff6b81;";

				grid.innerHTML += `<div style="padding: 10px 0; cursor: pointer; ${bgStyle}" onclick="handleDateClick('${dateStr}')">${day}</div>`;
			}

			updateTopStatusDisplay();
		}

		// --- 更新顶部大字状态卡片 ---
		function updateTopStatusDisplay() {
			const display = document.getElementById('period-status-display');
			const todayStr = formatToYYYYMMDD(new Date());
			const type = getDateType(todayStr);

			if (type === 'unknown') {
				display.innerHTML = "请在下方日历点击日期<br>标记经期开始";
				return;
			}

			let daysToNext = 0;
			let latestStart = null;
			let allStarts = periodData.history.map(h => new Date(h.start + "T00:00:00").getTime());
			if (periodData.activeStart) allStarts.push(new Date(periodData.activeStart + "T00:00:00").getTime());
			allStarts.sort((a,b) => b-a);
			if (allStarts.length > 0) latestStart = allStarts[0];

			let isOverdue = false;
			let daysOverdue = 0;

			if (latestStart) {
				const cycleLength = parseInt(periodData.cycleLength) || 28;
				const cycleMs = cycleLength * 24 * 60 * 60 * 1000;
				const todayTime = new Date(todayStr + "T00:00:00").getTime();
				
				const diffMs = todayTime - latestStart;
				const cyclesPassed = Math.floor(diffMs / cycleMs);
				
				const nextCycleStart = latestStart + (cyclesPassed + 1) * cycleMs;
				daysToNext = Math.floor((nextCycleStart - todayTime) / (24 * 60 * 60 * 1000));

				// 真正推迟的天数，计算与AI同步
				daysOverdue = Math.floor((todayTime - (latestStart + cycleMs)) / (24 * 60 * 60 * 1000));
				if (!periodData.activeStart && daysOverdue >= 0) {
					isOverdue = true;
				}
			}

			if (type === 'recorded') {
				// 用户明确记录的实际经期
				let dayNum = 1;
				if (periodData.activeStart) {
					dayNum = Math.floor((new Date(todayStr + "T00:00:00").getTime() - new Date(periodData.activeStart + "T00:00:00").getTime()) / (24*60*60*1000)) + 1;
				}
				display.innerHTML = `🩸 经期中 (第 ${dayNum} 天)<br><span style="font-size:12px; font-weight:normal;">记得多喝热水，注意休息哦</span>`;
			} else if (isOverdue) {
				// APP预测到了经期，但是用户没有点击记录（即推迟/误差）
				let dayNum = daysOverdue + 1;
				if (dayNum > 15) {
					display.innerHTML = `⚠️ 严重推迟 (${dayNum} 天)<br><span style="font-size:12px; font-weight:bold; color:#ffeb3b; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">迟迟未见，建议尽快就医排除怀孕或健康隐患！</span>`;
				} else if (dayNum > 3) {
					display.innerHTML = `🩸 预测期 (未记录)<br><span style="font-size:12px; font-weight:normal;">已推迟 ${dayNum} 天，请留意身体状况哦</span>`;
				} else {
					display.innerHTML = `🩸 预测期 (第 ${dayNum} 天)<br><span style="font-size:12px; font-weight:normal;">根据预测，大姨妈可能就在这几天到来</span>`;
				}
			} else if (type === 'predicted-period') {
				// 兜底保护，如果在预测期内但并没有满足Overdue条件
				display.innerHTML = `🩸 预测期<br><span style="font-size:12px; font-weight:normal;">大姨妈即将造访，准备好哦</span>`;
			} else if (type === 'ovulation') {
				display.innerHTML = `🌸 排卵期<br><span style="font-size:12px; font-weight:normal;">距下次预估还有 ${daysToNext} 天</span>`;
			} else {
				display.innerHTML = `🍀 安全期<br><span style="font-size:12px; font-weight:normal;">距下次预估还有 ${daysToNext} 天</span>`;
			}
		}

		// --- 点击日期处理 (状态机核心) ---
		window.handleDateClick = function(dateStr) {
			// 旧数据兼容：如果还没升级数据结构，强转一下
			if (periodData.lastStartDate && !periodData.migrated) {
				periodData.activeStart = periodData.lastStartDate;
				periodData.migrated = true;
			}

			if (!periodData.activeStart) {
				// 状态 A：当前不在经期中 -> 询问是否开始
				if (confirm(`要将 ${dateStr} 标记为【大姨妈第一天】吗？\n标记后会一直计算为经期，直到你标记结束。`)) {
					periodData.activeStart = dateStr;
					savePeriodDataToLocal();
					renderCalendar();
				}
			} else {
				// 状态 B：当前正在经期中
				const startMs = new Date(periodData.activeStart + "T00:00:00").getTime();
				const clickMs = new Date(dateStr + "T00:00:00").getTime();

				if (clickMs >= startMs) {
					// 点击了开始日期之后的某天 -> 标记结束
					if (confirm(`要将 ${dateStr} 标记为【经期结束日】吗？\n这次经期记录将被保存到历史中。`)) {
						periodData.history.push({
							start: periodData.activeStart,
							end: dateStr
						});
						periodData.activeStart = null; // 结束当前状态
						savePeriodDataToLocal();
						renderCalendar();
					}
				} else {
					// 点击了开始日期之前的某天 -> 可能是记错了，想修改开始时间
					if (confirm(`修改当前经期开始时间为 ${dateStr} 吗？`)) {
						periodData.activeStart = dateStr;
						savePeriodDataToLocal();
						renderCalendar();
					}
				}
			}
		};

		// 撤销操作
		if (periodUndoBtn) {
			periodUndoBtn.addEventListener('click', () => {
				if (periodData.activeStart) {
					if (confirm("确定撤销【本次经期开始】的标记吗？")) {
						periodData.activeStart = null;
						savePeriodDataToLocal();
						renderCalendar();
					}
				} else if (periodData.history.length > 0) {
					if (confirm("当前不在经期。确定要删除【最近一次保存的历史记录】吗？")) {
						periodData.history.pop();
						savePeriodDataToLocal();
						renderCalendar();
					}
				} else {
					alert("当前没有可撤销的记录。");
				}
			});
		}

		// 日历翻页
		document.getElementById('calendar-prev-btn')?.addEventListener('click', () => {
			currentCalendarMonth--;
			if (currentCalendarMonth < 0) { currentCalendarMonth = 11; currentCalendarYear--; }
			renderCalendar();
		});
		document.getElementById('calendar-next-btn')?.addEventListener('click', () => {
			currentCalendarMonth++;
			if (currentCalendarMonth > 11) { currentCalendarMonth = 0; currentCalendarYear++; }
			renderCalendar();
		});

		// 渲染整体页面与授权列表
		function renderPeriodTrackingPage() {
			// 旧数据兼容
			if (periodData.lastStartDate && !periodData.migrated) {
				periodData.activeStart = periodData.lastStartDate;
				periodData.migrated = true;
				savePeriodDataToLocal();
			}

			document.getElementById('period-duration').value = periodData.duration || 6;
			document.getElementById('period-cycle-length').value = periodData.cycleLength || 28;

			// 渲染日历
			currentCalendarYear = new Date().getFullYear();
			currentCalendarMonth = new Date().getMonth();
			renderCalendar();

			// 渲染可同步的角色列表
			const container = document.getElementById('period-sync-chars-container');
			container.innerHTML = '';
			const validChars = characters.filter(c => c.timeAware && c.type !== 'group');

			if (validChars.length === 0) {
				container.innerHTML = '<div style="text-align:center; color:#999; padding:30px 10px;">没有找到开启时间感知的私聊角色</div>';
				return;
			}

			validChars.forEach(char => {
				const isChecked = periodData.syncCharIds.includes(char.id) ? 'checked' : '';
				const avatarHtml = char.avatar ? `<img src="${char.avatar}" style="width:24px; height:24px; border-radius:4px; margin-right:8px; object-fit:cover;">` : `<div style="width:24px; height:24px; border-radius:4px; margin-right:8px; background:#eee; display:flex; align-items:center; justify-content:center;"><i class="fas fa-user" style="font-size:12px;color:#999;"></i></div>`;
				
				container.innerHTML += `
					<label class="checkbox-item" style="margin-bottom: 8px;">
						<input type="checkbox" value="${char.id}" class="period-sync-cb" ${isChecked}>
						<span class="custom-check-circle"></span>
						<div style="display:flex; align-items:center;">
							${avatarHtml}
							<span>${char.name}</span>
						</div>
					</label>
				`;
			});
		}

		// 页面跳转绑定
		if (periodEntryBtn) {
			periodEntryBtn.addEventListener('click', () => {
				renderPeriodTrackingPage();
				switchPage('period-tracking-page');
				switchTopBar('period-tracking-top');
			});
		}

		if (periodTopBack) {
			periodTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		// 保存基础设置和同步角色
		if (periodSaveBtn) {
			periodSaveBtn.addEventListener('click', () => {
				const durationVal = parseInt(document.getElementById('period-duration').value);
				const cycleVal = parseInt(document.getElementById('period-cycle-length').value);

				if (isNaN(durationVal) || isNaN(cycleVal) || durationVal <= 0 || cycleVal <= 0) {
					alert("天数必须是正整数！"); return;
				}
				if (durationVal >= cycleVal) {
					alert("经期长度不能大于周期长度！"); return;
				}

				const selectedIds =[]; // 初始化数组
				document.querySelectorAll('.period-sync-cb:checked').forEach(cb => {
					selectedIds.push(cb.value);
				});

				periodData.duration = durationVal;
				periodData.cycleLength = cycleVal;
				periodData.syncCharIds = selectedIds;

				savePeriodDataToLocal();
				
				// 立即重新渲染以刷新顶部的状态显示
				renderPeriodTrackingPage();
				alert('经期记录与同步设置已保存！');
			});
		}
		// 清理旧数据按钮 (变量名已修改，防止冲突)
		const periodClearHistoryBtn = document.getElementById('period-clear-history-btn');
		
		if (periodClearHistoryBtn) {
			periodClearHistoryBtn.addEventListener('click', () => {
				// 1. 检查是否有足够的数据清理
				if (!periodData.history || periodData.history.length <= 1) {
					alert("记录较少，无需清理。");
					return;
				}

				if (confirm(`当前共有 ${periodData.history.length} 条历史记录。\n确定要清理掉旧数据，仅保留最近的一次记录吗？\n(这不会影响当前的状态预测)`)) {
					// 2. 只保留最后一条 (时间最近的一条)
					// 为了保险，先按 start 日期排序，再取最后一条
					periodData.history.sort((a, b) => new Date(a.start) - new Date(b.start));
					
					const lastRecord = periodData.history[periodData.history.length - 1];
					periodData.history = [lastRecord];

					savePeriodDataToLocal();
					renderPeriodTrackingPage(); // 刷新页面
					alert("旧数据已清理，备份体积已优化。");
				}
			});
		}
		// ============================================================
		// 【新增】查手机系统 (Check Phone System)
		// ============================================================

		let currentCpCharId = null; // 当前正在查手机的角色ID
		let currentCpData = null;   // 当前角色的手机数据缓存

		// --- 1. 导航与入口绑定 ---
		const cpEntryBtn = document.getElementById('check-phone-entry-btn');
		const cpListTopBack = document.querySelector('#check-phone-list-top .top-bar-back');
		const cpDetailTopBack = document.querySelector('#check-phone-detail-top .top-bar-back');
		const cpRefreshBtn = document.getElementById('check-phone-refresh-btn');

		if (cpEntryBtn) {
			cpEntryBtn.addEventListener('click', () => {
				renderCpList();
				switchPage('check-phone-list-page');
				switchTopBar('check-phone-list-top');
			});
		}

		if (cpListTopBack) {
			cpListTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		if (cpDetailTopBack) {
			cpDetailTopBack.addEventListener('click', () => {
				currentCpCharId = null;
				stopCpClock();
				switchPage('check-phone-list-page');
				switchTopBar('check-phone-list-top');
			});
		}

		// --- 2. 渲染角色列表 ---
		function renderCpList() {
			const container = document.getElementById('check-phone-list-container');
			container.innerHTML = '';

			const validChars = characters.filter(c => c.type !== 'group');
			if (validChars.length === 0) {
				container.innerHTML = '<div style="text-align:center; padding:50px; color:#999;">暂无私聊角色</div>';
				return;
			}

			validChars.forEach(char => {
				const avatarHtml = char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user" style="font-size:24px; color:#ccc; line-height:44px; text-align:center; display:block;"></i>`;
				
				container.innerHTML += `
					<div class="diary-char-card" onclick="openCpDetail('${char.id}')">
						<div class="d-char-avatar">${avatarHtml}</div>
						<div class="d-char-info">
							<div class="d-char-name">${char.name}</div>
							<div class="d-char-desc">点击突击检查手机</div>
						</div>
						<i class="fas fa-chevron-right" style="color:#ccc;"></i>
					</div>
				`;
			});
		}

		// --- 3. 打开手机详情页 ---
		window.openCpDetail = async function(charId) {
			currentCpCharId = charId;
			const char = characters.find(c => c.id === charId);
			if (!char) return;

			document.getElementById('check-phone-title').textContent = `${char.name} 的手机`;
			
			const avatarDisplay = document.getElementById('cp-reaction-avatar');
			avatarDisplay.innerHTML = char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user"></i>`;

			// 【新增】：启动实时时钟和随机电量
			startCpClock();
			setRandomBattery();

			switchPage('check-phone-detail-page');
			switchTopBar('check-phone-detail-top');
			
			// 确保全屏显示修复
			const contentArea = document.getElementById('main-content-area');
			if(contentArea) contentArea.style.top = '44px';

			// 检查是否已有缓存数据
			if (char.phoneData && char.phoneData.password) {
				currentCpData = char.phoneData;
				initPhoneUI(char);
			} else {
				// 没有数据，触发AI生成
				await generatePhoneData(char);
			}
		};

		// 刷新按钮重新生成
		if (cpRefreshBtn) {
			cpRefreshBtn.addEventListener('click', async () => {
				if (!currentCpCharId) return;
				const char = characters.find(c => c.id === currentCpCharId);
				if (confirm(`确定要重新黑入并生成 ${char.name} 的手机数据吗？`)) {
					
                    // ---【新增】UI 反馈 ---
                    const icon = cpRefreshBtn.querySelector('i');
                    icon.classList.add('fa-spin'); // 图标开始旋转
                    cpRefreshBtn.disabled = true;   // 禁用按钮防止重复点击

					try {
                        // 调用生成函数
						await generatePhoneData(char, true); // 传入 true 表示是刷新操作
					} catch(e) {
                        // 即使出错也要恢复按钮
                        console.error("刷新手机数据时出错:", e);
                    } finally {
                        // ---【新增】恢复 UI ---
                        icon.classList.remove('fa-spin'); // 停止旋转
                        cpRefreshBtn.disabled = false;    // 恢复按钮点击
                    }
				}
			});
		}

		// 【终极防撞】安全获取反应的工具函数
		function getSafeReaction(key, fallbackText) {
			// 确保对象存在，哪怕AI漏写了reactions，也不会报错死机
			if (currentCpData && currentCpData.reactions && currentCpData.reactions[key]) {
				return currentCpData.reactions[key];
			}
			return fallbackText;
		}

		// --- 4. 初始化手机 UI 状态 ---
		function initPhoneUI(char) {
			// 【核心验证】：检测密码是否严格为 4 位纯数字
			if (currentCpData && currentCpData.password) {
				const pwdStr = String(currentCpData.password);
				if (!/^\d{4}$/.test(pwdStr)) {
					setTimeout(() => {
						alert(`⚠️ 密码生成异常！\nAI 生成了非标准格式的密码：[${pwdStr}]\n正常情况无法输入，请使用后门密码 9999 强制解锁！`);
					}, 300);
				} else {
					console.log(`[查手机] AI生成的合法密码为: ${pwdStr}`); 
				}
			}

			// 恢复锁屏状态
			document.querySelectorAll('.phone-screen').forEach(el => el.classList.remove('active'));
			document.getElementById('cp-screen-lock').classList.add('active');
			document.getElementById('cp-lock-error').style.display = 'none';

			// 锁屏状态下隐藏顶部的状态栏
			const statusBar = document.getElementById('cp-status-bar');
			if (statusBar) statusBar.style.display = 'none';

			// 重置密码盘
			currentPin = '';
			updatePinDisplay();

			// 设置壁纸
			const homeScreen = document.getElementById('cp-screen-home');
			if (currentCpData && currentCpData.wallpaper) {
				homeScreen.style.backgroundImage = `url('${currentCpData.wallpaper}')`;
			} else {
				homeScreen.style.backgroundImage = `url('https://s41.ax1x.com/2026/02/07/pZoDx1H.jpg')`;
			}

			// 【安全调用】：使用安全函数获取初始反应，绝不死机
			setReaction(getSafeReaction('lock_screen', "你干嘛要看我手机？"));
		}

		// 设置反应文本
		function setReaction(text) {
			const reactionEl = document.getElementById('cp-reaction-text');
			if (reactionEl) {
				reactionEl.innerHTML = formatTextForDisplay(text);
			}
		}

		// --- 5. 锁屏拨号盘交互逻辑 ---
		let currentPin = '';
		const MAX_PIN_LENGTH = 4; // 严格限定界面最多只能输 4 位

		// 输入数字
		window.handlePinInput = function(num) {
			if (currentPin.length < MAX_PIN_LENGTH) {
				currentPin += num;
				updatePinDisplay();
				document.getElementById('cp-lock-error').style.display = 'none';
				
				// 输入满 4 位自动触发校验
				if (currentPin.length === MAX_PIN_LENGTH) {
					setTimeout(handlePinSubmit, 150); 
				}
			}
		};

		// 删除数字
		window.handlePinDelete = function() {
			if (currentPin.length > 0) {
				currentPin = currentPin.slice(0, -1);
				updatePinDisplay();
				document.getElementById('cp-lock-error').style.display = 'none';
			}
		};

		// 更新圆点UI (固定显示 4 个点)
		function updatePinDisplay() {
			const display = document.getElementById('cp-pin-display');
			if (!display) return;
			
			let html = '';
			for (let i = 0; i < MAX_PIN_LENGTH; i++) {
				if (i < currentPin.length) {
					html += '<div class="pin-dot filled"></div>';
				} else {
					html += '<div class="pin-dot"></div>';
				}
			}
			display.innerHTML = html;
		}

		// 提交验证密码
		window.handlePinSubmit = function() {
			const errorMsg = document.getElementById('cp-lock-error');
			if (!currentCpData) return;

			const correctPwd = String(currentCpData.password);

			// 【万能后门】：输入 9999 或者匹配 AI 的密码均可放行
			if (currentPin === correctPwd || currentPin === '9999') {
				// 解锁成功
				document.getElementById('cp-screen-lock').classList.remove('active');
				document.getElementById('cp-screen-home').classList.add('active');
				errorMsg.style.display = 'none';

				// 解锁成功后，显示状态栏
				const statusBar = document.getElementById('cp-status-bar');
				if (statusBar) statusBar.style.display = 'flex';

				if (currentPin === '9999') {
					setReaction("居然用万能密码作弊... 算你狠！");
				} else {
					// 【安全调用】：获取解锁成功反应
					setReaction(getSafeReaction('unlock_success', "居然被你猜中了..."));
				}
			} else {
				// 解锁失败
				errorMsg.style.display = 'block';

				// 【安全调用】：获取解锁失败反应
				setReaction(getSafeReaction('unlock_fail', "密码不对哦~"));
				
				// 播放震动错误动画，然后清空输入
				const display = document.getElementById('cp-pin-display');
				display.classList.add('shake-anim');
				
				setTimeout(() => {
					display.classList.remove('shake-anim');
					currentPin = '';
					updatePinDisplay();
				}, 400); // 400ms后重置状态
			}
		};

		// --- 6. 打开/关闭具体 APP ---
		window.openCpApp = function(appId) {
			const home = document.getElementById('cp-screen-home');
			const appScreen = document.getElementById('cp-screen-app');
			const titleEl = document.getElementById('cp-app-title');
			const contentEl = document.getElementById('cp-app-content');

			home.classList.remove('active');
			appScreen.classList.add('active');

			const appNames = {
				'sms': '短信', 'wechat': 'x信', 'browser': '浏览器', 
				'tiktok': '某音', 'phone': '电话', 'wallet': '钱包', 
				'gallery': '相册', 'settings': '设置'
			};
			titleEl.textContent = appNames[appId] || '应用';
			contentEl.innerHTML = ''; // 清空

			// 设置对应反应
			const reactionKey = `open_${appId}`;
			if (currentCpData.reactions[reactionKey]) {
				setReaction(currentCpData.reactions[reactionKey]);
			}

			// 渲染不同APP的内容
			renderAppContent(appId, contentEl);

			// 【精准修复】：只针对某音和相册，进入时强制显示在顶部，其他页面不动！
			if (appId === 'tiktok' || appId === 'gallery') {
				setTimeout(() => {
					contentEl.scrollTop = 0;
				}, 10);
			}
		};

		window.closeCpApp = function() {
			document.getElementById('cp-screen-app').classList.remove('active');
			document.getElementById('cp-screen-home').classList.add('active');
			setReaction("随便看吧，反正也没什么不能看的。");
		};

		// --- 7. 渲染具体 APP 数据 (修复面具身份同步版) ---
		function renderAppContent(appId, container) {
			let html = '';
			const data = currentCpData;

			if (appId === 'sms') {
				if (data.sms && data.sms.length > 0) {
					data.sms.forEach(msg => {
						html += `<div class="sim-sms-item">
							<span style="font-size:12px; color:#999; margin-bottom:4px;">${msg.sender}</span>
							<span style="color:#333;">${msg.content}</span>
						</div>`;
					});
				} else { html = '<div style="text-align:center; padding:20px; color:#999;">暂无短信</div>'; }
			} 
			else if (appId === 'wechat') {
				const char = characters.find(c => c.id === currentCpCharId);
				
				// 【核心修复】：获取正确的面具名字与头像
				let myUserName = userInfo.name;
				let myAvatarUrl = userInfo.avatar;
				
				if (char) {
					if (char.userMaskId) {
						const boundMask = userMasks.find(m => m.id === char.userMaskId);
						if (boundMask) {
							if (boundMask.name) myUserName = boundMask.name;
							if (boundMask.avatar) myAvatarUrl = boundMask.avatar;
						}
					} else if (char.userName && char.userName.trim()) {
						myUserName = char.userName.trim();
						if (char.userAvatar) myAvatarUrl = char.userAvatar;
					}
				}

				const myAvatar = myAvatarUrl ? `<img src="${myAvatarUrl}">` : `<i class="${userInfo.avatarIcon || 'fas fa-user'}"></i>`;
				const charAvatarHtml = char && char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user"></i>`;

				html = `
				<div id="wechat-list-view" style="display:block;">
					<!-- 真实的聊天 (置顶) -->
					<div class="sim-wechat-item" onclick="openSimWechatChat('real')">
						<div class="avatar">${myAvatar}</div>
						<div class="info">
							<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
								<span style="font-weight:bold; color:#333;">${myUserName} (你)</span>
								<span style="font-size:12px; color:#999;">刚刚</span>
							</div>
							<div style="color:#999; font-size:13px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
								${char && char.chatHistory && char.chatHistory.length > 0 ? char.chatHistory[char.chatHistory.length-1].text.replace(/\[.*?\]/g,'').substring(0,15) : "点击查看聊天记录"}
							</div>
						</div>
					</div>
				`;

				// AI 生成的假列表
				if (data.wechat_fakes) {
					data.wechat_fakes.forEach((f, idx) => {
						html += `
						<div class="sim-wechat-item" onclick="openSimWechatChat('fake', ${idx})">
							<div class="avatar" style="background:#3498db;"><i class="fas fa-user-friends"></i></div>
							<div class="info">
								<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
									<span style="font-weight:bold; color:#333;">${f.name}</span>
									<span style="font-size:12px; color:#999;">${f.time || '昨天'}</span>
								</div>
								<div style="color:#999; font-size:13px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
									${f.chatHistory && f.chatHistory.length > 0 ? f.chatHistory[f.chatHistory.length-1].content : '...'}
								</div>
							</div>
						</div>`;
					});
				}
				html += `</div>`; // list-view 结束

				// 聊天详情视图容器
				html += `
				<div id="wechat-chat-view" style="display:none; position:absolute; top:0; left:0; right:0; bottom:0; z-index:50; flex-direction:column; background:#ededed; padding:0;">
					<div style="height: 68px; padding: 24px 15px 0 15px; background:#fff; border-bottom:1px solid #ddd; display:flex; align-items:center; box-sizing: border-box;">
						<i class="fas fa-chevron-left" style="font-size:18px; cursor:pointer; width:30px;" onclick="document.getElementById('wechat-chat-view').style.display='none'; document.getElementById('wechat-list-view').style.display='block'; if(typeof setReaction === 'function') setReaction(currentCpData.reactions.open_wechat || '随便看吧...');"></i>
						<span id="wechat-chat-target-name" style="flex:1; text-align:center; font-weight:bold; font-size:16px; color:#333;">联系人</span>
						<i class="fas fa-ellipsis-h" style="width:30px; text-align:right; color:#ccc;"></i>
					</div>
					<div id="wechat-chat-bubbles" style="flex:1; overflow-y:auto; padding:15px 10px;"></div>
				</div>
				`;

				container.innerHTML = html;

				// 绑定打开聊天窗口的全局函数
				window.openSimWechatChat = function(type, idx = 0) {
					document.getElementById('wechat-list-view').style.display = 'none';
					document.getElementById('wechat-chat-view').style.display = 'flex';
					const bubbleContainer = document.getElementById('wechat-chat-bubbles');
					let bubblesHtml = '';

					let explanation = "";

					if (type === 'real') {
						document.getElementById('wechat-chat-target-name').textContent = `${myUserName}`;
						
						// 【核心修改】读取 AI 专属生成的真实聊天吐槽，兜底默认文本
						explanation = currentCpData.reactions.open_real_wechat || "这不就是我们俩的聊天记录嘛，你连自己的醋都要吃呀？"; 

						if (char && char.chatHistory) {
							const realChats = char.chatHistory.filter(m => !m.isHidden && m.type !== 'system').slice(-5);
							realChats.forEach(m => {
								const isSelf = (m.type === 'received'); 
								const side = isSelf ? 'right' : 'left';
								const avatar = isSelf ? charAvatarHtml : myAvatar;
								const text = m.text ? m.text.replace(/\[.*?\]/g, '') : '[图片/文件]';
								
								bubblesHtml += `
								<div class="sim-chat-bubble-row ${side}">
									<div class="avatar">${avatar}</div>
									<div class="sim-chat-bubble">${text}</div>
								</div>`;
							});
						}
					} else {
						const npcData = data.wechat_fakes[idx];
						const name = npcData.name || "";
						document.getElementById('wechat-chat-target-name').textContent = name;
						
						// 【核心修改】彻底抛弃写死的判断，直接读取 AI 为这段聊天专属生成的 reaction
						explanation = npcData.reaction || `就是一个普通朋友，你看聊天记录，真没什么特别的。`;

						const npcAvatarHtml = `<div style="width:100%;height:100%;background:#3498db;color:#fff;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user-friends"></i></div>`;
						
						if (npcData.chatHistory) {
							npcData.chatHistory.forEach(m => {
								const isSelf = (m.sender === 'Self' || m.sender === '自己');
								const side = isSelf ? 'right' : 'left';
								const avatar = isSelf ? charAvatarHtml : npcAvatarHtml;
								bubblesHtml += `
								<div class="sim-chat-bubble-row ${side}">
									<div class="avatar">${avatar}</div>
									<div class="sim-chat-bubble">${m.content}</div>
								</div>`;
							});
						}
					}
					
					// 渲染气泡
					bubbleContainer.innerHTML = bubblesHtml || '<div style="text-align:center;color:#ccc;font-size:12px;">暂无记录</div>';
					
					// 【核心】更新顶部的反应文本，表现出角色正在根据 AI 生成的数据当场解释
					if(typeof setReaction === 'function') {
						setReaction(explanation);
					}
				};
				return; 
			}
			else if (appId === 'browser') {
				if (data.browser) {
					html = '<div style="background:#fff; border-radius:8px; padding:10px;">';
					html += '<div style="font-weight:bold; margin-bottom:10px; color:#666;">最近搜索与浏览痕迹</div>';
					data.browser.forEach(item => {
						html += `
						<div style="padding:12px 0; border-bottom:1px solid #f0f0f0;">
							<div style="color:#333; font-weight:bold;"><i class="fas fa-search" style="color:#ccc; margin-right:10px;"></i>${item.query}</div>
							<div style="font-size:12px; color:#888; margin-top:6px; background:#f9f9f9; padding:8px; border-radius:4px; border-left:3px solid #00a8ff;">
								💡 内心OS: ${item.thoughts}
							</div>
						</div>`;
					});
					html += '</div>';
				}
			}
			else if (appId === 'tiktok') {
				if (data.tiktok) {
					data.tiktok.forEach(v => {
						let commentHtml = v.my_comment ? `
							<div class="sim-tiktok-comment">
								<span style="color:#ccc;">我的评论: </span>"${v.my_comment}"
							</div>` : '';
						let thoughtHtml = v.thoughts ? `
							<div style="margin-top:10px; font-size:12px; color:#fbc531; border-top:1px dashed rgba(255,255,255,0.2); padding-top:8px;">
								💭 刷完的想法: ${v.thoughts}
							</div>` : '';

						html += `<div class="sim-tiktok-item">
							<div style="font-weight:bold; margin-bottom:5px; font-size:15px;">@${v.author}</div>
							<div style="font-size:13px; margin-bottom:10px; line-height:1.4;">${v.desc}</div>
							<div style="display:flex; gap:15px; font-size:12px; color:#ddd;">
								<span><i class="fas fa-heart" style="color:${v.liked?'#ff4d4f':'#fff'}"></i> ${v.liked?'已赞':'未赞'}</span>
								<span><i class="fas fa-comment"></i> ${v.my_comment ? '已评' : '抢首评'}</span>
							</div>
							${commentHtml}
							${thoughtHtml}
						</div>`;
					});
				}
			}
			else if (appId === 'phone') {
				if (data.calls) {
					html = '<div style="background:#fff; border-radius:8px; padding:10px;">';
					data.calls.forEach(c => {
						const isMissed = c.type.includes('未接');
						const color = isMissed ? '#ff4d4f' : '#333';
						const icon = isMissed ? 'fa-phone-slash' : (c.type.includes('拨出') ? 'fa-phone-alt' : 'fa-phone-volume');
						
						html += `<div style="padding:12px 0; border-bottom:1px solid #f0f0f0;">
							<div style="display:flex; justify-content:space-between; margin-bottom:6px;">
								<div style="font-weight:bold; color:${color};"><i class="fas ${icon}" style="font-size:12px; margin-right:5px;"></i>${c.name}</div>
								<div style="color:#999; font-size:12px;">${c.time}</div>
							</div>
							<div style="font-size:12px; color:#666; background:#f9f9f9; padding:6px; border-radius:4px;">
								${isMissed ? '❌ 未接原因：' : '📞 通话概要：'}${c.desc}
							</div>
						</div>`;
					});
					html += '</div>';
				}
			}
			else if (appId === 'wallet') {
				if (data.wallet) {
					html = `
					<div style="background: linear-gradient(135deg, #07c160, #0abf5b); color:#fff; padding:20px; border-radius:12px; text-align:center; margin-bottom:15px; box-shadow: 0 4px 10px rgba(7,193,96,0.3);">
						<div style="font-size:14px; opacity:0.9;">总资产估值</div>
						<div style="font-size:36px; font-weight:bold; margin-top:5px; font-family:arial;">¥ ${data.wallet.total_balance || '0.00'}</div>
					</div>`;
					
					if (data.wallet.bank_accounts && data.wallet.bank_accounts.length > 0) {
						html += `<div style="font-weight:bold; margin-bottom:10px; color:#666; padding-left:5px;">储蓄卡</div>`;
						data.wallet.bank_accounts.forEach(b => {
							html += `<div class="sim-wallet-card" style="background: linear-gradient(135deg, #4A90E2, #003973);">
								<div style="display:flex; justify-content:space-between; align-items:center;">
									<div><i class="fas fa-university"></i> ${b.name}</div>
									<div style="font-size:18px; font-weight:bold;">¥ ${b.balance}</div>
								</div>
							</div>`;
						});
					}

					if (data.wallet.funds && data.wallet.funds.length > 0) {
						html += `<div style="font-weight:bold; margin-bottom:10px; margin-top:20px; color:#666; padding-left:5px;">理财/基金</div>`;
						data.wallet.funds.forEach(f => {
							const isProfit = f.profit && f.profit.includes('+');
							const pColor = isProfit ? '#ff4d4f' : '#07c160'; 
							html += `<div style="background:#fff; border-radius:8px; padding:15px; margin-bottom:10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center;">
								<div>
									<div style="font-weight:bold; color:#333;">${f.name}</div>
									<div style="font-size:12px; color:#999; margin-top:4px;">持仓金额: ${f.amount}</div>
								</div>
								<div style="text-align:right;">
									<div style="font-size:12px; color:#999;">昨日收益</div>
									<div style="font-weight:bold; font-size:16px; color:${pColor};">${f.profit}</div>
								</div>
							</div>`;
						});
					}

					if (data.wallet.transactions && data.wallet.transactions.length > 0) {
						html += `<div style="background:#fff; border-radius:8px; padding:10px; margin-top:20px;">
							<div style="font-weight:bold; margin-bottom:10px; color:#666; border-bottom:1px solid #eee; padding-bottom:8px;">近期账单</div>`;
						data.wallet.transactions.forEach(t => {
							const isSpend = t.amount.includes('-');
							html += `<div style="padding:10px 0; border-bottom:1px solid #f9f9f9; display:flex; justify-content:space-between; align-items:center;">
								<div>
									<div style="color:#333; font-size:14px;">${t.desc}</div>
									<div style="font-size:12px; color:#aaa; margin-top:4px;">${t.time}</div>
								</div>
								<div style="font-weight:bold; color:${isSpend ? '#333' : '#e6a23c'};">${t.amount}</div>
							</div>`;
						});
						html += '</div>';
					}
				}
			}
			else if (appId === 'gallery') {
				html = `
					<div style="display:flex; justify-content:space-between; margin-bottom:10px;">
						<button id="gal-btn-normal" style="flex:1; padding:8px; border:none; background:#07c160; color:#fff; border-radius:4px 0 0 4px; font-weight:bold;">公开相册</button>
						<button id="gal-btn-private" style="flex:1; padding:8px; border:none; background:#ddd; color:#666; border-radius:0 4px 4px 0; font-weight:bold;">私密相册</button>
					</div>
					<div id="gal-content" class="sim-gallery-grid"></div>
				`;
				container.innerHTML = html;

				const renderGal = (type) => {
					const arr = type === 'private' ? data.gallery.private : data.gallery.normal;
					let gHtml = '';
					if(arr) {
						arr.forEach(desc => { 
							gHtml += `
							<div class="sim-gallery-item virtual-toggle" onclick="this.classList.toggle('show-text')">
								<div class="icon-view">
									<i class="fas fa-image" style="font-size:30px; margin-bottom:10px;"></i>
									<span>点击查看图片</span>
								</div>
								<div class="text-view">${desc}</div>
							</div>`; 
						});
					}
					document.getElementById('gal-content').innerHTML = gHtml;
				};
				renderGal('normal');

				document.getElementById('gal-btn-normal').onclick = (e) => {
					e.target.style.background = '#07c160'; e.target.style.color = '#fff';
					document.getElementById('gal-btn-private').style.background = '#ddd'; document.getElementById('gal-btn-private').style.color = '#666';
					setReaction(currentCpData.reactions.open_gallery || "我的照片都在这里了。");
					renderGal('normal');
				};
				document.getElementById('gal-btn-private').onclick = (e) => {
					e.target.style.background = '#ff4d4f'; e.target.style.color = '#fff';
					document.getElementById('gal-btn-normal').style.background = '#ddd'; document.getElementById('gal-btn-normal').style.color = '#666';
					setReaction(currentCpData.reactions.open_gallery_private || "喂！那个相册不能看！");
					renderGal('private');
				};
				return;
			}
			else if (appId === 'settings') {
				html = `
				<div style="background:#fff; border-radius:8px; padding:15px;">
					<div style="font-weight:bold; margin-bottom:10px;">个性化设置</div>
					<div style="font-size:12px; color:#999; margin-bottom:10px;">在这里设置手机的主屏幕壁纸</div>
					<input type="text" id="cp-set-wallpaper" class="form-input" placeholder="输入壁纸图片URL" value="${data.wallpaper || ''}" style="margin-bottom:10px; width:calc(100% - 20px);">
					<button class="lock-btn" id="cp-save-wallpaper" style="width:100%;">保存壁纸</button>
				</div>
				`;
				container.innerHTML = html;
				document.getElementById('cp-save-wallpaper').onclick = () => {
					const url = document.getElementById('cp-set-wallpaper').value.trim();
					currentCpData.wallpaper = url;
					const char = characters.find(c => c.id === currentCpCharId);
					if (char) {
						char.phoneData = currentCpData;
						saveCharactersToLocal();
						document.getElementById('cp-screen-home').style.backgroundImage = url ? `url('${url}')` : `url('https://s41.ax1x.com/2026/02/07/pZoDx1H.jpg')`;
						alert('壁纸已更新！');
					}
				};
				return;
			}

			container.innerHTML = html;
		}

		// --- 8. 核心 AI 生成逻辑 (防面具重叠污染版) ---
		async function generatePhoneData(char, isRefresh = false) {
			const overlay = document.getElementById('cp-loading-overlay');
			if (!isRefresh) overlay.style.display = 'flex';

			// 【核心修复】：精确获取当前对话中的“用户身份”
			let userName = userInfo.name;
			let userMaskDesc = userInfo.mask || "无";

			if (char.userMaskId) {
				const boundMask = userMasks.find(m => m.id === char.userMaskId);
				if (boundMask) {
					if (boundMask.name) userName = boundMask.name;
					if (boundMask.mask) userMaskDesc = boundMask.mask;
				}
			} else if (char.userName && char.userName.trim()) {
				userName = char.userName.trim();
				if (char.userMask) userMaskDesc = char.userMask;
			}

			const persona = char.persona || "无";
			const ltm = (char.longTermMemories ||[]).join(';');
			const lifeEvents = (char.lifeEvents ||[]).map(e => e.event).join(';');
			const gifts = (char.giftList ||[]).map(g => g.name).join(',');
			// 【新增】提取角色自身的运势
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(char.id) : "";
			// 【新增】获取日程上下文，防止报错
			let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(char.id) : "";
			// 【修复3】加载世界书上下文
			const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);

			const systemPrompt = `${wbBefore}
			你是一个超级黑客数据生成器。现在用户要“查手机”，目标角色是 "${char.name}"。
			请根据以下角色的背景资料，虚构出该角色手机内极具生活气息的私密数据。

			【角色人设】: ${persona}
			【当前正在查手机的用户身份】: 名字是 "${userName}"，人设是 "${userMaskDesc}"
			【你当天的日程是】：${theirDayContext} 
			【当前世界观背景、人际关系和知识储备】: ${wbAfter}
			【可参考的角色运势】: ${fortuneContext}
			【和用户(${userName})的长期记忆】: ${ltm}
			【人生档案】: ${lifeEvents}
			【收到过的礼物】: ${gifts}

			【【任务】生成严格的JSON格式数据包。
			【严格JSON结构要求】
			{
				"password": "严格且只能是4位纯数字，绝不能是其他长度或包含文字(必须结合人设或生日纪念日等记忆，如 0521)",
				"reactions": {
					"lock_screen": "刚拿到手机被要求密码时的反应",
					"unlock_success": "密码猜中后的反应",
					"unlock_fail": "密码错误时的反应",
					"open_sms": "打开短信反应",
					"open_wechat": "打开x信时的总体反应",
					"open_real_wechat": "当用户点开你和ta自己的真实聊天记录时的吐槽(如：这都要看，自己吃自己的醋呀？)",
					"open_browser": "打开浏览器反应",
					"open_tiktok": "打开某音反应",
					"open_phone": "打开通话记录反应",
					"open_wallet": "打开钱包反应",
					"open_gallery": "打开公开相册反应",
					"open_gallery_private": "打开私密相册时的强烈反应(惊慌/害羞等)"
				},
				"sms":[ {"sender":"如快递/银行/物业","content":"短信内容"} ],
				"wechat_fakes":[ 
					// 【核心指令】：必须且至少生成 4 个以上的假想联系人数据！
					// ⚠️【绝密警告】：绝对严禁生成与当前用户(名字是"${userName}")的聊天卡片！系统会自动拉取你们真实的对话记录显示，你只能虚构其他人（如老板、父母、快递或其他NPC）的记录！
					{
						"name": "假想联系人名(绝不能是 ${userName})", 
						"time": "上午 10:30",
						"reaction": "当用户点开这个具体聊天时，你当场做出的解释、掩饰或狡辩（结合聊天内容和对方身份）",
						"chatHistory":[
							{"sender": "NPC", "content": "对方发的话"},
							{"sender": "自己", "content": "角色回的话(至少2-3个回合的模拟聊天)"}
						]
					} 
				],
				"browser":[
					{"query": "搜索关键词", "thoughts": "解释为什么会搜这个，或搜完的想法"}
				],
				"tiktok":[ 
					{
						"author": "博主名", 
						"desc": "视频描述", 
						"liked": true, 
						"my_comment": "角色留下的评论内容(没评就留空)",
						"thoughts": "看完这个视频的内心想法"
					} 
				],
				"calls":[ 
					{"name": "联系人", "type": "已接/未接/拨出", "time": "昨天 14:00", "desc": "通话内容概要，或未接原因"} 
				],
				"wallet": { 
					"total_balance": "总资产总额数字",
					"bank_accounts":[{"name": "xx银行卡", "balance": "余额数字"}],
					"funds":[{"name": "理财/基金名", "amount": "持有金额", "profit": "昨日收益如 +10.5"}],
					"transactions":[ {"desc":"消费描述", "time":"日期", "amount":"-50.00"} ] 
				},
				"gallery": { 
					"normal":["描述照片1画面", "描述照片2画面(多造几张)"], 
					"private":["私密照片画面描述(如：偷拍用户的照片、带点性张力的自拍等)"] 
				}
			}
			`;

			try {
				let useSettings = chatApiSettings; 
				if (socialApiSettings && socialApiSettings.baseUrl && socialApiSettings.apiKey) {
					useSettings = socialApiSettings; 
				}

				const responseText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请生成手机数据JSON包。" }
				], useSettings);

				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const data = JSON.parse(jsonMatch[0]);
					if (char.phoneData && char.phoneData.wallpaper) {
						data.wallpaper = char.phoneData.wallpaper;
					}
					char.phoneData = data;
					saveCharactersToLocal();
					
					if (currentCpCharId === char.id) {
						currentCpData = data;
						initPhoneUI(char);
						// 【新增】成功获取数据的弹窗提示 (利用 setTimeout 确保加载动画先关闭)
						setTimeout(() => {
							alert(`已成功获取 [${char.name}] 的手机记录，快去查看吧。`);
						}, 50);
					}
				} else {
					throw new Error("解析JSON失败");
				}
			} catch (e) {
				console.error("生成手机数据失败", e);
				if (currentCpCharId === char.id) {
					alert("黑入手机失败: " + e.message);
					document.querySelector('#check-phone-detail-top .top-bar-back').click();
				}
			} finally {
				if (!isRefresh && currentCpCharId === char.id) {
					overlay.style.display = 'none';
				}
			}
		}
		// ============================================================
		// 【新增】反向查手机的动效 CSS
		// ============================================================
		const rcpStyle = document.createElement('style');
		rcpStyle.innerHTML = `
			/* 阅读时的高亮框效果 (去除了覆盖的背景色，仅保留边框和发光) */
			.rcp-reading-highlight {
				border: 2px solid #3498db !important;
				box-shadow: 0 0 12px rgba(52, 152, 219, 0.6);
				border-radius: 8px;
				transform: scale(1.02);
				transition: all 0.3s ease;
				z-index: 10;
				position: relative;
			}
			/* 点击瞬间的按压闪烁效果 */
			.rcp-click-flash {
				animation: rcpClickFlash 0.3s ease-out;
			}
			@keyframes rcpClickFlash {
				0% { background-color: rgba(7, 193, 96, 0.4); transform: scale(0.95); }
				100% { background-color: transparent; transform: scale(1); }
			}
		`;
		document.head.appendChild(rcpStyle);
		// ============================================================
		// 【新增】反向查手机系统 (Reverse Check Phone)
		// ============================================================

		let rcpPresets =[];
		let currentRcpData = null; // 用户填写的解析后的数据
		let currentRcpAiReactions = null; // AI生成的反应剧本

		// --- 1. 导航与初始化 ---
		const rcpEntryBtn = document.getElementById('rcp-entry-btn');
		const rcpConfigTopBack = document.querySelector('#rcp-config-top .top-bar-back');
		const rcpDetailTopBack = document.querySelector('#rcp-detail-top .top-bar-back');
		
		if (rcpEntryBtn) {
			rcpEntryBtn.addEventListener('click', async () => {
				// =======================================================
                // 【优化 1】进入页面时，自动回显上次用户辛苦填写的记录
                // =======================================================
                if (rcpLastInputData) {
                    const safeSet = (id, key) => {
                        const el = document.getElementById(id);
                        if (el && rcpLastInputData[key] !== undefined) {
                            el.value = rcpLastInputData[key];
                        }
                    };
                    safeSet('rcp-password', 'password');
                    safeSet('rcp-wallpaper', 'wallpaper');
                    safeSet('rcp-sms', 'smsRaw');
                    safeSet('rcp-wechat', 'wechatRaw');
                    safeSet('rcp-browser', 'browserRaw');
                    safeSet('rcp-tiktok', 'tiktokRaw');
                    safeSet('rcp-calls', 'callsRaw');
                    safeSet('rcp-wallet', 'walletRaw');
                    safeSet('rcp-gallery-normal', 'galleryRaw');
                    safeSet('rcp-gallery-private', 'galleryPrivateRaw');
                }
				// 加载壁纸预设 (并兼容一下旧的存储格式)
				let p = await localforage.getItem('nnPhoneRcpWallpaperPresets');
				if (!p) {
					let oldP = await localforage.getItem('nnPhoneRcpPresets');
					if(oldP) p = oldP.map(item => ({ name: item.name, wallpaper: item.data ? item.data.wallpaper : '' }));
				}
				if (p) rcpPresets = p;
				renderRcpPresets();
				// 渲染角色选择
				const charSelect = document.getElementById('rcp-char-select');
				charSelect.innerHTML = '';
				const validChars = characters.filter(c => c.type !== 'group');
				validChars.forEach(c => {
					charSelect.add(new Option(c.name, c.id));
				});

				// 隐藏“查看”按钮，直到生成完毕
				document.getElementById('rcp-view-btn').style.display = 'none';
				document.getElementById('rcp-generate-btn').style.display = 'block';

				switchPage('rcp-config-page');
				switchTopBar('rcp-config-top');
			});
		}

		if (rcpConfigTopBack) {
			rcpConfigTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		if (rcpDetailTopBack) {
			rcpDetailTopBack.addEventListener('click', () => {
				// 停止可能正在进行的动画
				rcpStopSimulation = true; 
				switchPage('rcp-config-page');
				switchTopBar('rcp-config-top');
			});
		}

		// --- 2. 壁纸预设管理 ---
		function renderRcpPresets() {
			const sel = document.getElementById('rcp-preset-select');
			sel.innerHTML = '<option value="">-- 选择壁纸预设 --</option>';
			rcpPresets.forEach(p => {
				sel.add(new Option(p.name, p.name));
			});
		}

		document.getElementById('rcp-save-preset-btn').addEventListener('click', async () => {
			const wallpaperUrl = document.getElementById('rcp-wallpaper').value.trim();
			if (!wallpaperUrl) {
				alert("请先在下方【手机壁纸 URL】输入框中填入图片链接！");
				return;
			}
			
			const name = prompt("请输入壁纸预设名称 (例如: 动漫风、暗黑系)：");
			if (!name) return;
			
			const existingIndex = rcpPresets.findIndex(p => p.name === name);
			if (existingIndex > -1) {
				rcpPresets[existingIndex].wallpaper = wallpaperUrl;
			} else {
				rcpPresets.push({ name: name, wallpaper: wallpaperUrl });
			}
			
			await localforage.setItem('nnPhoneRcpWallpaperPresets', rcpPresets);
			renderRcpPresets();
			alert('壁纸预设保存成功！');
		});

		document.getElementById('rcp-preset-select').addEventListener('change', (e) => {
			const name = e.target.value;
			if (!name) return;
			const preset = rcpPresets.find(p => p.name === name);
			if (preset) {
				// 只覆盖壁纸输入框，不影响用户辛苦填写的其他聊天/短信数据
				if (preset.wallpaper) {
					document.getElementById('rcp-wallpaper').value = preset.wallpaper;
				} else if (preset.data && preset.data.wallpaper) { // 兼容旧数据
					document.getElementById('rcp-wallpaper').value = preset.data.wallpaper;
				}
			}
		});

		// --- 3. 收集并格式化数据 ---
		function gatherRcpInputData() {
			const data = {
				password: document.getElementById('rcp-password').value.trim() || '1234',
				wallpaper: document.getElementById('rcp-wallpaper').value.trim(),
				smsRaw: document.getElementById('rcp-sms').value.trim(),
				wechatRaw: document.getElementById('rcp-wechat').value.trim(),
				browserRaw: document.getElementById('rcp-browser').value.trim(),
				tiktokRaw: document.getElementById('rcp-tiktok').value.trim(),
				callsRaw: document.getElementById('rcp-calls').value.trim(),
				walletRaw: document.getElementById('rcp-wallet').value.trim(),
				galleryRaw: document.getElementById('rcp-gallery-normal').value.trim(),
				galleryPrivateRaw: document.getElementById('rcp-gallery-private').value.trim(),
				
				// 结构化数据
				sms:[], wechat: [], browser: [], tiktok:[], calls:[], walletEx:[], gallery: [], galleryPrivate:[],
				
				// 新增：钱包综合数据 (真实 + 预设)
				combinedWallet:[],
				realBalance: 0
			};

			// 1. 拉取真实钱包余额与账单
			if (typeof walletData !== 'undefined') {
				data.realBalance = walletData.balance || 0;
				
				if (walletData.transactions && walletData.transactions.length > 0) {
					walletData.transactions.forEach(r => {
						data.combinedWallet.push({
							name: r.desc || '消费记录',
							amount: r.amount > 0 ? `+${parseFloat(r.amount).toFixed(2)}` : `${parseFloat(r.amount).toFixed(2)}`
						});
					});
				}
			}

			const parseLines = (raw, cb) => raw.split('\n').filter(l => l.trim()).forEach(cb);

			parseLines(data.smsRaw, l => {
				const p = l.split('#').map(s=>s.trim()); data.sms.push({ sender: p[0], content: p[1] });
			});
			parseLines(data.wechatRaw, l => {
				const p = l.split('#').map(s=>s.trim()); 
				data.wechat.push({ name: p[0], messages: p.slice(1) }); 
			});
			parseLines(data.browserRaw, l => data.browser.push(l.trim()));
			parseLines(data.tiktokRaw, l => {
				const p = l.split('#').map(s=>s.trim()); data.tiktok.push({ desc: p[0], liked: p[1]?.toUpperCase()==='Y', comment: p[2] });
			});
			parseLines(data.callsRaw, l => {
				const p = l.split('#').map(s=>s.trim()); data.calls.push({ name: p[0], type: p[1], desc: p[2] });
			});
			
			// 2. 【核心修复】把用户填写的额外财产/消费加到综合数据里，并动态加减余额
			parseLines(data.walletRaw, l => {
				const p = l.split('#').map(s=>s.trim()); 
				const name = p[0] || '未知项目';
				const amountStr = p[1] || '';
				
				data.walletEx.push({ name: name, amount: amountStr });
				data.combinedWallet.push({ name: name, amount: amountStr });

				// 【彻底修复】：剔除所有空格和逗号，防止 "- 100000" 因带空格被错误识别为正数
				const cleanAmountStr = amountStr.replace(/\s+/g, '').replace(/,/g, '');
				
				// 提取包含负号和小数点的数字
				const match = cleanAmountStr.match(/-?\d+(\.\d+)?/);
				if (match) {
					const numValue = parseFloat(match[0]);
					if (!isNaN(numValue)) {
						data.realBalance += numValue; // 准确累加或扣减
					}
				}
			});
			
			parseLines(data.galleryRaw, l => data.gallery.push(l.trim()));
			parseLines(data.galleryPrivateRaw, l => data.galleryPrivate.push(l.trim()));

			return data;
		}

		// --- 4. 生成 AI 反应剧本 ---
		document.getElementById('rcp-generate-btn').addEventListener('click', async () => {
			const charId = document.getElementById('rcp-char-select').value;
			const char = characters.find(c => c.id === charId);
			if (!char) return;
			 // =======================================================
            // 【优化 1】在生成前，将当前的输入保存到本地存储
            // =======================================================
            rcpLastInputData = {
                password: document.getElementById('rcp-password').value || '',
                wallpaper: document.getElementById('rcp-wallpaper').value || '',
                smsRaw: document.getElementById('rcp-sms').value || '',
                wechatRaw: document.getElementById('rcp-wechat').value || '',
                browserRaw: document.getElementById('rcp-browser').value || '',
                tiktokRaw: document.getElementById('rcp-tiktok').value || '',
                callsRaw: document.getElementById('rcp-calls').value || '',
                walletRaw: document.getElementById('rcp-wallet').value || '',
                galleryRaw: document.getElementById('rcp-gallery-normal').value || '',
                galleryPrivateRaw: document.getElementById('rcp-gallery-private').value || ''
            };
            saveRcpLastInputToLocal();
            // =======================================================
			currentRcpData = gatherRcpInputData();
			const btn = document.getElementById('rcp-generate-btn');
			btn.disabled = true;
			btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成剧本中...';
			// ============================================================
			// 【核心修复】：精准获取当前反向查岗的用户身份（专属面具优先 > 全局）
			// ============================================================
			let userName = userInfo.name;
			let userMaskDesc = userInfo.mask || "无特定设定";

			if (char.userMaskId) {
				const boundMask = userMasks.find(m => m.id === char.userMaskId);
				if (boundMask) {
					if (boundMask.name) userName = boundMask.name;
					if (boundMask.mask) userMaskDesc = boundMask.mask;
				}
			} else if (char.userName && char.userName.trim()) {
				// 兼容旧版专属设定
				userName = char.userName.trim();
				if (char.userMask) userMaskDesc = char.userMask;
			}
			// 【补全上下文】：把共同记忆也传过去，让AI的吐槽更符合你们的剧情
			const ltm = (char.longTermMemories ||[]).join(';');
			const lifeEvents = (char.lifeEvents ||[]).map(e => e.event).join(';');
			const gifts = (char.giftList ||[]).map(g => g.name).join(',');
			 // <-- 【新增】获取短期记忆（最近15条聊天记录）
            const recentChat = (char.chatHistory || [])
                .slice(-15)
                .map(m => {
                    if (m.isHidden || m.isSystemMsg) return "";
                    const role = m.type === 'sent' ? userName : char.name;
                    return `${role}: ${m.text}`;
                })
                .filter(Boolean) // 过滤掉空字符串
                .join('\n');
			// 【修复3】加载世界书上下文
			const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);	
			// 【新增】提取角色自身的运势（影响猜忌心）
			const fortuneContext = typeof window.getFortunePromptForAi === 'function' ? window.getFortunePromptForAi(char.id) : "";
			const systemPrompt = `${wbBefore}
			你是一个角色扮演模拟器。现在你(${char.name})拿到了用户(${userName})的手机，正在查岗。
			请根据以下角色的背景资料，以及用户手机里的【虚构数据】，给出你在看到这些内容时实时的、符合你人设的【反应和内心OS】。
			
			【你的设定】：${char.persona}
			【用户("${userName}")的设定】：${userMaskDesc}
			【当前世界观背景、人际关系和知识储备】: ${wbAfter}${fortuneContext}
			【你们的关系与记忆参考】：
			- 长期记忆：${ltm || '暂无'}
			- 人生档案：${lifeEvents || '暂无'}
			- 你送出/收到过的礼物：${gifts || '无'}
			- 【近期聊天上下文】：
			  ${recentChat || '暂无聊天记录'}

			【特别扮演任务：猜锁屏密码】：
			用户的真实锁屏密码是："${currentRcpData.password}"。
			请你根据你的人设【自行决定】你是否能猜中这个密码：
			- 如果你觉得你能猜中（比如你觉得你会试对方的生日/纪念日等）：请在 \`password_guesses\` 数组中包含 "${currentRcpData.password}"（可以第1次就猜中，也可以前两次故意猜错）。
			- 如果你觉得你猜不中：请在 \`password_guesses\` 数组中只填入错误的4位数字（最多猜3个）。

			【用户手机里的数据】：
			1. 短信: ${currentRcpData.sms.map(s=>`${s.sender}: ${s.content}`).join('; ')}
			2. 微信: ${currentRcpData.wechat.map(w=>`与${w.name}聊天: ` + w.messages.join(' -> ')).join('; ')}
			3. 浏览器: ${currentRcpData.browser.join('; ')}
			4. 某音: ${currentRcpData.tiktok.map(t=>`看"${t.desc}", 点赞:${t.liked}, 评论:"${t.comment}"`).join('; ')}
			5. 通话: ${currentRcpData.calls.map(c=>`${c.name}(${c.type}): ${c.desc}`).join('; ')}
			6. 钱包: 综合总资产估值 ¥${currentRcpData.realBalance}。资产/消费明细(含外部银行卡): ${currentRcpData.combinedWallet.map(w=>`${w.name}: ${w.amount}`).join('; ')}
			7. 日常相册: ${currentRcpData.gallery.join('; ')}
			8. 私密相册: ${currentRcpData.galleryPrivate.join('; ')}

			【非常重要的警告】：
			1. 你必须且只能输出合法的 JSON 字符串，不要包含任何 Markdown 标记（如 \`\`\`json ）。
			2. JSON 中绝对不要包含任何注释（//）。
			3. 请确保内部文本的双引号被正确转义。
			4. 所有的数组长度必须与上方提供的数据条数完全一致！如果某项数据为空，则对应数组输出[]。
			
			格式要求如下（直接输出纯JSON）：
			{
				"password_guesses":["0521", "1234", "9999"],
				"lock_try": "刚拿到手机，尝试输入密码时的自言自语",
				"lock_success": "密码猜对解锁成功的得意反应",
				"lock_fail_final": "猜了3次都不对，最后只能用9999万能密码强行进入时的吐槽",
				"open_sms": "点开短信的反应",
				"open_wechat": "点开微信列表的反应",
				"wechat_items":["点开第1个微信聊天的反应", "点开第2个的反应"],
				"open_browser": "点开浏览器的总体反应",
				"browser_items":["看到第1条搜索记录的内心OS"],
				"open_tiktok": "打开某音的总体反应",
				"tiktok_items": ["看到第1个视频或评论的反应"],
				"open_calls": "看通话记录的反应",
				"calls_items":["看到第1条通话记录的反应"],
				"open_wallet": "点开钱包的总体反应",
				"wallet_items":["看到第1笔消费或资产的反应"],
				"open_gallery": "点开日常相册的总体反应",
				"gallery_items":["点开第1张日常照片的反应"],
				"open_gallery_private": "切到私密相册的反应",
				"gallery_private_items": ["点开第1张私密照片的强烈反应"],
				"final_summary": "全部查完后，对用户说的总结性的一句话"
			}
			`;


			try {
				let useSettings = chatApiSettings; 
				if (socialApiSettings && socialApiSettings.baseUrl && socialApiSettings.apiKey) {
					useSettings = socialApiSettings; 
				}
				const responseText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请输出JSON格式的反应剧本，不要任何其他文字或注释。" }
				], useSettings);

				// 过滤掉 AI 可能自带的 markdown 代码块和注释残留
				let cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
				// 去除可能由于幻觉生成的行内注释 // ...
				cleanedText = cleanedText.replace(/([^:"']|^)\/\/.*$/gm, "$1");

				const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					currentRcpAiReactions = JSON.parse(jsonMatch[0]);
					btn.style.display = 'none';
					document.getElementById('rcp-view-btn').style.display = 'block';
					alert("剧本生成成功！点击【开始模拟查岗】观看。");
				} else {
					throw new Error("未能找到JSON结构");
				}
			} catch (e) {
				console.error("生成反向查手机数据失败", e);
				alert("解析 AI 数据失败，可能是模型格式错误，请尝试重新生成。\n详细错误: " + e.message);
			} finally {
				btn.disabled = false;
				btn.innerHTML = '重新生成 AI 反应剧本';
			}
		});


		// --- 5. 自动播放剧本系统 (Auto Player) ---
		let rcpStopSimulation = false;
		
		document.getElementById('rcp-view-btn').addEventListener('click', () => {
			rcpStopSimulation = false;
			switchPage('rcp-detail-page');
			switchTopBar('rcp-detail-top');
			
			const charId = document.getElementById('rcp-char-select').value;
			const char = characters.find(c => c.id === charId);
			
			const avatarDisplay = document.getElementById('rcp-reaction-avatar');
			avatarDisplay.innerHTML = char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user"></i>`;
			document.getElementById('rcp-title').textContent = `${char.name} 正在查你的手机`;

			// 【修复2】点击开始模拟时，触发时钟与电量刷新
			startCpClock();
			setRandomBattery();

			startRcpSimulation();
		});

		const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
		
		function setRcpReaction(text) {
			if(rcpStopSimulation) return;
			const reactionEl = document.getElementById('rcp-reaction-text');
			reactionEl.innerHTML = formatTextForDisplay(text || "...");
		}

		// 【新】模拟手指按压点击的闪烁效果
		function simulateClick(elementId) {
			if(rcpStopSimulation) return;
			const el = document.getElementById(elementId);
			if (!el) return;
			el.classList.add('rcp-click-flash');
			setTimeout(() => el.classList.remove('rcp-click-flash'), 300);
			// 自动滚动到可视区域
			el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}

		// 【新】模拟正在专注阅读的蓝色高亮框
		function setHighlight(elementId, isHighlight) {
			if(rcpStopSimulation) return;
			const el = document.getElementById(elementId);
			if (!el) return;
			if (isHighlight) {
				el.classList.add('rcp-reading-highlight');
				// 保证正在看的这条位于屏幕中间
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			} else {
				el.classList.remove('rcp-reading-highlight');
			}
		}

		// 核心播放流
		async function startRcpSimulation() {
			const R = currentRcpAiReactions;
			const D = currentRcpData;
			if (!R || !D) return;

			// 【修复1】提取用户的面具头像，准备供微信聊天右侧使用
			const charId = document.getElementById('rcp-char-select').value;
			const char = characters.find(c => c.id === charId);
			let myAvatarUrl = userInfo.avatar;
			if (char && char.userMaskId) {
				const boundMask = userMasks.find(m => m.id === char.userMaskId);
				if (boundMask && boundMask.avatar) myAvatarUrl = boundMask.avatar;
			} else if (char && char.userAvatar) {
				myAvatarUrl = char.userAvatar;
			}
			
			// 右侧(自己)：用户面具头像
			const rightAvatarHtml = myAvatarUrl 
				? `<img src="${myAvatarUrl}" style="width:100%;height:100%;object-fit:cover;">` 
				: `<div style="width:100%;height:100%;background:#07c160;color:#fff;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user"></i></div>`;
			
			// 左侧(他人)：原来右侧使用的浅色占位图标
			const leftAvatarHtml = `<div style="width:100%;height:100%;background:#ccc;color:#fff;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user"></i></div>`;


			document.querySelectorAll('#rcp-detail-page .phone-screen').forEach(el => el.classList.remove('active'));
			document.getElementById('rcp-screen-lock').classList.add('active');
			document.getElementById('rcp-status-bar').style.display = 'none';
			
			let pinDisplay = document.getElementById('rcp-pin-display');
			pinDisplay.innerHTML = '<div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>';

			setRcpReaction(R.lock_try || "让我看看密码是什么...");
			
			await sleep(3500); 
			if(rcpStopSimulation) return;

			// 1. 模拟密码猜测过程 (此处省略密码部分，与原来一致)
			let unlocked = false;
			const targetPwd = D.password;
			const guesses = R.password_guesses ||["0000"];

			for (let g of guesses) {
				if(rcpStopSimulation) return;
				const pwdStr = String(g).padStart(4, '0').substring(0, 4);
				setRcpReaction(`试试 ${pwdStr} ...`);
				
				for(let i=0; i<4; i++) {
					const digit = pwdStr[i];
					simulateClick('rcp-key-' + digit); // 用闪烁代替光标
					pinDisplay.children[i].classList.add('filled');
					await sleep(400);
				}

				if (pwdStr === targetPwd) {
					unlocked = true;
					break;
				} else {
					document.getElementById('rcp-lock-error').style.display = 'block';
					pinDisplay.classList.add('shake-anim');
					await sleep(1000);
					pinDisplay.classList.remove('shake-anim');
					document.getElementById('rcp-lock-error').style.display = 'none';
					pinDisplay.innerHTML = '<div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>';
					await sleep(500);
				}
			}

			if (!unlocked) {
				setRcpReaction(R.lock_fail_final || "怎么全都不对？算了，用万能后门进去！");
				await sleep(1500);
				for(let i=1; i<=4; i++) {
					simulateClick('rcp-key-9');
					pinDisplay.children[i-1].classList.add('filled');
					await sleep(400);
				}
			} 

			// 猜对密码（或触发后门）后瞬间进入手机桌面，不需要等待
			document.getElementById('rcp-screen-lock').classList.remove('active');
			document.getElementById('rcp-screen-home').classList.add('active');
			document.getElementById('rcp-status-bar').style.display = 'flex';
			document.getElementById('rcp-screen-home').style.backgroundImage = D.wallpaper ? `url('${D.wallpaper}')` : `url('https://s41.ax1x.com/2026/02/07/pZoDx1H.jpg')`;

			if (unlocked) {
				// 进入桌面后再显示解锁成功的骄傲/得意反应
				setRcpReaction(R.lock_success || "哼，果然被我猜中了！");
			}
			
			// 删去“让我看看有哪些应用”，把合并后的停顿时间留给用户阅读“猜对密码的反应”
			await sleep(4500);
			if(rcpStopSimulation) return;
			const openRcpApp = async (appId, appName, reactionTop, htmlContent) => {
				if(rcpStopSimulation) return;
				simulateClick(`rcp-app-${appId}`); // 点击应用图标闪烁
				await sleep(400);
				document.getElementById('rcp-screen-home').classList.remove('active');
				document.getElementById('rcp-screen-app').classList.add('active');
				document.getElementById('rcp-app-title').textContent = appName;
				
				const contentEl = document.getElementById('rcp-app-content');
				contentEl.innerHTML = htmlContent;
				
				// 【精准修复】：只在某音和相册打开时，强制停在最上面，其他页面不动！
				if (appId === 'tiktok' || appId === 'gallery') {
					contentEl.scrollTop = 0;
				}
				
				setRcpReaction(reactionTop);
				await sleep(1500);
			};

			const closeRcpApp = async () => {
				if(rcpStopSimulation) return;
				simulateClick('rcp-app-back-btn'); // 点击返回按钮闪烁
				await sleep(300);
				document.getElementById('rcp-screen-app').classList.remove('active');
				document.getElementById('rcp-screen-home').classList.add('active');
				await sleep(1000);
			};

			// ==========================================
			// 开始逐个检查应用
			// ==========================================

			// 2. 短信
			if (D.sms.length > 0) {
				let smsHtml = D.sms.map(s => `<div class="sim-sms-item"><span style="font-size:12px; color:#999; margin-bottom:4px;">${s.sender}</span><span style="color:#333;">${s.content}</span></div>`).join('');
				await openRcpApp('sms', '短信', R.open_sms || "看下短信...", smsHtml);
				const smsWaitTime = Math.max(4000, D.sms.length * 1500);
				await sleep(smsWaitTime); 
				setRcpReaction("短信好像没什么特别的。");
				await sleep(1500);
				await closeRcpApp();
			}

			// 3. 微信 (修复头像对调)
			if (D.wechat.length > 0) {
				let wcHtml = D.wechat.map((w, idx) => `
					<div class="sim-wechat-item" id="rcp-wc-item-${idx}">
						<div class="avatar" style="background:#07c160;"><i class="fas fa-user"></i></div>
						<div class="info">
							<div style="font-weight:bold; color:#333;">${w.name}</div>
							<div style="color:#999; font-size:13px;">${w.messages[0] ? w.messages[0].substring(0,10) : ''}...</div>
						</div>
					</div>
				`).join('');
				await openRcpApp('wechat', 'x信', R.open_wechat || "重点查一下聊天记录", wcHtml);

				for (let i = 0; i < D.wechat.length; i++) {
					if(rcpStopSimulation) return;
					simulateClick(`rcp-wc-item-${i}`); // 点进对话框闪烁
					await sleep(500);
					
					const w = D.wechat[i];
					document.getElementById('rcp-app-title').textContent = w.name;
					
					let chatBubblesHtml = '';
					w.messages.forEach((msgText, mIdx) => {
						// 【修复1】分配头像和颜色
						const side = (mIdx % 2 === 0) ? 'left' : 'right';
						const currentAvatarHtml = (side === 'right') ? rightAvatarHtml : leftAvatarHtml;
						
						// 右侧(自己)气泡绿色，左侧(他人)白色带边框
						const bubbleClass = side === 'right' ? 'background:#95ec69; color:#333;' : 'background:#fff; color:#333; border: 1px solid #eee;';

						chatBubblesHtml += `
							<div class="sim-chat-bubble-row ${side}">
								<div class="avatar" style="background:transparent; overflow:hidden;">${currentAvatarHtml}</div>
								<div class="sim-chat-bubble" style="${bubbleClass}">${msgText}</div>
							</div>
						`;
					});

					document.getElementById('rcp-app-content').innerHTML = chatBubblesHtml;
					
					const chatReact = R.wechat_items && R.wechat_items[i] ? R.wechat_items[i] : "...";
					setRcpReaction(chatReact);
					
					const chatWaitTime = Math.max(5000, w.messages.length * 2000);
					await sleep(chatWaitTime);
					
					simulateClick('rcp-app-back-btn');
					await sleep(300);
					document.getElementById('rcp-app-title').textContent = 'x信';
					document.getElementById('rcp-app-content').innerHTML = wcHtml;
					await sleep(1000);
				}
				await closeRcpApp();
			}

			// 4. 浏览器 (引入高亮框)
			if (D.browser.length > 0) {
				let brHtml = '<div style="background:#fff; border-radius:8px; padding:10px;">';
				D.browser.forEach((b, idx) => {
					brHtml += `<div class="rcp-br-item" id="rcp-br-item-${idx}" style="padding:12px 10px; border-bottom:1px solid #f0f0f0; margin-bottom:5px;">
						<div style="color:#333; font-weight:bold;"><i class="fas fa-search" style="color:#ccc; margin-right:10px;"></i>${b}</div>
					</div>`;
				});
				brHtml += '</div>';
				
				await openRcpApp('browser', '浏览器', R.open_browser || "查查搜索记录", brHtml);
				
				for (let i = 0; i < D.browser.length; i++) {
					if(rcpStopSimulation) return;
					
					// 开启高亮
					setHighlight(`rcp-br-item-${i}`, true);
					
					const osText = R.browser_items && R.browser_items[i] ? R.browser_items[i] : "搜的什么乱七八糟的...";
					setRcpReaction(osText);
					await sleep(3500); // 增加停留
					
					// 关闭高亮
					setHighlight(`rcp-br-item-${i}`, false);
					await sleep(300);
				}
				await closeRcpApp();
			}

			// 5. 某音 (引入高亮框)
			if (D.tiktok.length > 0) {
				let tkHtml = D.tiktok.map((t, idx) => `
					<div class="sim-tiktok-item" id="rcp-tk-item-${idx}" style="margin-bottom:15px; padding:15px; background:#000; color:#fff; border-radius:8px;">
						<div style="font-weight:bold; margin-bottom:5px;">视频描述</div>
						<div style="font-size:13px; margin-bottom:10px;">${t.desc}</div>
						<div style="display:flex; gap:15px; font-size:12px; color:#ddd;">
							<span><i class="fas fa-heart" style="color:${t.liked?'#ff4d4f':'#fff'}"></i> ${t.liked?'已赞':'未赞'}</span>
						</div>
						${t.comment ? `<div style="background:rgba(255,255,255,0.1); padding:8px; border-radius:4px; margin-top:5px; font-size:12px;">我的评论: ${t.comment}</div>` : ''}
					</div>
				`).join('');
				await openRcpApp('tiktok', '某音', R.open_tiktok || "看看平时刷什么视频", tkHtml);
				
				for (let i = 0; i < D.tiktok.length; i++) {
					if(rcpStopSimulation) return;
					
					// 开启高亮
					setHighlight(`rcp-tk-item-${i}`, true);
					
					const react = R.tiktok_items && R.tiktok_items[i] ? R.tiktok_items[i] : "...";
					setRcpReaction(react);
					await sleep(4000); // 增加停留
					
					// 关闭高亮
					setHighlight(`rcp-tk-item-${i}`, false);
					await sleep(300);
				}
				await closeRcpApp();
			}

			// 6. 通话记录 (引入高亮框)
			if (D.calls.length > 0) {
				let clHtml = '<div style="background:#fff; border-radius:8px; padding:10px;">';
				D.calls.forEach((c, idx) => {
					const isMissed = c.type.includes('未接');
					const color = isMissed ? '#ff4d4f' : '#333';
					const icon = isMissed ? 'fa-phone-slash' : (c.type.includes('拨出') ? 'fa-phone-alt' : 'fa-phone-volume');
					
					clHtml += `<div class="rcp-call-item" id="rcp-call-item-${idx}" style="padding:12px 10px; border-bottom:1px solid #f0f0f0; margin-bottom:5px;">
						<div style="display:flex; justify-content:space-between; margin-bottom:6px;">
							<div style="font-weight:bold; color:${color};"><i class="fas ${icon}" style="font-size:12px; margin-right:5px;"></i>${c.name}</div>
						</div>
						<div style="font-size:12px; color:#666; background:#f9f9f9; padding:6px; border-radius:4px;">
							${isMissed ? '❌ 未接原因：' : '📞 详情：'}${c.desc}
						</div>
					</div>`;
				});
				clHtml += '</div>';

				await openRcpApp('phone', '电话', R.open_calls || "跟谁打过电话呢？", clHtml);
				
				for (let i = 0; i < D.calls.length; i++) {
					if(rcpStopSimulation) return;
					
					setHighlight(`rcp-call-item-${i}`, true);
					
					const react = R.calls_items && R.calls_items[i] ? R.calls_items[i] : "...";
					setRcpReaction(react);
					await sleep(3500); // 增加停留
					
					setHighlight(`rcp-call-item-${i}`, false);
					await sleep(300);
				}
				await closeRcpApp();
			}

			// 7. 钱包 (拉取真实余额与所有账单 + 高亮框)
			if (D.combinedWallet.length > 0 || D.realBalance !== 0) {
				let wlHtml = `<div style="background: linear-gradient(135deg, #07c160, #0abf5b); color:#fff; padding:20px; border-radius:12px; text-align:center; margin-bottom:15px;">
					<div style="font-size:14px;">总资产</div>
					<div style="font-size:36px; font-weight:bold; margin-top:5px;">¥ ${Number(D.realBalance).toFixed(2)}</div>
				</div>`;
				
				if (D.combinedWallet.length > 0) {
					wlHtml += '<div style="background:#fff; border-radius:8px; padding:10px;">';
					D.combinedWallet.forEach((w, idx) => {
						const isSpend = String(w.amount).includes('-');
						wlHtml += `<div class="rcp-wallet-item" id="rcp-wallet-item-${idx}" style="padding:12px 10px; border-bottom:1px solid #f0f0f0; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center;">
							<div style="color:#333; font-weight:bold;">${w.name}</div>
							<div style="font-weight:bold; color:${isSpend ? '#e6a23c' : '#07c160'};">${w.amount}</div>
						</div>`;
					});
					wlHtml += '</div>';
				}

				await openRcpApp('wallet', '钱包', R.open_wallet || "看看你有多少钱", wlHtml);
				
				// 逐个账单/资产反应
				for (let i = 0; i < D.combinedWallet.length; i++) {
					if(rcpStopSimulation) return;
					
					setHighlight(`rcp-wallet-item-${i}`, true);
					
					const react = R.wallet_items && R.wallet_items[i] ? R.wallet_items[i] : "...";
					setRcpReaction(react);
					await sleep(3500); // 停留3.5秒看账单反应
					
					setHighlight(`rcp-wallet-item-${i}`, false);
					await sleep(300);
				}
				await closeRcpApp();
			}

			// 8. 相册 (点击打开)
			if (D.gallery.length > 0 || D.galleryPrivate.length > 0) {
				const renderGalHtml = (items, prefixId) => {
					return items.map((g, idx) => `
						<div class="sim-gallery-item" id="${prefixId}-${idx}" style="display:flex;align-items:center;justify-content:center;background:#eee;padding:10px;text-align:center;font-size:12px;color:#666;">
							<i class="fas fa-image" style="font-size:24px;display:block;margin-bottom:5px;"></i>照片
						</div>
					`).join('');
				};

				// 提前计算好初始需要展示的照片列表，避免进入相册时显示白板
				const initialGalleryHtml = D.gallery.length > 0 ? renderGalHtml(D.gallery, 'rcp-gal-nor') : renderGalHtml(D.galleryPrivate, 'rcp-gal-pri');

				const galFramework = `
					<div style="display:flex; justify-content:space-between; margin-bottom:10px;">
						<button id="rcp-gal-btn-normal" style="flex:1; padding:8px; border:none; background:#07c160; color:#fff; border-radius:4px 0 0 4px; font-weight:bold;">公开相册</button>
						<button id="rcp-gal-btn-private" style="flex:1; padding:8px; border:none; background:#ddd; color:#666; border-radius:0 4px 4px 0; font-weight:bold;">私密相册</button>
					</div>
					<div id="rcp-gal-content" class="sim-gallery-grid">${initialGalleryHtml}</div>
				`;

				await openRcpApp('gallery', '相册', R.open_gallery || "相册里肯定有猫腻。", galFramework);
				
				if (D.gallery.length > 0) {
					await sleep(1000);

					for (let i = 0; i < D.gallery.length; i++) {
						if(rcpStopSimulation) return;
						simulateClick(`rcp-gal-nor-${i}`); // 点开照片闪烁
						await sleep(400);
						
						document.getElementById('rcp-gal-content').innerHTML = `
							<div style="grid-column: 1 / -1; width:100%;height:300px;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;font-size:16px;">[照片画面]：<br>${D.gallery[i]}
							</div>
						`;
						const react = R.gallery_items && R.gallery_items[i] ? R.gallery_items[i] : "...";
						setRcpReaction(react);
						await sleep(4000); // 延长时间
						
						document.getElementById('rcp-gal-content').innerHTML = renderGalHtml(D.gallery, 'rcp-gal-nor');
						await sleep(500);
					}
				}

				if (D.galleryPrivate.length > 0) {
					if(rcpStopSimulation) return;
					
					simulateClick('rcp-gal-btn-private'); // 点击切换按钮闪烁
					await sleep(300);
					document.getElementById('rcp-gal-btn-normal').style.background = '#ddd'; document.getElementById('rcp-gal-btn-normal').style.color = '#666';
					document.getElementById('rcp-gal-btn-private').style.background = '#ff4d4f'; document.getElementById('rcp-gal-btn-private').style.color = '#fff';
					
					setRcpReaction(R.open_gallery_private || "等等，这里怎么还有个隐藏相册？");
					document.getElementById('rcp-gal-content').innerHTML = renderGalHtml(D.galleryPrivate, 'rcp-gal-pri');
					await sleep(2000);
					
					for (let i = 0; i < D.galleryPrivate.length; i++) {
						if(rcpStopSimulation) return;
						simulateClick(`rcp-gal-pri-${i}`);
						await sleep(400);
						document.getElementById('rcp-gal-content').innerHTML = `
							<div style="grid-column: 1 / -1; width:100%;height:300px;background:#000;color:#ff4d4f;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;font-size:16px;">
								[隐藏照片]：<br>${D.galleryPrivate[i]}
							</div>
						`;
						const react = R.gallery_private_items && R.gallery_private_items[i] ? R.gallery_private_items[i] : "这...这是什么！！";
						setRcpReaction(react);
						await sleep(4500); // 延长时间
						
						document.getElementById('rcp-gal-content').innerHTML = renderGalHtml(D.galleryPrivate, 'rcp-gal-pri');
						await sleep(500);
					}
				}

				await closeRcpApp();
			}

			// 9. 查岗结束，总反应
			document.getElementById('rcp-screen-home').style.filter = 'brightness(0.5)';
			setRcpReaction(R.final_summary || "查完了。你有什么想解释的吗？");
		}
		
		// ============================================================
		// 【新增】和风天气(QWeather) 共享后台系统 (完美适配最新 Header 鉴权)
		// ============================================================
		const weatherSettingBtn = document.getElementById('weather-setting-btn');
		const weatherTopBack = document.querySelector('#weather-setting-top .top-bar-back');
		const weatherSaveBtn = document.getElementById('weather-save-btn');
		const weatherForceRefreshBtn = document.getElementById('weather-force-refresh-btn');

		// 1. 进入天气设置页面
		if (weatherSettingBtn) {
			weatherSettingBtn.addEventListener('click', () => {
				document.getElementById('weather-api-host').value = weatherSettings.apiHost || '';
				document.getElementById('weather-api-key').value = weatherSettings.apiKey || '';
				document.getElementById('weather-province').value = weatherSettings.province || '';
				document.getElementById('weather-city').value = weatherSettings.city || '';
				
				updateWeatherStatusUI();
				renderWeatherSyncChars();

				switchPage('weather-setting-page');
				switchTopBar('weather-setting-top');
			});
		}

		// 2. 退出
		if (weatherTopBack) {
			weatherTopBack.addEventListener('click', () => {
				switchPage('contact-page');
				switchTopBar('contact-top');
			});
		}

		// 3. 渲染授权共享天气的角色列表
		function renderWeatherSyncChars() {
			const container = document.getElementById('weather-sync-chars-container');
			if (!container) return;
			container.innerHTML = '';
			
			const validChars = characters.filter(c => c.type !== 'group'); // 排除群聊
			if (validChars.length === 0) {
				container.innerHTML = '<div style="text-align:center; color:#999; padding:30px;">没有私聊角色</div>';
				return;
			}

			validChars.forEach(char => {
				const isChecked = weatherSettings.syncCharIds.includes(char.id) ? 'checked' : '';
				const avatarHtml = char.avatar ? `<img src="${char.avatar}" style="width:24px; height:24px; border-radius:4px; margin-right:8px; object-fit:cover;">` : `<div style="width:24px; height:24px; border-radius:4px; margin-right:8px; background:#eee; display:flex; align-items:center; justify-content:center;"><i class="fas fa-user" style="font-size:12px;color:#999;"></i></div>`;
				
				container.innerHTML += `
					<label class="checkbox-item" style="margin-bottom: 8px;">
						<input type="checkbox" value="${char.id}" class="weather-sync-cb" ${isChecked}>
						<span class="custom-check-circle"></span>
						<div style="display:flex; align-items:center;">
							${avatarHtml}
							<span>${char.name}</span>
						</div>
					</label>
				`;
			});
		}

		// 4. 更新卡片 UI
		function updateWeatherStatusUI() {
			const display = document.getElementById('weather-status-display');
			if (!display) return;
			if (weatherSettings.cachedData) {
				display.innerHTML = `📅 更新日期: ${weatherSettings.lastFetchDate}<br><br>🌡️ 今日: ${weatherSettings.cachedData.today}<br><br>⛅ 明日: ${weatherSettings.cachedData.tomorrow}`;
			} else {
				display.innerHTML = "暂无天气数据，请填写信息并保存/刷新";
			}
		}

		// 5. 拉取天气 API 核心逻辑 (修复版：使用 Header 传递 API KEY)
		async function fetchQWeatherData(force = false) {
			if (!weatherSettings.apiHost || !weatherSettings.apiKey || !weatherSettings.city) return;

			const todayStr = new Date().toISOString().slice(0, 10);
			if (!force && weatherSettings.lastFetchDate === todayStr && weatherSettings.cachedData) {
				console.log("[Weather] 今日天气已缓存，跳过刷新。");
				return;
			}

			try {
				const key = weatherSettings.apiKey.trim();
				const city = encodeURIComponent(weatherSettings.city.trim());
				const prov = encodeURIComponent((weatherSettings.province || '').trim());
				let host = weatherSettings.apiHost.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

				// 【核心修复】：构建和风天气官方要求的请求头
				// 注意：不是 'Authorization'，而是 'X-QW-Api-Key'
				const requestHeaders = {
					"X-QW-Api-Key": key
				};

				// 步骤 A：通过 GeoAPI 获取 Location ID (使用 /geo 路径)
				const geoUrl = `https://${host}/geo/v2/city/lookup?location=${city}&adm=${prov}`;
				const geoRes = await fetch(geoUrl, {
					method: 'GET',
					headers: requestHeaders
				});
				
				if (!geoRes.ok) {
					throw new Error(`获取城市ID失败 (HTTP ${geoRes.status})，请检查你的 API Host 是否正确。`);
				}
				
				const geoData = await geoRes.json();
				
				if (geoData.code !== '200' || !geoData.location || geoData.location.length === 0) {
					throw new Error(`找不到该城市 (错误码: ${geoData.code})，请检查省市名称。`);
				}
				const locationId = geoData.location[0].id;

				// 步骤 B：获取 3 天天气预报 (使用 /v7 路径)
				const weatherUrl = `https://${host}/v7/weather/3d?location=${locationId}`;
				const weatherRes = await fetch(weatherUrl, {
					method: 'GET',
					headers: requestHeaders
				});
				
				if (!weatherRes.ok) {
					throw new Error(`WeatherAPI 响应失败 (HTTP ${weatherRes.status})`);
				}
				
				const weatherData = await weatherRes.json();

				if (weatherData.code !== '200' || !weatherData.daily || weatherData.daily.length < 2) {
					throw new Error(`天气数据获取失败 (错误码: ${weatherData.code})`);
				}

				const today = weatherData.daily[0];
				const tomorrow = weatherData.daily[1];

				weatherSettings.cachedData = {
					today: `${today.textDay}，最高温 ${today.tempMax}℃，最低温 ${today.tempMin}℃`,
					tomorrow: `${tomorrow.textDay}，最高温 ${tomorrow.tempMax}℃，最低温 ${tomorrow.tempMin}℃`
				};
				weatherSettings.lastFetchDate = todayStr;
				await saveWeatherSettingsToLocal();
				console.log("[Weather] 和风天气拉取成功！");
				
			} catch (e) {
				console.error("[Weather Error]", e);
				if (force) alert(`获取天气失败: ${e.message}`);
			}
		}

		// 6. 保存与强制刷新按钮事件
		if (weatherSaveBtn) {
			weatherSaveBtn.addEventListener('click', async () => {
				// 【修改】只负责纯粹地读取输入和保存，绝不发起网络请求
				weatherSettings.apiHost = document.getElementById('weather-api-host').value.trim();
				weatherSettings.apiKey = document.getElementById('weather-api-key').value.trim();
				weatherSettings.province = document.getElementById('weather-province').value.trim();
				weatherSettings.city = document.getElementById('weather-city').value.trim();
				
				const selectedIds =[];
				document.querySelectorAll('.weather-sync-cb:checked').forEach(cb => selectedIds.push(cb.value));
				weatherSettings.syncCharIds = selectedIds;

				// 纯保存到本地数据库
				await saveWeatherSettingsToLocal();
				
				alert('天气配置已保存！\n(若需获取最新天气，请点击“强制刷新”按钮)');
				
				// 仅刷新UI显示当前的本地缓存，不发请求
				updateWeatherStatusUI();
			});
		}

		if (weatherForceRefreshBtn) {
			weatherForceRefreshBtn.addEventListener('click', async () => {
				// 【修改】这里才是真正发起网络请求的地方
				const icon = weatherForceRefreshBtn.querySelector('i');
				icon.classList.add('fa-spin');
				weatherForceRefreshBtn.disabled = true;
				
				// 传入 true，代表无视日期缓存，强制消耗一次 API 额度去拉取最新天气
				await fetchQWeatherData(true); 
				
				updateWeatherStatusUI(); // 请求成功后更新面板 UI
				
				weatherForceRefreshBtn.disabled = false;
				icon.classList.remove('fa-spin');
			});
		}

		// 7. 生成注入 AI 的提示词（最终版：强化为世界规则）
		window.getWeatherPromptForAi = function(charId) {
			// 静默触发自动检查 (每次调用AI时都会尝试刷新，但因为有日期缓存，实际每天只会请求一次)
			fetchQWeatherData(false);

			// 如果该角色未被授权，或没有天气数据，则返回空字符串，不注入任何信息
			if (!weatherSettings.cachedData || !weatherSettings.syncCharIds.includes(charId)) {
				return "";
			}

			// 【核心修改】返回一个更严格、更具约束力的系统指令
			return `\n【世界规则：真实天气同步】\n你与用户正处于以下真实的天气环境中，这是一个不可更改的客观事实。
		- **今日天气**：${weatherSettings.cachedData.today}
		- **明日预报**：${weatherSettings.cachedData.tomorrow}

		(交互指令：
		1. **强制参考**：当你的任何行为、对话、描写或思考涉及到天气时，**必须严格参考**以上真实数据，**严禁凭空编造**任何不符的天气状况（例如，在晴天时说“外面下雨了”）。
		2. **自然融入**：请将此信息作为背景知识，仅在情节需要或符合你人设的自然时机下提及，**避免刻意或反复播报天气**。)\n`;
		};

		// 8. App 启动时自动检查一次天气 (静默)
		document.addEventListener('DOMContentLoaded', () => {
			setTimeout(() => {
				fetchQWeatherData(false);
			}, 2000);
		});
		// ============================================================
		// 【新增】主动消息后台系统设置与逻辑
		// ============================================================
		const activeMsgSettingBtn = document.getElementById('active-msg-setting-btn');
		const activeMsgTopBack = document.querySelector('#active-msg-setting-top .top-bar-back');
		const activeMsgSaveBtn = document.getElementById('active-msg-save-btn');

		if (activeMsgSettingBtn) {
			activeMsgSettingBtn.addEventListener('click', () => {
				document.getElementById('active-msg-quiet-start').value = activeMsgSettings.quietStart || '23:00';
				document.getElementById('active-msg-quiet-end').value = activeMsgSettings.quietEnd || '08:00';
				
				// 兼容旧数据：获取旧的全局默认值作为初始值兜底
				const globalOldMin = activeMsgSettings.minInterval || 60;
				const globalOldMax = activeMsgSettings.maxInterval || 120;

				// 渲染勾选列表 (带独立参数配置，已剥离内联 CSS)
				const container = document.getElementById('active-msg-chars-container');
				container.innerHTML = '';
				
				characters.forEach(char => {
					const isEnabled = activeMsgSettings.enabledCharIds.includes(char.id);
					const isChecked = isEnabled ? 'checked' : '';
					const enabledClass = isEnabled ? 'enabled' : ''; // CSS 状态类名
					
					// 读取该角色的独立配置，没有则用默认值
					const charConf = (activeMsgSettings.charConfigs && activeMsgSettings.charConfigs[char.id]) 
										? activeMsgSettings.charConfigs[char.id] 
										: { min: globalOldMin, max: globalOldMax };

					const avatarHtml = char.avatar ? `<img src="${char.avatar}" style="width:30px; height:30px; border-radius:4px; object-fit:cover;">` : `<div style="width:30px; height:30px; border-radius:4px; background:#eee; display:flex; align-items:center; justify-content:center;"><i class="fas fa-${char.type==='group'?'users':'user'}" style="font-size:14px;color:#999;"></i></div>`;
					
					container.innerHTML += `
						<div class="active-msg-char-card ${enabledClass}">
							<div class="am-card-header">
								<div class="am-card-header-left">
									${avatarHtml}
									<span>${char.name}</span>
								</div>
								<label class="switch am-card-switch">
									<input type="checkbox" class="active-msg-sync-cb" data-id="${char.id}" ${isChecked}>
									<span class="slider"></span>
								</label>
							</div>
							
							<div class="am-card-configs">
								<div class="am-config-item">
									<label class="am-config-label">最短间隔 (分钟)</label>
									<input type="number" id="am-min-${char.id}" value="${charConf.min}" class="form-input am-config-input">
								</div>
								<div class="am-config-item">
									<label class="am-config-label">最长间隔 (分钟)</label>
									<input type="number" id="am-max-${char.id}" value="${charConf.max}" class="form-input am-config-input">
								</div>
							</div>
						</div>
					`;
				});
				switchPage('active-msg-setting-page');
				switchTopBar('active-msg-setting-top');
			});
		}

		// 【优化】利用事件委托处理开关点击，通过增删 CSS 类名来控制面板展开/收起
		const activeMsgContainer = document.getElementById('active-msg-chars-container');
		if (activeMsgContainer) {
			activeMsgContainer.addEventListener('change', (e) => {
				if (e.target.classList.contains('active-msg-sync-cb')) {
					const isChecked = e.target.checked;
					const card = e.target.closest('.active-msg-char-card');
					
					if (isChecked) {
						card.classList.add('enabled');
					} else {
						card.classList.remove('enabled');
					}
				}
			});
		}
		if (activeMsgTopBack) {
			activeMsgTopBack.addEventListener('click', () => {
				switchPage('contact-page');
				switchTopBar('contact-top');
			});
		}

		if (activeMsgSaveBtn) {
			activeMsgSaveBtn.addEventListener('click', async () => {
				activeMsgSettings.quietStart = document.getElementById('active-msg-quiet-start').value;
				activeMsgSettings.quietEnd = document.getElementById('active-msg-quiet-end').value;
				
				const selectedIds = [];
				if (!activeMsgSettings.charConfigs) activeMsgSettings.charConfigs = {};

				document.querySelectorAll('.active-msg-sync-cb:checked').forEach(cb => {
					const id = cb.getAttribute('data-id');
					selectedIds.push(id);
					
					// 获取对应角色的独立时间配置
					let minVal = parseInt(document.getElementById(`am-min-${id}`).value) || 60;
					let maxVal = parseInt(document.getElementById(`am-max-${id}`).value) || 120;
					
					// 防呆设计：如果最小大于最大，自动互换
					if (minVal > maxVal) { const temp = minVal; minVal = maxVal; maxVal = temp; }
					
					activeMsgSettings.charConfigs[id] = { min: minVal, max: maxVal };
				});
				
				activeMsgSettings.enabledCharIds = selectedIds;

				// 【重置已勾选角色的下次触发倒计时】
				characters.forEach(char => {
					if (selectedIds.includes(char.id)) {
						const conf = activeMsgSettings.charConfigs[char.id];
						char.nextActiveDelay = Math.floor(Math.random() * (conf.max - conf.min + 1) + conf.min) * 60 * 1000;
					} else {
						delete char.nextActiveDelay;
					}
				});
				
				saveCharactersToLocal();
				await saveActiveMsgSettingsToLocal();
				alert('主动消息配置已保存！将在后台自动生效。');
			});
		}
		// ----------------------------------------------------
		// 主动消息后台轮询引擎 (每60秒检查一次)
		// ----------------------------------------------------
		setInterval(() => {
			if (!activeMsgSettings || !activeMsgSettings.enabledCharIds || activeMsgSettings.enabledCharIds.length === 0) return;

			const now = new Date();
			const currentStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
			
			// 1. 判断是否处于全局免打扰时间
			let inQuiet = false;
			const qStart = activeMsgSettings.quietStart || '23:00';
			const qEnd = activeMsgSettings.quietEnd || '08:00';
			if (qStart <= qEnd) {
				inQuiet = (currentStr >= qStart && currentStr < qEnd);
			} else { // 处理跨天情况
				inQuiet = (currentStr >= qStart || currentStr < qEnd);
			}
			if (inQuiet) return;

			// 2. 遍历检查是否达标
			const nowMs = Date.now();
			characters.forEach(char => {
				if (activeMsgSettings.enabledCharIds.includes(char.id)) {
					// 过滤处于拉黑/离线状态的角色
					const isOnline = (typeof char.isOnline !== 'undefined') ? char.isOnline : true;
					if (!isOnline || char.isBlockedByUser || char.isBlockedByAi) return;

					// 获取该角色的专属配置，兼容旧数据兜底
					const charConf = (activeMsgSettings.charConfigs && activeMsgSettings.charConfigs[char.id]) 
									? activeMsgSettings.charConfigs[char.id] 
									: { min: activeMsgSettings.minInterval || 60, max: activeMsgSettings.maxInterval || 120 };

					// 固化最后一条消息的时间
					let lastTime = char.createdAt;
					if (!lastTime) {
						char.createdAt = nowMs;
						lastTime = nowMs;
						saveCharactersToLocal();
					}
					if (char.chatHistory && char.chatHistory.length > 0) {
						lastTime = char.chatHistory[char.chatHistory.length - 1].timestamp;
					}

					// 防呆：如果没有生成过随机延时，马上使用独立配置生成一个
					if (!char.nextActiveDelay) {
						char.nextActiveDelay = Math.floor(Math.random() * (charConf.max - charConf.min + 1) + charConf.min) * 60 * 1000;
						saveCharactersToLocal();
					}

					// 检查是否超时
					const timePassed = nowMs - lastTime;
					if (timePassed >= char.nextActiveDelay) {
						
						// 防轰炸/平滑唤醒机制
						if (timePassed > char.nextActiveDelay + 5 * 60000) {
							console.log(`[ActiveMsg] 角色 ${char.name} 消息积压，平滑顺延至 1~5 分钟后`);
							char.nextActiveDelay = timePassed + Math.floor(Math.random() * 5 + 1) * 60000;
							saveCharactersToLocal();
							return; 
						}

						console.log(`[ActiveMsg] 触发角色 ${char.name} 主动消息`);
						
						// 1. 触发后，立即使用独立配置重置下一轮的随机延迟
						char.nextActiveDelay = Math.floor(Math.random() * (charConf.max - charConf.min + 1) + charConf.min) * 60 * 1000;
						saveCharactersToLocal();

						// 2. 触发 AI 
						handleAiGenerate(char.id);
					}
				}
			});
		}, 60000); // 60秒轮询
		// ============================================================
		// 【新增】Ta的一天 (Their Day) 功能逻辑与自动刷新
		// ============================================================
		let currentTheirDayCharId = null;

		const theirDayEntryBtn = document.getElementById('their-day-entry-btn');
		const theirDayListTopBack = document.querySelector('#their-day-list-top .top-bar-back');
		const theirDayDetailTopBack = document.querySelector('#their-day-detail-top .top-bar-back');

		if (theirDayEntryBtn) {
			theirDayEntryBtn.addEventListener('click', () => {
				renderTheirDayList();
				switchPage('their-day-list-page');
				switchTopBar('their-day-list-top');
			});
		}

		if (theirDayListTopBack) {
			theirDayListTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		if (theirDayDetailTopBack) {
			theirDayDetailTopBack.addEventListener('click', () => {
				currentTheirDayCharId = null;
				renderTheirDayList(); 
				switchPage('their-day-list-page');
				switchTopBar('their-day-list-top');
			});
		}

		document.getElementById('their-day-auto-switch')?.addEventListener('change', (e) => {
			if (!currentTheirDayCharId) return;
			const char = characters.find(c => c.id === currentTheirDayCharId);
			if (char) {
				if (!char.theirDayData) char.theirDayData = {};
				char.theirDayData.autoRefresh = e.target.checked;
				saveCharactersToLocal();
			}
		});

		document.getElementById('their-day-refresh-btn')?.addEventListener('click', () => {
			if (!currentTheirDayCharId) return;
			generateTheirDaySchedule(currentTheirDayCharId, true);
		});

		function renderTheirDayList() {
			const container = document.getElementById('their-day-list-container');
			container.innerHTML = '';

			// 过滤出开启了时间感知的私聊角色
			const validChars = characters.filter(c => c.type !== 'group' && c.timeAware);
			if (validChars.length === 0) {
				container.innerHTML = '<div style="text-align:center; padding:50px; color:#999;">暂无开启时间感知的私聊角色<br><span style="font-size:12px; margin-top:10px; display:block;">*只有开启时间感知才可以使用该功能</span></div>';
				return;
			}

			validChars.forEach(char => {
				const avatarHtml = char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user" style="font-size:24px; color:#ccc; line-height:44px; text-align:center; display:block;"></i>`;
				
				let statusText = "暂无日程，点击生成";
				if (char.theirDayData && char.theirDayData.lastFetchDate) {
					statusText = `上次更新: ${char.theirDayData.lastFetchDate}`;
				}

				container.innerHTML += `
					<div class="diary-char-card" onclick="openTheirDayDetail('${char.id}')">
						<div class="d-char-avatar">${avatarHtml}</div>
						<div class="d-char-info">
							<div class="d-char-name">${char.name}</div>
							<div class="d-char-desc">${statusText}</div>
						</div>
						<i class="fas fa-chevron-right" style="color:#ccc;"></i>
					</div>
				`;
			});

			// 在日程最下面加一句说明
			container.innerHTML += `<div style="text-align:center; padding:20px; color:#999; font-size:12px;">*只有开启时间感知才可以使用该功能</div>`;
		}

		window.openTheirDayDetail = function(charId) {
			currentTheirDayCharId = charId;
			const char = characters.find(c => c.id === charId);
			if (!char) return;

			document.getElementById('their-day-detail-title').textContent = `${char.name} 的一天`;

			const autoSwitch = document.getElementById('their-day-auto-switch');
			if (char.theirDayData && char.theirDayData.autoRefresh) {
				autoSwitch.checked = true;
			} else {
				autoSwitch.checked = false;
			}

			renderTheirDayDetail(charId);

			switchPage('their-day-detail-page');
			switchTopBar('their-day-detail-top');
			
			const contentArea = document.getElementById('main-content-area');
			if (contentArea) contentArea.style.top = '44px';
		};

		function renderTheirDayDetail(charId) {
			const char = characters.find(c => c.id === charId);
			if (!char) return;

			const emptyState = document.getElementById('their-day-empty-state');
			const contentArea = document.getElementById('their-day-content-area');
			const displayBox = document.getElementById('their-day-display-box');
			const editBox = document.getElementById('their-day-edit-box');
			const editBtn = document.getElementById('their-day-edit-btn');
			const saveBtn = document.getElementById('their-day-save-btn');

			// 如果有日程数据
			if (char.theirDayData && char.theirDayData.schedule) {
				emptyState.style.display = 'none';
				contentArea.style.display = 'block';
				
				// 赋值给展示框和编辑框
				displayBox.innerHTML = formatTextForDisplay(char.theirDayData.schedule);
				editBox.value = char.theirDayData.schedule;
				
				// 重置为【展示模式】
				displayBox.style.display = 'block';
				editBtn.style.display = 'block';
				editBox.style.display = 'none';
				saveBtn.style.display = 'none';
			} else {
				// 如果没有数据，显示空状态
				emptyState.style.display = 'block';
				contentArea.style.display = 'none';
			}
		}

		// 绑定“修改今日日程”按钮事件
		document.getElementById('their-day-edit-btn')?.addEventListener('click', () => {
			document.getElementById('their-day-display-box').style.display = 'none';
			document.getElementById('their-day-edit-btn').style.display = 'none';
			
			const editBox = document.getElementById('their-day-edit-box');
			editBox.style.display = 'block';
			document.getElementById('their-day-save-btn').style.display = 'block';
			
			// 自动适应文本框高度
			editBox.style.height = 'auto';
			editBox.style.height = (editBox.scrollHeight + 20) + 'px';
			editBox.focus();
		});

		// 绑定“保存修改”按钮事件
		document.getElementById('their-day-save-btn')?.addEventListener('click', () => {
			if (!currentTheirDayCharId) return;
			const char = characters.find(c => c.id === currentTheirDayCharId);
			if (!char) return;

			const editBox = document.getElementById('their-day-edit-box');
			const newSchedule = editBox.value.trim();
			
			if (!newSchedule) {
				alert("日程内容不能为空！");
				return;
			}

			// 1. 保存新的文本内容
			char.theirDayData.schedule = newSchedule;
			
			// 2. 【核心机制】同步最后更新时间为今天
			// 防止夜里(例如10号)修改了，但系统以为只有(9号)刷新过，再次自动覆盖
			char.theirDayData.lastFetchDate = new Date().toISOString().slice(0, 10);
			
			saveCharactersToLocal();
			alert("日程已手动保存！今日内系统不会再自动覆盖。");
			
			// 3. 刷新UI，恢复为展示状态
			renderTheirDayDetail(currentTheirDayCharId);
			renderTheirDayList(); // 刷新外层列表的“上次更新时间”
		});

		window.generateTheirDaySchedule = async function(charId, isManual = true) {
			const char = characters.find(c => c.id === charId);
			if (!char) return;

			if (isManual) {
				const refreshBtn = document.getElementById('their-day-refresh-btn');
				if (refreshBtn) {
					refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
					refreshBtn.disabled = true;
				}
			}

			try {
				// 1. 【新增】获取当前私聊绑定的用户名与面具设定
				let userName = userInfo.name;
				let userMaskDesc = userInfo.mask || "无特定设定";

				if (char.userMaskId) {
					const boundMask = userMasks.find(m => m.id === char.userMaskId);
					if (boundMask) {
						if (boundMask.name) userName = boundMask.name;
						if (boundMask.mask) userMaskDesc = boundMask.mask;
					}
				} else if (char.userName && char.userName.trim()) {
					userName = char.userName.trim();
					if (char.userMask) userMaskDesc = char.userMask;
				}

				// 2. 【新增】获取经期同步上下文信息
				let periodContext = "";
				if (typeof window.getPeriodStatusForAi === 'function' && typeof periodData !== 'undefined' && periodData.syncCharIds && periodData.syncCharIds.includes(char.id)) {
					const periodAiInstruction = window.getPeriodStatusForAi();
					if (periodAiInstruction) {
						periodContext = periodAiInstruction;
					}
				}

				// 3. 获取世界书
				const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);

				const ltm = (char.longTermMemories || []).join('; ');
				const lifeEvents = (char.lifeEvents ||[]).map(e => e.event).join('; ');
				const gifts = (char.giftList ||[]).map(g => g.name).join('、');
				
				const recentChat = (char.chatHistory ||[])
					.slice(-20)
					.map(m => {
						if (m.isHidden || m.isSystemMsg) return "";
						const role = m.type === 'sent' ? userName : char.name;
						return `${role}: ${m.text}`;
					})
					.filter(Boolean)
					.join('\n');

				const now = new Date();
				const targetDateStr = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')}`;
				const weekdays =['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
				const weekdayStr = weekdays[now.getDay()];

				const systemPrompt = `
				${wbBefore}
你现在是角色 "${char.name}"。
今天是 ${targetDateStr} ${weekdayStr}。
请根据以下信息，为你自己安排今天的日程表（Ta的一天）。

【你的设定】: ${char.persona || '无'}
【用户("${userName}")的设定】: ${userMaskDesc}
${periodContext}
【世界观设定】: ${wbAfter}
【人生档案】: ${lifeEvents}
【近期记忆】: ${ltm}
【近期聊天记录】: ${recentChat}
【收到的礼物】: ${gifts}

【任务要求】
1. 核心定位：这是一份【客观的时间规划表/行程单】，用于指导你今天几点该干什么。**绝对不是**日记、故事剧情或已发生事件的叙述。
2. 结合状态：充分参考上下文，明确你现在的状态。必须将已发生的日程计入之前的日程安排中，然后结合人设安排当日剩余时间的日程。如果你处于特殊时期（例如上述提到的经期互动约束，或者需要照顾用户），请在安排日程时体现出相应的侧重（比如留出陪伴或照顾的时间、为你订外卖/做饭等），但**仍需保持日程表的客观格式**。
3. 内容颗粒度：只需规划“这个时间段的宏观状态或任务”（如：工作会议、照顾用户、上课、吃饭、睡觉、通勤、娱乐休息）。**严禁**杜撰具体的突发事件、微观动作或不存在的对话（例如：禁止写“10:30 不小心打翻了咖啡”、“14:00 和老板吵架”）。
4. 格式要求：必须严格按照明确的时间段列出（必须包含具体到小时的时间），例如：
   08:00 - 09:00：起床、洗漱与吃早餐
   09:00 - 12:00：在公司处理文件和日常工作
   12:00 - 13:30：午休与午餐时间
   ...以此类推，填满一整天直到睡觉。
5. 必须直接输出纯文本的日程安排，不要带有任何额外解释、自我介绍、寒暄或 Markdown 代码块标记。
`;

				// 优先使用其他 API 设置，没有则用主聊天 API
				let useSettings = (otherApiSettings && otherApiSettings.apiKey && otherApiSettings.baseUrl) ? otherApiSettings : chatApiSettings;
				
				const responseText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请输出你今天的日程安排。" }
				], useSettings);

				if (responseText) {
					if (!char.theirDayData) char.theirDayData = { autoRefresh: false };
					char.theirDayData.schedule = responseText.trim();
					char.theirDayData.lastFetchDate = new Date().toISOString().slice(0, 10);
					saveCharactersToLocal();
					
					if (isManual && currentTheirDayCharId === charId) {
						renderTheirDayDetail(charId);
						alert("日程生成成功！");
					}
				}
			} catch (error) {
				console.error("生成Ta的一天失败:", error);
				if (isManual) alert("生成失败: " + error.message);
			} finally {
				if (isManual) {
					const refreshBtn = document.getElementById('their-day-refresh-btn');
					if (refreshBtn) {
						refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
						refreshBtn.disabled = false;
					}
				}
			}
		};
		window.checkAutoTheirDayRefresh = async function() {
			const todayStr = new Date().toISOString().slice(0, 10);
			for (let char of characters) {
				if (char.type !== 'group' && char.timeAware && char.theirDayData && char.theirDayData.autoRefresh) {
					if (char.theirDayData.lastFetchDate !== todayStr) {
						console.log(`[Their Day] 正在为 ${char.name} 后台自动生成今日日程...`);
						await generateTheirDaySchedule(char.id, false);
					}
				}
			}
		};

		window.getTheirDayPromptForAi = function(charId) {
			const char = characters.find(c => c.id === charId);
			if (!char || !char.timeAware || !char.theirDayData) return "";

			const todayStr = new Date().toISOString().slice(0, 10);
			
			// 【新增检查逻辑】和天气一样，每次被请求时判断是否需要刷新
			if (char.theirDayData.autoRefresh && char.theirDayData.lastFetchDate !== todayStr) {
				// 使用内存级别的防抖锁，防止在同一次对话（特别是群聊多人）中对同一个角色重复触发API
				if (!char.theirDayData.isFetching) {
					char.theirDayData.isFetching = true;
					console.log(`[Their Day] 聊天前置触发：正在为 ${char.name} 后台静默生成今日日程...`);
					
					// 异步执行，绝不阻塞当前的聊天请求
					generateTheirDaySchedule(charId, false).finally(() => {
						char.theirDayData.isFetching = false;
					});
				}
				
				// ⚠️ 关键点：既然发现数据过期（今天是新的一天），为了防止 AI 拿着昨天过期的旧日程乱说话，
				// 在今天的新日程生成好之前，本次聊天请求暂时不发送任何日程上下文。
				return "";
			}

			// 如果没写内容，返回空
			if (!char.theirDayData.schedule) return "";

			return `\n【今日日程安排 (Ta的一天)】\n以下是你今天的日程计划，请在对话和互动中参考此日程（例如你现在应该在做什么，或者稍后要做什么）：\n${char.theirDayData.schedule}\n`;
		};
		// ============================================================
		// 【新增】FPS大乱斗 游戏引擎与逻辑系统 (V4 禁血包去底栏版)
		// ============================================================

		const FPSGameSystem = {
			state: {
				isActive: false,
				isGameOver: false,
				charId: null,
				round: 0,
				c4Status: '未安放', // 未安放, 正在安装, 已安放, 已拆除, 已爆炸
				c4Timer: 30,
				teamA: [], // 友方[{id, name, hp}]
				teamB:[], // 敌方
				logs:[],  // 剧情文本
				chatHistory:[] // 聊天流
			},

			initEvents: function() {
				const entryBtn = document.getElementById('game-coop-entry-btn');
				const listTopBack = document.querySelector('#game-coop-list-top .top-bar-back');
				const gameTopBack = document.getElementById('fps-game-back-btn');
				const chatSendBtn = document.getElementById('fps-chat-send-btn');
				const chatInput = document.getElementById('fps-chat-input');

				if (entryBtn) {
					entryBtn.addEventListener('click', () => {
						this.renderCoopList();
						switchPage('game-coop-list-page');
						switchTopBar('game-coop-list-top');
					});
				}

				if (listTopBack) {
					listTopBack.addEventListener('click', () => {
						switchPage('discover-page');
						switchTopBar('discover-top');
					});
				}

				if (gameTopBack) {
					gameTopBack.addEventListener('click', () => {
						let canExit = false;

						// 【核心修改】：根据游戏状态判断弹窗内容
						if (this.state.isGameOver) {
							// 游戏已结束，直接退出，不需要警告
							canExit = true; 
						} else {
							// 游戏进行中，弹出逃跑警告
							canExit = confirm("确定要退出游戏吗？当前对局进度将被判定为逃跑。");
						}

						if (canExit) {
							this.state.isActive = false;
							switchPage('discover-page');
							switchTopBar('discover-top');
							
							const contentArea = document.getElementById('main-content-area');
							if (contentArea) {
								contentArea.style.top = '44px';
								contentArea.style.paddingBottom = ''; // 退出时恢复可能被清空的底部留白
							}
						}
					});
				}

				if (chatSendBtn) chatSendBtn.addEventListener('click', () => this.handleChatSend());
				if (chatInput) chatInput.addEventListener('keypress', (e) => {
					if (e.key === 'Enter') { e.preventDefault(); this.handleChatSend(); }
				});
			},

			renderCoopList: function() {
				const container = document.getElementById('game-coop-list-container');
				container.innerHTML = '';

				const validChars = characters.filter(c => c.type !== 'group');
				if (validChars.length === 0) {
					container.innerHTML = '<div style="text-align:center; padding:50px; color:#999;">暂无私聊角色可双排</div>';
					return;
				}

				validChars.forEach(char => {
					const avatarHtml = char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user" style="font-size:24px; color:#ccc; line-height:44px; text-align:center; display:block;"></i>`;
					container.innerHTML += `
						<div class="diary-char-card" onclick="FPSGameSystem.startGame('${char.id}')">
							<div class="d-char-avatar">${avatarHtml}</div>
							<div class="d-char-info">
								<div class="d-char-name">${char.name}</div>
								<div class="d-char-desc" style="color:#07c160;">点击进入双排大厅</div>
							</div>
							<button style="background:#07c160; color:#fff; border:none; padding:5px 15px; border-radius:15px; font-size:12px;">进入游戏</button>
						</div>
					`;
				});
			},

			buildContextBlock: function(char) {
				let userName = userInfo.name;
				let userMaskDesc = userInfo.mask || "无特别设定";
				if (char.userMaskId) {
					const boundMask = userMasks.find(m => m.id === char.userMaskId);
					if (boundMask) {
						if (boundMask.name) userName = boundMask.name;
						if (boundMask.mask) userMaskDesc = boundMask.mask;
					}
				} else if (char.userName) {
					userName = char.userName.trim();
					if (char.userMask) userMaskDesc = char.userMask;
				}

				const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);
				
				// 获取用户的全局性别（如果有）
				const userGender = userInfo.gender || '未知';

				return `${wbBefore}【玩家(你队友)的设定】
		名字: ${userName} (性别: ${userGender})
		人设面具/当前状态: ${userMaskDesc}
		
		【你(${char.name})的人设背景强制代入】
		你的日常身份: ${char.persona || '无'}
		世界观/知识储备: \n${wbAfter}
		你们的长期记忆: ${(char.longTermMemories ||[]).join(';')}
		你们的人生档案: ${(char.lifeEvents ||[]).map(e=>e.event).join(';')}
		你收到的礼物: ${(char.giftList ||[]).map(g=>g.name).join(',')}
		注意：这是在打游戏。你和你的NPC队友在语音交流时，必须绝对符合以上关于玩家的性别和身份设定！不能出现任何常识错误！`;
			},

			startGame: async function(charId) {
				const char = characters.find(c => c.id === charId);
				if (!char) return;

				let userName = userInfo.name;
				if (char.userMaskId) {
					const mask = userMasks.find(m => m.id === char.userMaskId);
					if (mask && mask.name) userName = mask.name;
				} else if (char.userName) userName = char.userName.trim();

				// 切换到游戏界面，展示 Loading
				document.getElementById('fps-game-title').textContent = `大乱斗 - 与 ${char.name} 双排`;
				switchPage('fps-game-page');
				switchTopBar('fps-game-top');
				
				// 强制去除主容器可能会干扰的底部留白
				const contentArea = document.getElementById('main-content-area');
				if (contentArea) {
					contentArea.style.top = '44px';
					contentArea.style.paddingBottom = '0px'; 
				}

				const logEl = document.getElementById('fps-game-log');
				const optContainer = document.getElementById('fps-game-options');
				logEl.innerHTML = '<div style="text-align: center; color: #07c160; margin-top: 50px;"><i class="fas fa-spinner fa-spin" style="font-size:30px; margin-bottom:10px;"></i><br>正在匹配玩家并建立对局...</div>';
				optContainer.innerHTML = '';
				document.getElementById('fps-chat-history').innerHTML = '';
				document.getElementById('fps-team-a').innerHTML = '';
				document.getElementById('fps-team-b').innerHTML = '';

				const setupPrompt = `
				你现在是角色 "${char.name}"，正在和玩家 "${userName}" 一起双排玩《FPS大乱斗》电脑游戏。
				请结合你们的设定生成：
				1. 3个随机的路人队友游戏ID（要有网游ID的风格，比如中二、搞怪、英文混搭等）。
				2. 5个随机的敌人游戏ID。
				3. 一句开场白，表示你们已经匹配成功进入游戏了，符合你的性格特点。

				严格输出JSON格式：
				{
					"teammates":["ID1", "ID2", "ID3"],
					"enemies":["ID1", "ID2", "ID3", "ID4", "ID5"],
					"opening_voice": "你的开场白"
				}`;

				try {
					const useSettings = (otherApiSettings && otherApiSettings.apiKey && otherApiSettings.baseUrl) ? otherApiSettings : chatApiSettings;
					
					const resText = await callOpenAiApi([
						{ role: "system", content: setupPrompt },
						{ role: "user", content: "请生成随机的对局ID和开场白。" }
					], useSettings);
					
					const jsonMatch = resText.match(/\{[\s\S]*\}/);
					if (!jsonMatch) throw new Error("API未返回有效的JSON结构");
					const data = JSON.parse(jsonMatch[0]);

					const tNames = data.teammates ||["队友A", "队友B", "队友C"];
					const eNames = data.enemies ||["敌人1", "敌人2", "敌人3", "敌人4", "敌人5"];
					const openingVoice = data.opening_voice || "准备好了吗？我们要上咯！";

					this.state = {
						isActive: true,
						isGameOver: false,
						charId: charId,
						round: 1,
						c4Status: '未安放',
						c4Timer: 30,
						teamA:[
							{ id: 'User', name: userName, hp: 100 },
							{ id: 'Char', name: char.name, hp: 100 },
							{ id: 'Bot_A1', name: tNames[0] || '队友A', hp: 100 },
							{ id: 'Bot_A2', name: tNames[1] || '队友B', hp: 100 },
							{ id: 'Bot_A3', name: tNames[2] || '队友C', hp: 100 }
						],
						teamB: [
							{ id: 'Enemy_1', name: eNames[0] || '敌人1', hp: 100 },
							{ id: 'Enemy_2', name: eNames[1] || '敌人2', hp: 100 },
							{ id: 'Enemy_3', name: eNames[2] || '敌人3', hp: 100 },
							{ id: 'Enemy_4', name: eNames[3] || '敌人4', hp: 100 },
							{ id: 'Enemy_5', name: eNames[4] || '敌人5', hp: 100 }
						],
						logs: ["[系统] 游戏开始！地图为完全镜像的“中”字型单点位地图。长直道有掩体掩护，爆破点在中心位置。分配标配步枪：击中身体-45HP，爆头-100HP。"],
						chatHistory:[{ sender: 'char', name: char.name, text: openingVoice }]
					};

					this.updateUI();
					this.fetchGameEngine("开局，两队从两端复活点出发。请生成本回合初始遭遇。");

				} catch(e) {
					console.error("生成对局初始化信息失败", e);
					logEl.innerHTML = '<div style="text-align: center; color: #ff4d4f; margin-top: 50px;">匹配失败，请重试或检查 API 设置。</div>';
				}
			},

			updateUI: function() {
				const hpBar = (hp, color) => `<div class="fps-hp-bar"><div class="fps-hp-fill" style="width:${hp}%; background:${color};"></div></div>`;
				
				// 渲染队伍A (从左往右：名字 -> 血条)
				const aHtml = this.state.teamA.map(p => `
					<div>
						<span class="fps-name-text" style="color:${p.id==='User'?'#fff':'#4CAF50'}">${p.name}</span> 
						${p.hp > 0 ? hpBar(p.hp, '#07c160') : '<span style="color:#666; font-size:10px; width:45px; text-align:right; margin:0 5px; flex-shrink:0;">💀阵亡</span>'}
					</div>
				`).join('');
				document.getElementById('fps-team-a').innerHTML = aHtml;

				// 渲染队伍B (得益于CSS的 row-reverse，HTML结构保持一致，显示为：血条 <- 名字)
				const bHtml = this.state.teamB.map(p => `
					<div>
						<span class="fps-name-text" style="color:#F44336">${p.name}</span> 
						${p.hp > 0 ? hpBar(p.hp, '#ff4d4f') : '<span style="color:#666; font-size:10px; width:45px; text-align:left; margin:0 5px; flex-shrink:0;">💀阵亡</span>'}
					</div>
				`).join('');
				document.getElementById('fps-team-b').innerHTML = bHtml;

				// 渲染C4
				let c4Html = `C4<br>${this.state.c4Status}`;
				if (this.state.c4Status === '已安放') {
					c4Html += `<br><span style="color:#ff3b30; font-size:16px;">${this.state.c4Timer}s</span>`;
				}
				document.getElementById('fps-c4-status').innerHTML = c4Html;

				// 渲染战斗剧情日志
				const logEl = document.getElementById('fps-game-log');
				logEl.innerHTML = this.state.logs.map(l => {
					const isCombat = l.includes('造成了') || l.includes('阵亡') || l.includes('命中') || l.includes('引爆');
					return `<div class="fps-log-item ${isCombat ? 'combat' : ''}">${l}</div>`;
				}).join('');
				logEl.scrollTop = logEl.scrollHeight;

				// 渲染聊天 (增加对 sys 系统提示消息的支持，以及区分队友颜色)
				const chatEl = document.getElementById('fps-chat-history');
				chatEl.innerHTML = this.state.chatHistory.map(c => {
					if (c.sender === 'sys') {
						return `<div style="margin-bottom: 6px; color:#888; font-size: 12px; font-style: italic;">${c.text}</div>`;
					}
					// 用户(绿)，主角色(橙)，队友NPC(蓝)
					let nameColor = '#fa9d3b'; 
					if (c.sender === 'user') nameColor = '#07c160'; 
					else if (c.sender === 'teammate') nameColor = '#00a8ff'; 
					
					return `
						<div style="margin-bottom: 6px;">
							<span style="color:${nameColor}; font-weight:bold;">[${c.name}]语音：</span>${c.text}
						</div>
					`;
				}).join('');
				chatEl.scrollTop = chatEl.scrollHeight;
			},

			// 核心：请求游戏回合推进
			fetchGameEngine: async function(userActionStr) {
				const char = characters.find(c => c.id === this.state.charId);
				if (!char) return;

				const optContainer = document.getElementById('fps-game-options');
				optContainer.innerHTML = '<div style="color:#888; text-align:center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> 战况演算中...</div>';

				// 构造后台ID与数值的严格状态报告 (隐藏英文ID，防止AI在战报中输出)
				const formatTeam = (team) => team.map(p => `${p.name}(HP:${p.hp})`).join('; ');
				const aStatus = formatTeam(this.state.teamA);
				const bStatus = formatTeam(this.state.teamB);
				const recentChat = this.state.chatHistory.filter(c => c.sender !== 'sys').slice(-5).map(c => `${c.name}: ${c.text}`).join('\n');
				let userName = userInfo.name;
					if (char.userMaskId) {
						const mask = userMasks.find(m => m.id === char.userMaskId);
						if (mask && mask.name) userName = mask.name;
					} else if (char.userName) userName = char.userName.trim();

				// 【核心修改：彻底割裂战报视角与选项视角，增加红线警告】
		const systemPrompt = `
		你是《FPS大乱斗》虚拟电竞文本游戏引擎。
		【游戏规则】：两队(A队友方 vs B队敌方)夺取中点。每人带有步枪(击中身体-45HP，爆头-100HP)。
		胜利条件：击杀全敌，或在中点安放C4并倒数30秒引爆。

		【虚拟电竞场景强制要求】
		1. 明确这是在打电脑/手机电子竞技游戏，绝对严禁出现任何真实的伤痛、流血、断肢、惨叫等血腥暴力描写。
		2. 请使用电子竞技术语描述战况（如：掉血、大残、丝血、秒杀、空枪、马枪、拉枪线、爆头击杀、回到泉水、屏幕变灰等）。
		3. ⚠️【绝对禁止回血】：本游戏内没有任何医疗包、急救包、回血技能或复活机制，生命值一旦扣除不可恢复！严禁在剧情描述或生成的选项中出现“打药”、“加血”、“寻找医疗包”等内容！
		4. 游戏画面的播报放在 narrative 中，角色的沟通交流必须专门放在 \`char_voice\` 字段！
		
		${this.buildContextBlock(char)}

		【当前后台数值状态 (绝对真理)】
		当前第 ${this.state.round} 回合。
		A队生存与血量：${aStatus}
		B队生存与血量：${bStatus}
		C4状态：${this.state.c4Status}，剩余倒计时：${this.state.c4Timer}秒。

		【队伍通讯语音频道】(用户刚才跟你的对话)：
		${recentChat || '无'}

		【用户刚才执行的操作】
		${userActionStr}
【任务要求（严格区分人称视角！）】
		1. 结算上一轮的战况。根据用户的操作，模拟敌我的交火、走位或下包。
		2. 伤害结算(combat_events) -> 【🚨强制输出红线】：
		   - **只要本回合有任何人开枪对射，你必须在 \`combat_events\` 数组中生成伤害数据！**
		   - 严禁只在 narrative 中描写击中，却不在 \`combat_events\` 中扣血！
		   - 只能对 HP > 0 的单位造成伤害！必须写明谁用什么部位击中了谁的后台ID，伤害值必须是 45(身体) 或 100(爆头)。(attacker_id/target_id 填原英文ID：User, Char, Bot_A1~A3, Enemy_1~5)。
		3. ️⚠️C4规则：如果处于“已安放”状态，本回合 c4_timer_tick 必须返回 10。如果减至0即为引爆。
		4. 战报描述(narrative)：
		   - ⚠️【必须使用第三人称系统全局观战视角】！你必须在 narrative 中客观、详尽地描述本回合**场上每一位存活玩家和NPC的当前动作、走位和交火情况**，不能只描写局部。
		   - ⚠️【人称红线警告】：必须使用上帝/解说员的全局第三人称视角！在战报中【绝对禁止】使用“你”字来称呼玩家！只要提到玩家，必须直呼其名 "${userName}"！（例如：不能写“你躲在掩体后”，必须写“${userName} 躲在掩体后”）。
		   - ⚠️【排版红线警告】：战报中【严禁】输出任何英文代码如 "Bot_A1", "Enemy_2" 等，必须使用其对应的中文名字！必须将不同角色的行为分段描述，每个主要视角的行动各占一段，必须使用 \n 另起一行，严禁揉成一整段！
		5. 队伍语音(team_voices)：模拟你(${char.name})以及其他存活队友在游戏麦克风里的交流，必须以数组形式专门放在 \`team_voices\` 字段里返回！
		6. 选项生成(options) -> 【玩家(${userName})操作视角】(⚠️极其重要)：
		   - 给出3-4个下一步策略选项（进攻、防守、撤退、架枪等）。
		   - ⚠️选项是生成给**玩家(${userName})**选择的下一步行动指令！**绝对不是**你(${char.name})的决策！
		   - 必须强制以“你”字开头（这里的“你”代表正在玩游戏的玩家 ${userName}）。
		   - ⚠️绝对禁止生成任何与“回血”相关的选项！在${userName}阵亡后生成的所有决策必须是观战状态，禁止直接参与游戏。
		   - 例如："你向A区封烟"、"你拉出去对枪"、"你掩护 ${char.name} 撤退"。提供 3-4 个战术选项。   		
		7. 必须仅输出 JSON 格式。


		【JSON格式模板】
		{
		  "narrative": "A队队友A前往了A包点架枪...\nB队敌人2在长直道封烟...\n玩家 ${userName} 正在静步摸排...\n(注：必须用换行符分隔，绝对不能出现'你'字)",
		  "team_voices": [
			{"name": "${char.name}", "text": "我大残了，帮我架一下！"},
			{"name": "队友A的名字", "text": "马上来！"}
		  ],
		  "combat_events":[
			{"attacker_id": "User", "target_id": "Enemy_2", "hit": "body", "damage": 45}
		  ],
		  "c4_action": "none", 
		  "c4_timer_tick": 10,
		  "options":[
			"选项1：你...", "选项2：你..."
		  ]
		}
		`;

				try {
					const useSettings = (otherApiSettings && otherApiSettings.apiKey && otherApiSettings.baseUrl) ? otherApiSettings : chatApiSettings;
					const resText = await callOpenAiApi([
						{ role: "system", content: systemPrompt },
						{ role: "user", content: "请根据用户操作结算并生成下一回合JSON。" }
					], useSettings);

					const jsonMatch = resText.match(/\{[\s\S]*\}/);
					if (!jsonMatch) throw new Error("API未返回有效的JSON结构");
					
					const data = JSON.parse(jsonMatch[0]);
					this.processRoundData(data);
					
				} catch (e) {
					console.error("游戏引擎请求失败", e);
					optContainer.innerHTML = `<div style="color:#ff4d4f; text-align:center;">演算出错</div><button class="fps-btn" onclick="FPSGameSystem.fetchGameEngine('${userActionStr.replace(/'/g, "\\'")}')">重新演算本回合</button>`;
				}
			},

			processRoundData: function(data) {
				this.state.round++;
				let combatLogs = "";

				// 1. 处理伤害计算
				if (data.combat_events && Array.isArray(data.combat_events)) {
					data.combat_events.forEach(ev => {
						const target =[...this.state.teamA, ...this.state.teamB].find(p => p.id === ev.target_id);
						const attacker =[...this.state.teamA, ...this.state.teamB].find(p => p.id === ev.attacker_id);
						
						if (target && target.hp > 0 && attacker && attacker.hp > 0) {
							target.hp -= ev.damage;
							const hitPart = ev.hit === 'head' ? '头部' : '身体';
							combatLogs += `🎯 [${attacker.name}] 命中了[${target.name}]的${hitPart} (-${ev.damage}HP)！`;
							if (target.hp <= 0) {
								target.hp = 0;
								// 【修改点：改变死亡后的播报文案】
								combatLogs += ` 💀[${target.name}] 阵亡，转入观战视角！`;
							}
							combatLogs += "<br>";
						}
					});
				}

				// 2. 处理 C4
				if (data.c4_action === 'planted' && this.state.c4Status === '未安放') {
					this.state.c4Status = '已安放';
					combatLogs += "⚠️ 炸弹已被安装，开始倒计时！<br>";
				} else if (data.c4_action === 'defused' && this.state.c4Status === '已安放') {
					this.state.c4Status = '已拆除';
					combatLogs += "🛡️ 炸弹已被成功拆除！<br>";
				}

				if (this.state.c4Status === '已安放') {
					this.state.c4Timer -= (data.c4_timer_tick || 10);
					if (this.state.c4Timer <= 0) {
						this.state.c4Timer = 0;
						this.state.c4Status = '已爆炸';
						combatLogs += "🔥 C4已爆炸！<br>";
					}
				}

				// 3. 记录对局日志
				// 【核心修改】：将 AI 传回来的换行符 \n 转换为 HTML 能识别的换行标签 <br>，并增加段落间距
				let formattedNarrative = "";
				if (data.narrative) {
					// 替换换行符，并给每段加上下边距，看起来更清爽
					formattedNarrative = data.narrative
						.split('\n')
						.filter(line => line.trim() !== '') // 过滤掉空行
						.map(line => `<div style="margin-bottom: 6px; line-height: 1.5;">${line}</div>`)
						.join('');
				}

				let fullNarrative = `<div style="font-weight:bold; color:#07c160; margin-bottom:8px;">[回合 ${this.state.round}]</div>${formattedNarrative}`;
				
				if (combatLogs) {
					fullNarrative += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.2);">${combatLogs}</div>`;
				}
				this.state.logs.push(fullNarrative);

				// 把队伍的交流独立放进聊天区域
				const char = characters.find(c => c.id === this.state.charId);
				if (data.team_voices && Array.isArray(data.team_voices)) {
					data.team_voices.forEach(v => {
						if (v.name && v.text) {
							// 判断发言者是主角色还是队友NPC
							const isMainChar = (v.name === char.name);
							this.state.chatHistory.push({
								sender: isMainChar ? 'char' : 'teammate',
								name: v.name,
								text: v.text
							});
						}
					});
				} else if (data.char_voice && typeof data.char_voice === 'string' && data.char_voice.trim() !== "") {
					// 兼容性兜底：如果AI智障输出成了旧格式
					this.state.chatHistory.push({ sender: 'char', name: char.name, text: data.char_voice });
				}

				// 4. 判断胜负
				const teamAAlive = this.state.teamA.some(p => p.hp > 0);
				const teamBAlive = this.state.teamB.some(p => p.hp > 0);
				
				let isGameOver = false;
				let endMsg = "";

				if (!teamAAlive) { isGameOver = true; endMsg = "我方全员阵亡，游戏失败！"; }
				else if (!teamBAlive) { isGameOver = true; endMsg = "敌方全员阵亡，游戏胜利！"; }
				else if (this.state.c4Status === '已爆炸') { isGameOver = true; endMsg = "C4 爆炸，游戏结束！"; }
				else if (this.state.c4Status === '已拆除') { isGameOver = true; endMsg = "C4 拆除，拆除方胜利！"; }

				const optContainer = document.getElementById('fps-game-options');
				if (isGameOver) {
					this.state.isGameOver = true; 
					this.state.logs.push(`🏆 游戏结束：${endMsg}`);
					optContainer.innerHTML = `<button class="fps-btn" style="background:#07c160; text-align:center; font-weight:bold;" onclick="document.getElementById('fps-game-back-btn').click()">退出并结算</button>`;
				} else {
					// 【核心修改点：前端强制拦截与接管阵亡选项】
					const userPlayer = this.state.teamA.find(p => p.id === 'User');
					
					if (userPlayer && userPlayer.hp <= 0) {
						// 用户已阵亡，无视 AI 的 options，前端强制生成存活队友的观战列表
						const aliveTeammates = this.state.teamA.filter(p => p.id !== 'User' && p.hp > 0);
						
						if (aliveTeammates.length > 0) {
							// 按存活人数生成观战按钮
							optContainer.innerHTML = aliveTeammates.map(tm => 
								`<button class="fps-btn" onclick="FPSGameSystem.fetchGameEngine('（你已阵亡）你切换了观战视角，当前正在观战队友：${tm.name}')">🎥 观战队友：${tm.name}</button>`
							).join('');
						} else {
							// 兜底（理论上进不到这里，因为全灭会触发 isGameOver）
							optContainer.innerHTML = `<button class="fps-btn" onclick="FPSGameSystem.fetchGameEngine('（全员阵亡）等待结算')">等待结算</button>`;
						}
					} else {
						// 用户存活，正常使用 AI 传回来的战术 options
						if (data.options && Array.isArray(data.options)) {
							optContainer.innerHTML = data.options.map(opt => 
								`<button class="fps-btn" onclick="FPSGameSystem.fetchGameEngine('${opt.replace(/'/g, "\\'")}')">${opt}</button>`
							).join('');
						} else {
							optContainer.innerHTML = `<button class="fps-btn" onclick="FPSGameSystem.fetchGameEngine('继续交火')">继续交火</button>`;
						}
					}
				}

				this.updateUI();
			},

			handleChatSend: async function() {
				const input = document.getElementById('fps-chat-input');
				const text = input.value.trim();
				if (!text) return;

				input.value = '';
				const char = characters.find(c => c.id === this.state.charId);
				if (!char) return;

				// 1. 用户发言入场
				this.state.chatHistory.push({ sender: 'user', name: this.state.teamA[0].name, text: text });
				
				// 2. 推入一条临时占位消息
				this.state.chatHistory.push({ sender: 'sys', name: '系统', text: '<i class="fas fa-spinner fa-spin"></i> 队伍语音通讯中...' });
				this.updateUI();

				// 3. 准备数据
				const aStatus = this.state.teamA.map(p => `${p.name}:${p.hp}HP`).join(', ');
				const bStatus = this.state.teamB.map(p => `${p.name}:${p.hp}HP`).join(', ');
				const latestPlot = this.state.logs.slice(-1).join('\n');

				// 【重点：把名字压入对话历史，让AI知道是谁在说话】
				const formattedChatHistory = this.state.chatHistory
					.filter(c => c.sender !== 'sys')
					.map(c => ({ 
						role: c.sender === 'user' ? 'user' : 'assistant', 
						content: `[${c.name}]: ${c.text}` 
					}));

				const systemPrompt = `
		${this.buildContextBlock(char)}

		当前你正和我在打《FPS大乱斗》。
		【当前战况】
		我方：${aStatus}
		敌方：${bStatus}
		最新战局：${latestPlot}

		【指令】
		用户刚刚在小队麦克风里说话了，请你结合目前战局紧张的氛围，模拟你（${char.name}）以及其他存活队友的语音回复。
		1. 必须符合各个角色的生存状态（如果某队友已阵亡，则不能说话，或只能以“观战报点”的口吻说话）。
		2. **记忆代入**：如果玩家的话题涉及了长线记忆或人设身份，你和队友的反应必须符合这些设定（如性别、关系等）。
		3. 纯输出对白，严禁动作描写。
		4. 必须严格输出 JSON 格式。

		【JSON格式模板】
		{
		    "voices": [
		        {"name": "${char.name}", "text": "你的回复内容..."},
		        {"name": "存活队友的名字", "text": "附和或交流..."}
		    ]
		}
		`;
				
				const messages = [
					{ role: "system", content: systemPrompt },
					...formattedChatHistory
				];

				try {
					const useSettings = (otherApiSettings && otherApiSettings.apiKey && otherApiSettings.baseUrl) ? otherApiSettings : chatApiSettings;
					const resText = await callOpenAiApi(messages, useSettings);
					
					const jsonMatch = resText.match(/\{[\s\S]*\}/);
					if (!jsonMatch) throw new Error("API未返回有效的JSON结构");
					
					const data = JSON.parse(jsonMatch[0]);

					// 请求成功，删除占位消息
					this.state.chatHistory = this.state.chatHistory.filter(c => c.sender !== 'sys');

					// 推入真正的AI队伍多重回复
					if (data.voices && Array.isArray(data.voices)) {
						data.voices.forEach(v => {
							if (v.name && v.text) {
								const isMainChar = (v.name === char.name);
								this.state.chatHistory.push({
									sender: isMainChar ? 'char' : 'teammate',
									name: v.name,
									text: v.text
								});
							}
						});
					} else {
						// 容错机制
						this.state.chatHistory.push({ sender: 'char', name: char.name, text: "（语音信号不好，收到一串杂音）" });
					}
					this.updateUI();
				} catch(e) {
					console.error("游戏语音交互失败", e);
					this.state.chatHistory = this.state.chatHistory.filter(c => c.sender !== 'sys');
					this.state.chatHistory.push({ sender: 'char', name: char.name, text: "（网络波动，语音掉线了...）" });
					this.updateUI();
				}
			}
		}; 
		// 初始化事件绑定
		document.addEventListener('DOMContentLoaded', () => {
			FPSGameSystem.initEvents();
		});
		// ============================================================
		// 【新增】心动遇见（婚介AI生成伴侣）系统
		// ============================================================

		const meetEntryBtn = document.getElementById('meet-entry-btn');
		const meetFormTopBack = document.querySelector('#meet-form-top .top-bar-back');
		const meetResultTopBack = document.querySelector('#meet-result-top .top-bar-back');
		
		const meetGenerateBtn = document.getElementById('meet-generate-btn');
		const meetRegenerateBtn = document.getElementById('meet-regenerate-btn');
		const meetAcceptBtn = document.getElementById('meet-accept-btn');

		let currentMeetCharData = null; // 暂存生成的角色数据

		// 1. 导航逻辑
		if (meetEntryBtn) {
			meetEntryBtn.addEventListener('click', () => {
				document.getElementById('meet-personality').value = '';
				document.getElementById('meet-job').value = '';
				document.getElementById('meet-detail').value = '';
				
				switchPage('meet-form-page');
				switchTopBar('meet-form-top');
			});
		}

		if (meetFormTopBack) {
			meetFormTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		if (meetResultTopBack) {
			meetResultTopBack.addEventListener('click', () => {
				// 返回表单页
				switchPage('meet-form-page');
				switchTopBar('meet-form-top');
			});
		}

		// 2. 核心：发起生成请求
		async function generateMeetCharacter() {
			const gender = document.getElementById('meet-gender').value;
			const personality = document.getElementById('meet-personality').value.trim() || '随机';
			const job = document.getElementById('meet-job').value.trim() || '随机';
			const detail = document.getElementById('meet-detail').value.trim() || '无特殊要求，自由发挥';

			// 获取 API 设定（优先用 otherApi，没有则 fallback 到主聊天 API）
			const useSettings = (otherApiSettings && otherApiSettings.apiKey && otherApiSettings.baseUrl) ? otherApiSettings : chatApiSettings;

			if (!useSettings || !useSettings.apiKey) {
				alert("请先在 API 设置中配置可用的 API Key！");
				return;
			}

			// UI 状态锁定
			const originalBtnText = meetGenerateBtn.innerHTML;
			meetGenerateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 红娘正在全网搜寻中...';
			meetGenerateBtn.disabled = true;
			meetRegenerateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 重新搜寻中...';
			meetRegenerateBtn.disabled = true;

			// 【系统提示词】：注入人设卡YAML格式规范
			const systemPrompt = `
你是一个名为“NN红娘”的AI智能婚介匹配引擎。
用户提交了Ta期望遇到的另一半的描述。请你根据描述，为Ta量身定制一个虚拟伴侣角色。

【角色人设卡 YAML 格式规范（必须严格参照此结构生成）】
chat_language: (如：普通话)
name: (名字)
gender: (性别)
birthday: (YYYY/MM/DD)
blood_type: (血型)
identity: (年龄/职业等身份标签)
core_concept: (1-3个核心关键词)
appearance:
  height: (身高)
  weight: (体重)
  bust_waist_hips: (三围，无则填无)
  facial_features: (五官特征)
  hairstyle: (发型发色)
  body: (身形)
  temperament: (整体气质)
personality:
  inner_color: (代表内心的色彩)
  coquettish_trait: (撒娇特质表现)
  life_experience: (人生经历)
  personality_underlying_logic: (性格的底层逻辑)
language_style:
  general: (日常说话风格)
  examples: (例句)
  coquettish_style: (撒娇风格)
  to_user: (对用户的专属语言风格)
habits:
  daily: (生活习惯)
  hobbies: (兴趣爱好)
  coquettish_habits: (专属习惯)
  minor_quirks: (小癖好)
love_performance:
  basic_state: (恋爱态度)
  possessiveness: (占有欲表现)
  behavior: (恋爱行为表现)
  special_performance: (纪念日/吵架/吃醋等特殊场景表现)
  physical_contact: (对肢体接触的偏好)
  coquettish_love: (恋爱中专有的撒娇行为)
communication_rules:
  - 禁止说教式聊天，不将自身想法、判断、价值观强行灌输给交流对象
  - 禁止持续输出负面情绪
  - 禁止刻板印象，不对任何人或身份做偏见化判断
  - 禁止贬低、物化交流对象，绝不侮辱讽刺对方人格
social_relationship:
  friend1:
    name: (好友名)
    gender: (好友性别)
    age: (年龄)
    personality: (性格概括)
    appearance: (外貌概括)
    relationship: (相处模式)

【用户的期望描述】
性别倾向：${gender}
性格偏好：${personality}
职业身份：${job}
背景/特殊要求：${detail}

【输出要求】
必须仅输出一个合法的 JSON 格式包（绝对严禁包含 Markdown 的 \`\`\`json 代码块，严禁有任何额外文字或注释）。
结构如下：
{
  "name": "生成的角色名字",
  "gender": "生成的角色性别",
  "brief": "以红娘的口吻，向用户热情介绍这个角色的基本情况（年龄、职业、外貌、性格优势等），约150字左右。注意语气要亲切、像媒人。",
  "persona": "将上方要求的YAML内容填入此处。请使用 '\\n' 换行符以保持格式清晰。必须内容深度剖析性格底层逻辑和设定。",
  "greeting": "该角色加上用户微信后，发给用户的第一句话（符合角色的人设，可以带点剧情代入感）"
}
`;

			try {
				const responseText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请开始匹配并输出要求的JSON。" }
				], useSettings);

				// 正则过滤提取 JSON
				let cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
				const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
				
				if (!jsonMatch) {
					throw new Error("API返回数据异常，未找到有效的 JSON 结构。");
				}

				const data = JSON.parse(jsonMatch[0]);
				currentMeetCharData = data;

				// 渲染结果页
				document.getElementById('meet-result-name').textContent = data.name || "神秘角色";
				// 处理红娘的文字，允许换行
				document.getElementById('meet-result-brief').innerHTML = (data.brief || "我为您找到了一位很棒的伴侣！").replace(/\n/g, '<br>');

				// 切换页面
				switchPage('meet-result-page');
				switchTopBar('meet-result-top');

			} catch (e) {
				console.error("匹配角色失败:", e);
				alert("匹配失败，可能是模型输出格式不对或网络问题，请重试。\n报错信息：" + e.message);
			} finally {
				// 恢复按钮状态
				meetGenerateBtn.innerHTML = originalBtnText;
				meetGenerateBtn.disabled = false;
				meetRegenerateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 不太满意，重新匹配';
				meetRegenerateBtn.disabled = false;
			}
		}

		// 绑定生成与重试按钮
		if (meetGenerateBtn) meetGenerateBtn.addEventListener('click', generateMeetCharacter);
		if (meetRegenerateBtn) meetRegenerateBtn.addEventListener('click', generateMeetCharacter);

		// 3. 接受角色：一键导入并开启对话
		if (meetAcceptBtn) {
			meetAcceptBtn.addEventListener('click', () => {
				if (!currentMeetCharData) return;

				const charData = currentMeetCharData;
				const newCharId = 'char_' + Date.now().toString() + Math.random().toString(36).substr(2, 5);

				// 构造新角色对象 (使用系统默认值，全字段补齐确保数据一致性)
				const newCharacter = {
					id: newCharId, 
					name: charData.name || '神秘人',
					group: '心动匹配', // 自动分配一个专属分组
					avatar: '', // 留空，使用默认图标
					persona: charData.persona || '无详细设定',
					worldBookIds: [], 
					voice: { provider: 'minimax', id: '' },
					timeAware: true, // 默认开启时间感知
					offlinePov: 'first',
					userMaskId: '', // 全局用户
					emoticonCategories: [], 
					isPinned: false,
					isOnline: true,
					createdAt: Date.now(),
					lifeEvents: [],
					chatHistory: [],
					// --- 补充下面这些扩展字段，和手动建群/建人的数据结构100%对齐 ---
					userAvatar: '',
					userName: '',
					backgroundImage: '',
					apiSettings: {
						baseUrl: '',
						apiKey: '',
						model: '',
						temperature: ''
					}
				};

				// 如果 AI 生成了打招呼，插入作为第一条历史记录
				if (charData.greeting) {
					newCharacter.chatHistory.push({
						text: charData.greeting,
						type: 'received',
						timestamp: Date.now(),
						isRead: false, // 标记为未读，列表会显红点
						isWithdrawn: false
					});
				}

				// 将角色保存入库并固化到本地存储
				characters.unshift(newCharacter);
				saveCharactersToLocal();

				// 更新界面
				renderChatList();
				
				alert(`已成功添加联系人：${newCharacter.name}！\n现在可以去【对话】列表里和Ta聊天啦！`);
				
				// 跳转到聊天界面
				switchPage('chat-page');
				switchTopBar('chat-top');
				
				// 直接打开聊天框体验更好：
				setTimeout(() => {
					enterChat(newCharId);
				}, 300);

				// 清空暂存
				currentMeetCharData = null;
			});
		}
		// ============================================================
        // 【新增】识图、朋友圈、其他 API 页面的预设管理和应用逻辑
        // ============================================================
        
        // 绑定"管理"按钮打开共用的预设管理模态框
        const manageVisionPresetsBtn = document.getElementById('manage-vision-presets-btn');
        if (manageVisionPresetsBtn) manageVisionPresetsBtn.addEventListener('click', () => { populateManageModal(); managePresetsModal.classList.add('show'); });

        const manageSocialPresetsBtn = document.getElementById('manage-social-presets-btn');
        if (manageSocialPresetsBtn) manageSocialPresetsBtn.addEventListener('click', () => { populateManageModal(); managePresetsModal.classList.add('show'); });

        const manageOtherPresetsBtn = document.getElementById('manage-other-presets-btn');
        if (manageOtherPresetsBtn) manageOtherPresetsBtn.addEventListener('click', () => { populateManageModal(); managePresetsModal.classList.add('show'); });

        // 识图 API 选择预设
        const visionPresetSelectMenu = document.getElementById('vision-preset-select-menu');
        if (visionPresetSelectMenu) {
            visionPresetSelectMenu.addEventListener('change', (e) => {
                const presetName = e.target.value;
                if (!presetName) return;
                const preset = apiPresets.find(p => p.name === presetName);
                if (preset) {
                    if (confirm(`确定要应用预设 "${presetName}" 到识图 API 设置吗？`)) {
                        document.getElementById('vision-api-url-input').value = preset.baseUrl;
                        document.getElementById('vision-api-key-input').value = preset.apiKey;
                        const modelSel = document.getElementById('vision-model-select');
                        if (preset.model) modelSel.innerHTML = `<option value="${preset.model}" selected>${preset.model}</option>`;
                        else modelSel.innerHTML = `<option value="">请先拉取或手动输入</option>`;
                    } else {
                        e.target.value = "";
                    }
                }
            });
        }

        // 其他 API 选择预设
        const otherPresetSelectMenu = document.getElementById('other-preset-select-menu');
        if (otherPresetSelectMenu) {
            otherPresetSelectMenu.addEventListener('change', (e) => {
                const presetName = e.target.value;
                if (!presetName) return;
                const preset = apiPresets.find(p => p.name === presetName);
                if (preset) {
                    if (confirm(`确定要应用预设 "${presetName}" 到其他 API 设置吗？`)) {
                        document.getElementById('other-api-url-input').value = preset.baseUrl;
                        document.getElementById('other-api-key-input').value = preset.apiKey;
                        document.getElementById('other-api-temp-input').value = preset.temperature;
                        const modelSel = document.getElementById('other-model-select');
                        if (preset.model) modelSel.innerHTML = `<option value="${preset.model}" selected>${preset.model}</option>`;
                        else modelSel.innerHTML = `<option value="">请先拉取模型</option>`;
                    } else {
                        e.target.value = "";
                    }
                }
            });
        }
		// ============================================================
		// 【新增】赛博求签 (Cyber Fortune) 功能系统
		// ============================================================
		
		let currentFortuneTargetId = null; // 标记正在求签的目标: 'user' 或 char.id

		// --- 0. 跨天清空求签数据逻辑 (零点重置) ---
		window.checkAndClearFortuneData = function() {
			const todayStr = new Date().toISOString().slice(0, 10);
			let isChanged = false;

			// 检查用户自己
			if (userInfo.fortuneData && userInfo.fortuneData.date !== todayStr) {
				userInfo.fortuneData = null;
				isChanged = true;
			}

			// 检查所有角色
			characters.forEach(char => {
				if (char.fortuneData && char.fortuneData.date !== todayStr) {
					char.fortuneData = null;
					isChanged = true;
				}
			});

			// 如果发生了跨天清理，保存并刷新 UI
			if (isChanged) {
				saveUserInfoToLocal();
				saveCharactersToLocal();
				console.log("[Cyber Fortune] 跨天检测：已清空昨天的求签记录！");
				
				// 如果当前正好停留在赛博求签的页面，自动刷新界面（重置出求签按钮）
				const activePage = document.querySelector('.page.active');
				if (activePage && activePage.id === 'cyber-fortune-list-page') {
					renderCyberFortuneList();
				} else if (activePage && activePage.id === 'cyber-fortune-detail-page' && currentFortuneTargetId) {
					openCyberFortuneDetail(currentFortuneTargetId);
				}
			}
		};

		// 启动后台自动检测定时器 (每分钟检查一次，确保半夜到了0点能自动清空)
		setInterval(() => {
			if (typeof window.checkAndClearFortuneData === 'function') {
				window.checkAndClearFortuneData();
			}
		}, 60000);

		// 监听前后台切换，从后台切回前台时立刻检查一次，防止挂机导致的遗漏
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden && typeof window.checkAndClearFortuneData === 'function') {
				window.checkAndClearFortuneData();
			}
		});
		
		const cyberFortuneEntryBtn = document.getElementById('cyber-fortune-entry-btn');
		const cyberFortuneListTopBack = document.querySelector('#cyber-fortune-list-top .top-bar-back');
		const cyberFortuneDetailTopBack = document.querySelector('#cyber-fortune-detail-top .top-bar-back');
		const cyberFortuneDrawBtn = document.getElementById('cyber-fortune-draw-btn');

		// 1. 导航入口
		if (cyberFortuneEntryBtn) {
			cyberFortuneEntryBtn.addEventListener('click', () => {
				// 每次点开列表时也要强制执行一次跨天校验
				if (typeof window.checkAndClearFortuneData === 'function') {
					window.checkAndClearFortuneData();
				}
				renderCyberFortuneList();
				switchPage('cyber-fortune-list-page');
				switchTopBar('cyber-fortune-list-top');
			});
		}

		if (cyberFortuneListTopBack) {
			cyberFortuneListTopBack.addEventListener('click', () => {
				switchPage('discover-page');
				switchTopBar('discover-top');
			});
		}

		if (cyberFortuneDetailTopBack) {
			cyberFortuneDetailTopBack.addEventListener('click', () => {
				currentFortuneTargetId = null;
				renderCyberFortuneList();
				switchPage('cyber-fortune-list-page');
				switchTopBar('cyber-fortune-list-top');
			});
		}

		// 2. 渲染人物列表
		function renderCyberFortuneList() {
			const container = document.getElementById('cyber-fortune-list-container');
			container.innerHTML = '';
			const todayStr = new Date().toISOString().slice(0, 10);

			// A. 渲染用户自己
			let userStatus = "点击求签";
			if (userInfo.fortuneData && userInfo.fortuneData.date === todayStr) {
				userStatus = `今日: ${userInfo.fortuneData.result}`;
			}
			const userAvatarHtml = userInfo.avatar ? `<img src="${userInfo.avatar}">` : `<i class="${userInfo.avatarIcon || 'fas fa-user'}" style="font-size:24px; color:#ccc; line-height:44px;"></i>`;
			
			container.innerHTML += `
				<div class="diary-char-card" onclick="openCyberFortuneDetail('user')">
					<div class="d-char-avatar" style="background:#eee;">${userAvatarHtml}</div>
					<div class="d-char-info">
						<div class="d-char-name">${userInfo.name} (自己)</div>
						<div class="d-char-desc" style="color: #ff7e5f;">${userStatus}</div>
					</div>
					<i class="fas fa-chevron-right" style="color:#ccc;"></i>
				</div>
			`;

			// B. 渲染所有私聊角色
			const validChars = characters.filter(c => c.type !== 'group');
			validChars.forEach(char => {
				let charStatus = "点击求签";
				if (char.fortuneData && char.fortuneData.date === todayStr) {
					charStatus = `今日: ${char.fortuneData.result}`;
				}
				const charAvatarHtml = char.avatar ? `<img src="${char.avatar}">` : `<i class="fas fa-user" style="font-size:24px; color:#ccc; line-height:44px;"></i>`;
				
				container.innerHTML += `
					<div class="diary-char-card" onclick="openCyberFortuneDetail('${char.id}')">
						<div class="d-char-avatar" style="background:#eee;">${charAvatarHtml}</div>
						<div class="d-char-info">
							<div class="d-char-name">${char.name}</div>
							<div class="d-char-desc" style="color: #ff7e5f;">${charStatus}</div>
						</div>
						<i class="fas fa-chevron-right" style="color:#ccc;"></i>
					</div>
				`;
			});
		}

		// 3. 打开详情页
		window.openCyberFortuneDetail = function(targetId) {
			currentFortuneTargetId = targetId;
			const titleEl = document.getElementById('cyber-fortune-detail-title');
			const avatarEl = document.getElementById('cyber-fortune-target-avatar');
			const nameEl = document.getElementById('cyber-fortune-target-name');
			const actionArea = document.getElementById('cyber-fortune-action-area');
			const resultArea = document.getElementById('cyber-fortune-result-area');
			const aiReactionArea = document.getElementById('cyber-fortune-ai-reaction');

			const todayStr = new Date().toISOString().slice(0, 10);
			let targetName = "";
			let targetAvatarHtml = "";
			let fortuneData = null;

			// 提取信息
			if (targetId === 'user') {
				targetName = userInfo.name;
				targetAvatarHtml = userInfo.avatar ? `<img src="${userInfo.avatar}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="${userInfo.avatarIcon || 'fas fa-user'}"></i>`;
				if (userInfo.fortuneData && userInfo.fortuneData.date === todayStr) {
					fortuneData = userInfo.fortuneData;
				}
			} else {
				const char = characters.find(c => c.id === targetId);
				if (char) {
					targetName = char.name;
					targetAvatarHtml = char.avatar ? `<img src="${char.avatar}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-user"></i>`;
					if (char.fortuneData && char.fortuneData.date === todayStr) {
						fortuneData = char.fortuneData;
					}
				}
			}

			// UI更新
			nameEl.textContent = targetName;
			avatarEl.innerHTML = targetAvatarHtml;

			if (fortuneData) {
				// 已经求过签
				actionArea.style.display = 'none';
				resultArea.style.display = 'block';
				document.getElementById('cyber-fortune-result-text').textContent = fortuneData.result;
				
				if (targetId !== 'user') {
					aiReactionArea.style.display = 'block';
					aiReactionArea.innerHTML = fortuneData.reaction ? `<b style="color:#ff7e5f;">${targetName} 的反应：</b><br>${fortuneData.reaction}` : "<i>(AI似乎未作出反应)</i>";
				} else {
					aiReactionArea.style.display = 'none';
				}
			} else {
				// 还没求签
				actionArea.style.display = 'block';
				resultArea.style.display = 'none';
				aiReactionArea.style.display = 'none';
				if (cyberFortuneDrawBtn) {
					cyberFortuneDrawBtn.disabled = false;
					cyberFortuneDrawBtn.innerHTML = '<i class="fas fa-hand-sparkles" style="margin-right: 8px;"></i>开始求签';
				}
			}

			switchPage('cyber-fortune-detail-page');
			switchTopBar('cyber-fortune-detail-top');
		};

		// 4. 点击摇签按钮
		if (cyberFortuneDrawBtn) {
			cyberFortuneDrawBtn.addEventListener('click', async () => {
				if (!currentFortuneTargetId) return;

				cyberFortuneDrawBtn.disabled = true;
				cyberFortuneDrawBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在连线赛博菩萨...';

				// 模拟动画延迟
				await new Promise(r => setTimeout(r, 1500));

				// 硬编码随机概率控制
				const rand = Math.random();
				let result = '大吉';
				if (rand < 0.10) result = '大吉';           // 10%
				else if (rand < 0.30) result = '中吉';      // 20%
				else if (rand < 0.60) result = '小吉';      // 30%
				else if (rand < 0.80) result = '小凶';      // 20%
				else if (rand < 0.95) result = '凶';        // 15%
				else result = '大凶';                       // 5%

				const todayStr = new Date().toISOString().slice(0, 10);

				if (currentFortuneTargetId === 'user') {
					userInfo.fortuneData = { date: todayStr, result: result };
					saveUserInfoToLocal();
					
					document.getElementById('cyber-fortune-action-area').style.display = 'none';
					document.getElementById('cyber-fortune-result-area').style.display = 'block';
					document.getElementById('cyber-fortune-result-text').textContent = result;
					document.getElementById('cyber-fortune-ai-reaction').style.display = 'none';
				} else {
					const char = characters.find(c => c.id === currentFortuneTargetId);
					if (char) {
						char.fortuneData = { date: todayStr, result: result, reaction: '' };
						
						document.getElementById('cyber-fortune-action-area').style.display = 'none';
						document.getElementById('cyber-fortune-result-area').style.display = 'block';
						document.getElementById('cyber-fortune-result-text').textContent = result;
						
						const aiReactionArea = document.getElementById('cyber-fortune-ai-reaction');
						aiReactionArea.style.display = 'block';
						aiReactionArea.innerHTML = `<b style="color:#ff7e5f;">${char.name} 的反应：</b><br><span style="color:#999;"><i class="fas fa-spinner fa-spin"></i> 正在生成反应...</span>`;

						// 触发 AI 生成反应
						await generateFortuneAiReaction(char, result);
					}
				}
			});
		}

		// 5. 角色对运势的反应生成
		async function generateFortuneAiReaction(char, fortuneResult) {
			let userName = userInfo.name;
			let userMaskDesc = userInfo.mask || "无特别设定";
			if (char.userMaskId) {
				const boundMask = userMasks.find(m => m.id === char.userMaskId);
				if (boundMask) {
					if (boundMask.name) userName = boundMask.name;
					if (boundMask.mask) userMaskDesc = boundMask.mask;
				}
			} else if (char.userName) {
				userName = char.userName.trim();
				if (char.userMask) userMaskDesc = char.userMask;
			}

			const { wbBefore, wbAfter } = getFormattedWorldBooks(char.worldBookIds);
			let weatherContext = typeof window.getWeatherPromptForAi === 'function' ? window.getWeatherPromptForAi(char.id) : "";
			let theirDayContext = typeof window.getTheirDayPromptForAi === 'function' ? window.getTheirDayPromptForAi(char.id) : ""; 
			let periodContext = "";
			if (typeof window.getPeriodStatusForAi === 'function' && typeof periodData !== 'undefined' && periodData.syncCharIds && periodData.syncCharIds.includes(char.id)) {
				periodContext = window.getPeriodStatusForAi();
			}

			const ltmText = (char.longTermMemories || []).join('; ');
			const lifeEventsText = (char.lifeEvents || []).map(e => `[${e.date}] ${e.event}`).join('; ');
			const recentChat = (char.chatHistory || []).slice(-10).map(m => {
				if (m.isHidden || m.isSystemMsg) return "";
				const role = m.type === 'sent' ? userName : char.name;
				return `${role}: ${m.text}`;
			}).filter(Boolean).join('\n');

			const systemPrompt = `
${wbBefore}
你现在是角色 "${char.name}"。
你们刚刚在手机上玩了一个叫“赛博求签”的小功能。今天系统抽给你的运势是：【${fortuneResult}】。

【角色设定】: ${char.persona}
【世界观与背景】: ${wbAfter}
【天气与环境】: ${weatherContext}
【今日日程】: ${theirDayContext}
${periodContext}
【近期记忆】: ${ltmText}
【人生档案】: ${lifeEventsText}
【最近聊天】: ${recentChat}

【任务要求】
请结合你的性格、目前的上下文状态以及今天的抽签结果（${fortuneResult}），给出你对这个运势结果最直接的反应。
- 如果抽得好，你可能会很开心或炫耀；如果抽得差，你可能会吐槽不准、抱怨或表现出倒霉的样子，甚至寻求安慰。
- **只需要说一两句话即可**。
- **直接输出说话的内容，不要带引号或任何解释，也不要有动作描写**。
`;

			try {
				// 优先使用 otherApiSettings
				const useSettings = (otherApiSettings && otherApiSettings.apiKey && otherApiSettings.baseUrl) ? otherApiSettings : chatApiSettings;
				const responseText = await callOpenAiApi([
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "请输出你对求签结果的一两句反应。" }
				], useSettings);

				let cleanText = responseText.replace(/^["']|["']$/g, '').trim();

				// 存入 char.fortuneData 数据
				char.fortuneData.reaction = cleanText;
				
				// 并且作为一条系统提示消息混入聊天记录中，作为以后的上下文桥梁 (可选)
				const sysMsg = {
					text: `[系统记录：${char.name} 刚刚进行了赛博求签，结果是 ${fortuneResult}。Ta 说：“${cleanText}” ]`,
					type: 'system',
					isHidden: true,
					isRead: true,
					timestamp: Date.now() + 10
				};
				if (!char.chatHistory) char.chatHistory = [];
				char.chatHistory.push(sysMsg);
				saveCharactersToLocal();

				// 更新 UI
				if (currentFortuneTargetId === char.id) {
					const aiReactionArea = document.getElementById('cyber-fortune-ai-reaction');
					if (aiReactionArea) {
						aiReactionArea.innerHTML = `<b style="color:#ff7e5f;">${char.name} 的反应：</b><br>${cleanText}`;
					}
				}
			} catch(e) {
				console.error("生成求签反应失败", e);
				if (currentFortuneTargetId === char.id) {
					const aiReactionArea = document.getElementById('cyber-fortune-ai-reaction');
					if (aiReactionArea) {
						aiReactionArea.innerHTML = `<b style="color:#ff7e5f;">${char.name} 的反应：</b><br><span style="color:red;">(AI 反应生成失败，请检查 API)</span>`;
					}
				}
			}
		}

		// 6. 全局方法：生成传递给各个模块 AI 的统一运势提示语
		window.getFortunePromptForAi = function(target) {
			const todayStr = new Date().toISOString().slice(0, 10);
			let prompt = "";
			
			// A. 提取用户自己的运势
			if (userInfo && userInfo.fortuneData && userInfo.fortuneData.date === todayStr) {
				prompt += `\n- 用户(${userInfo.name})今日运气水平: 【${userInfo.fortuneData.result}】`;
			}

			// B. 根据 target 提取对应角色的运势
			let charsToExtract = [];

			if (Array.isArray(target)) {
				charsToExtract = target;
			} else if (typeof target === 'string') {
				charsToExtract = [target];
			}

			if (charsToExtract.length > 0) {
				let charFortunes = "";
				charsToExtract.forEach(id => {
					const c = characters.find(char => char.id === id);
					if (c && c.type !== 'group' && c.fortuneData && c.fortuneData.date === todayStr) {
						charFortunes += ` [${c.name}]的运气水平:【${c.fortuneData.result}】;`;
					}
				});
				
				if (charFortunes) {
					prompt += `\n- 场上各角色今日运气水平:${charFortunes}`;
				}
			}

			if (prompt) {
				// 【核心优化】：加上最高级红线警告，强制AI化运势为剧情，严禁直白说出抽签
				return `\n【今日运气状态隐含设定 (绝对机密)】${prompt}\n(⚠️最高级别红线警告：以上是系统赋予角色的今日隐藏运气值。你必须将这种运气水平**暗中**转化为角色今天遭遇的具体事件、心情或细节走向。例如：大吉代表事情顺利或有意外之喜，大凶代表倒霉、出岔子。**绝对严禁**在台词、剧情、朋友圈或论坛中直接提到“求签”、“抽签”、“运势”、“赛博菩萨”、“大吉/大凶”等字眼，绝对不能暴露你是在按运势行事，只能顺其自然地演绎出这种运气带来的结果！)\n`;
			}
			return "";
		};
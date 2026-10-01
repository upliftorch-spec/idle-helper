/* ===== 閒人地圖 — Main App ===== */
(function () {
  'use strict';

  /* ---------- State ---------- */
  var state = {
    map: null,
    userLatLng: null,
    userMarker: null,
    locationPromise: null,
    locationNeedsRefresh: true,
    helperMarkers: [],
    isOnline: false,
    heartbeatTimer: null,
    activityTimer: null,
    sessionTimer: null,
    isLoggedIn: false,
    currentUser: null,
    socialLoginReadyPromise: null,
    socialLoginInitError: null,
    authLabelGuardFrame: null,
    activeTab: 'map',
    activeCategory: 'all',
    taskFilter: 'all',
    taskRole: 'helper',
    publishedFilter: 'open',
    helperFilter: 'find',
    publishedTasks: null,
    assignedTasks: null,
    taskResponses: null,
    taskLoadId: 0,
    detailTaskId: null,
    availableUntilAt: null,
    availableIndefinitely: false,
    helpers: []
  };

  var levelLabels = { gold: '金牌', silver: '銀牌', bronze: '銅牌' };
  var catColors = {
    errand: '#6366f1', move: '#f59e0b', teach: '#3b82f6',
    repair: '#ef4444', clean: '#22c55e', pet: '#ec4899', other: '#64748b'
  };

  /* ---------- Theme ---------- */
  function initTheme() {
    var saved = localStorage.getItem('idle-theme');
    if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme:dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  function toggleTheme() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('idle-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('idle-theme', 'dark');
    }
  }

  /* ---------- Map ---------- */
  function initMap() {
    state.map = L.map('map', {
      center: [24.1368, 120.685],
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(state.map);
    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>')
      .addTo(state.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(state.map);

    // 登入並同意使用條款後定位；不以預設地圖中心作為使用者位置。
    hideRadar();
  }

  /* ---------- Geolocation ---------- */
  /* ---------- Radar ---------- */
  function showRadar(msg) {
    var overlay = document.getElementById('radarOverlay');
    overlay.style.display = '';
    if (msg) overlay.querySelector('.radar-text').textContent = msg;
  }

  function hideRadar() {
    document.getElementById('radarOverlay').style.display = 'none';
  }

  function locateUser() {
    if (!state.locationPromise) {
    state.userLatLng = null;
    state.locationPromise = new Promise(function (resolve) {
    var btn = document.getElementById('btnLocate');
    var locationStatus = document.getElementById('mapLocationStatus');
    locationStatus.hidden = false;
    locationStatus.textContent = '正在定位目前位置…';
    btn.classList.add('locating');
    showRadar('正在努力幫您確認位置...');

    function failed() {
      if (state.userMarker) {
        state.map.removeLayer(state.userMarker);
        state.userMarker = null;
      }
      btn.classList.remove('locating');
      btn.setAttribute('aria-label', '尚未定位，點此重試');
      hideRadar();
      locationStatus.textContent = '尚未定位。允許定位後，按右上角定位按鈕重試。';
      document.getElementById('publishLocationHint').textContent = '尚未取得目前位置，請重新定位後再發布。';
      resolve(null);
    }

    if (!navigator.geolocation) {
      failed();
    } else {
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        state.userLatLng = [lat, lng];
        state.map.setView([lat, lng], 16);
        locationStatus.hidden = false;
        locationStatus.textContent = IdleServiceArea.contains(lat, lng) ? '台中市試營運中' : IdleServiceArea.message;
        hideRadar();

        if (state.userMarker) {
          state.userMarker.setLatLng([lat, lng]);
        } else {
          var icon = L.divIcon({
            className: 'my-location-icon',
            html: '<div class="pulse-ring pulse-ring-1"></div>' +
                  '<div class="pulse-ring pulse-ring-2"></div>' +
                  '<div class="pulse-ring pulse-ring-3"></div>' +
                  '<div class="my-dot"></div>',
            iconSize: [360, 360],
            iconAnchor: [180, 180]
          });
          state.userMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 1000 }).addTo(state.map);
        }

        btn.classList.remove('locating');
        btn.setAttribute('aria-label', '定位到目前位置');
        document.getElementById('publishLocationHint').textContent = IdleServiceArea.contains(lat, lng)
          ? '台中市試營運中；發布前請確認集合地址。' : IdleServiceArea.message;
        resolve(state.userLatLng);
      },
      failed,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    }
    }).then(function (coords) {
      state.locationPromise = null;
      return coords;
    });
    }
    return state.locationPromise;
  }

  function refreshMapLocation() {
    var locating = Promise.resolve(null);
    if (state.isLoggedIn && state.activeTab === 'map' && !document.hidden &&
        state.locationNeedsRefresh && localStorage.getItem('idle-consent-accepted')) {
      state.locationNeedsRefresh = false;
      locating = locateUser();
    }
    return locating;
  }

  /* ---------- Help Me ---------- */
  function initHelpMe() {
    var panel = document.getElementById('helpPanel');
    var listEl = document.getElementById('helpList');
    var loadingEl = document.getElementById('helpLoading');
    var filterChips = document.getElementById('helpFilterChips');
    var activeFilter = 'all';

    // 載入附近閒人數量
    async function loadIdleCount() {
      if (!window.IdleAPI || !state.userLatLng) return;
      var lat = state.userLatLng[0];
      var lng = state.userLatLng[1];
      if (!IdleServiceArea.contains(lat, lng)) {
        document.getElementById('idleCount').textContent = '—';
        updateHeatZone(0);
      } else {
      try {
        var result = await IdleAPI.nearbyProfiles(lat, lng, { radius: 5 });
        var count = (result && result.data) ? result.data.length : 0;
        document.getElementById('idleCount').textContent = count;
        updateHeatZone(count);
      } catch (e) {}
      }
    }

    var heatCircle = null;

    // 載入附近閒人數量 + 更新熱區
    function updateHeatZone(count) {
      var lat = state.userLatLng[0];
      var lng = state.userLatLng[1];

      if (heatCircle) {
        state.map.removeLayer(heatCircle);
        heatCircle = null;
      }

      if (count > 0) {
        // 人數越多，紅色越深（opacity 0.08 ~ 0.35）
        var opacity = Math.min(0.08 + count * 0.04, 0.35);
        var fillColor = '#ef4444';
        heatCircle = L.circle([lat, lng], {
          radius: 3000,
          color: 'transparent',
          fillColor: fillColor,
          fillOpacity: opacity,
          interactive: false,
        }).addTo(state.map);
      }
    }

    // 定期更新
    setInterval(loadIdleCount, 30000);
    setTimeout(loadIdleCount, 2000);

    document.getElementById('btnHelpMe').addEventListener('click', function () {
      if (!window.IdleAPI || !IdleAPI.getToken()) {
        showAuthGate();
        return;
      }
      panel.style.display = 'flex';
      document.getElementById('btnHelpMe').style.display = 'none';
      searchHelpers();
    });

    document.getElementById('btnCloseHelp').addEventListener('click', function () {
      panel.style.display = 'none';
      document.getElementById('btnHelpMe').style.display = '';
    });

    filterChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      filterChips.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      activeFilter = chip.getAttribute('data-cat');
      searchHelpers();
    });

    async function searchHelpers() {
      if (!state.userLatLng) await locateUser();
      if (!state.userLatLng) {
        loadingEl.style.display = 'none';
        listEl.innerHTML = '<div class="empty-state"><p>需要你的位置才能找附近的幫手。</p><p>請允許定位後，點地圖的定位按鈕重試。</p></div>';
        return;
      }
      var lat = state.userLatLng[0];
      var lng = state.userLatLng[1];
      var category = activeFilter === 'all' ? undefined : activeFilter;

      loadingEl.style.display = '';
      listEl.innerHTML = '';

      try {
        var result = await IdleAPI.nearbyProfiles(lat, lng, { category: category, radius: 5 });

        loadingEl.style.display = 'none';

        if (result && result.data && result.data.length > 0) {
          var html = '';
          result.data.forEach(function (p) {
            (p.services || []).forEach(function (s) {
              if (category && s.category !== category) return;
              var dist = p.distance ? Math.round(p.distance * 1000) : 0;
              var stars = p.rating ? IdleIcons.render('star-filled') + ' ' + p.rating : '';
              var matchCount = p.completedCount || 0;
              html += '<div class="svc-result" data-user-id="' + p.userId + '" data-profile-id="' + p.profileId + '" data-name="' + escapeHtml(p.displayName) + '">' +
                '<div class="svc-result-avatar">' + avatarHtml(p) + '</div>' +
                '<div class="svc-result-info">' +
                '<div class="svc-result-name">' + escapeHtml(p.displayName) + ' ' + levelBadgeHtml(p.level) + '</div>' +
                '<div class="svc-result-title">' + escapeHtml(s.title) + '</div>' +
                '<div class="svc-result-meta">' +
                '<span class="svc-result-price">NT$' + (s.pricePerHour || 0) + '/hr</span>' +
                '<span>媒合 ' + matchCount + ' 次</span>' +
                (dist ? '<span>' + dist + 'm</span>' : '') +
                (stars ? '<span style="color:var(--accent)">' + stars + '</span>' : '') +
                '</div></div>' +
                '<button class="svc-result-btn">查看</button>' +
                '</div>';
            });
          });

          if (html) {
            listEl.innerHTML = html;
            // 點擊卡片 → 開啟閒人詳情頁
            listEl.querySelectorAll('.svc-result').forEach(function (card) {
              card.addEventListener('click', function () {
                var targetUserId = Number(card.getAttribute('data-user-id'));
                var profileId = Number(card.getAttribute('data-profile-id'));
                var partnerName = card.getAttribute('data-name');
                if (!targetUserId) return;
                openProfileDetail(targetUserId, profileId, partnerName);
              });
            });
          } else {
            listEl.innerHTML = '<div class="empty-state"><p>附近沒有提供此類服務的閒人</p><p class="hint">試試其他類別</p></div>';
          }
        } else {
          listEl.innerHTML = '<div class="empty-state"><p>目前沒有上線的閒人</p><p class="hint">稍後再試，或發布任務等閒人來接</p></div>';
        }
      } catch (e) {
        loadingEl.style.display = 'none';
        listEl.innerHTML = '<div class="empty-state"><p>' + (e.code === 'service_area_unavailable' ? IdleServiceArea.message : '搜尋失敗，請稍後再試') + '</p></div>';
      }
    }
  }

  /* ---------- Online Toggle ---------- */
  function initOnlineToggle() {
    var toggle = document.getElementById('toggleOnline');
    var stopButton = document.getElementById('btnStopAvailability');
    stopButton.addEventListener('click', function () {
      if (toggle.checked && !toggle.disabled) toggle.click();
    });
    toggle.addEventListener('change', async function () {
      var requested = toggle.checked;
      if (!state.isLoggedIn || !window.IdleAPI || !IdleAPI.getToken()) {
        renderAvailability(null);
        showAuthGate();
      } else {
        toggle.disabled = true;
        stopButton.disabled = true;
        if (!requested) stopButton.textContent = '正在關閉…';
        try {
          if (requested) {
            var profile = await IdleAPI.myProfile();
            if (!profile || !profile.data) await IdleAPI.createProfile({ displayName: state.currentUser.nickname || '閒人' });
            var services = await IdleAPI.listServices();
            if (!services || !services.data || services.data.length === 0) {
              openMyServices();
              throw new Error('先加入至少一項願意提供的服務，再開啟接案通知喔。');
            }
            if (!await locateUser()) throw new Error('需要定位才能配對附近任務，請在設定中允許定位後重試。');
          }
          var coords = state.userLatLng || [];
          var result = await IdleAPI.toggleOnline(requested, coords[0], coords[1], Number(document.getElementById('availableHours').value));
          if (!result || !result.data) throw new Error('設定沒有儲存成功，請稍後再試。');
          renderAvailability(result.data.availableUntilAt, result.data.availableIndefinitely);
          if (requested) {
            await registerPushToken(true);
            if (window.IdleTutorial) IdleTutorial.onlineEnabled();
          } else {
            document.getElementById('availabilityHint').textContent = '已關閉接案通知。已接任務與聊天訊息不受影響。';
          }
        } catch (error) {
          renderAvailability(state.availableUntilAt, state.availableIndefinitely);
          alert(requested ? (error.message || '小樹懶暫時連不上，請再試一次。') : '尚未關閉接案通知，請確認連線後再試一次。');
        } finally {
          toggle.disabled = false;
          stopButton.disabled = false;
          stopButton.textContent = '關閉接案通知';
        }
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.isLoggedIn) refreshAvailability();
    });
    window.addEventListener('online', function () {
      if (state.isLoggedIn) { refreshAvailability(); loadMyTasks(); }
    });
  }

  function renderAvailability(until, indefinitely) {
    state.availableUntilAt = until || null;
    state.availableIndefinitely = indefinitely === true;
    state.isOnline = state.availableIndefinitely || (!!until && new Date(until).getTime() > Date.now());
    if (state.availableIndefinitely) document.getElementById('availableHours').value = '0';
    document.getElementById('toggleOnline').checked = state.isOnline;
    document.getElementById('availableHours').disabled = state.isOnline;
    document.getElementById('availableHours').hidden = false;
    document.getElementById('btnStopAvailability').hidden = !state.isOnline;
    document.querySelector('.status-dot').classList.toggle('online', state.isOnline);
    document.querySelector('.status-dot').classList.toggle('offline', !state.isOnline);
    document.querySelector('.status-text').textContent = state.isOnline ? '接案中' : '未接案';
    document.getElementById('availabilityHint').textContent = state.availableIndefinitely
      ? '永久接案中，直到手動關閉才停止。離開 App 仍以最後分享的位置配對，不會在背景持續定位。'
      : state.isOnline
        ? '接案至 ' + new Date(until).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) + '，到期自動停止。離開 App 仍以最後分享的位置配對。'
        : '預設永久接案，開啟後直到手動關閉才停止。離開 App 仍以最後分享的位置配對，不會在背景持續定位。';
    if (state.isOnline) startHeartbeat();
    else stopHeartbeat();
  }

  async function refreshAvailability() {
    try {
      var result = await IdleAPI.myProfile();
      renderAvailability(result && result.data && result.data.availableUntilAt, result && result.data && result.data.availableIndefinitely);
    } catch (error) {
      document.getElementById('availabilityHint').textContent = '暫時無法確認接案狀態，請恢復連線後再查看。';
    }
  }

  /* ---------- 前景更新位置，不延長使用者同意的接案時段 ---------- */
  function startHeartbeat() {
    stopHeartbeat();
    state.heartbeatTimer = setInterval(async function () {
      if (!state.availableIndefinitely && new Date(state.availableUntilAt).getTime() <= Date.now()) {
        renderAvailability(null);
      } else if (!document.hidden && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (position) {
          state.userLatLng = [position.coords.latitude, position.coords.longitude];
          IdleAPI.updateLocation(state.userLatLng[0], state.userLatLng[1]).then(function (result) {
            if (!IdleServiceArea.contains(state.userLatLng[0], state.userLatLng[1]) && result && result.data) {
              renderAvailability(result.data.availableUntilAt, result.data.availableIndefinitely);
              document.getElementById('availabilityHint').textContent = '你已離開台中市，接案通知已關閉。回到台中後可重新開啟。';
              document.getElementById('mapLocationStatus').hidden = false;
              document.getElementById('mapLocationStatus').textContent = IdleServiceArea.message;
            }
          }).catch(function (error) {
            console.warn('[location] update failed', error);
          });
        }, function () {
          document.getElementById('availabilityHint').textContent = '目前無法更新位置；接案期間仍以最後分享的位置配對，可隨時關閉。';
        }, { maximumAge: 60000, timeout: 10000 });
      }
    }, 90000);
  }

  function stopHeartbeat() {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  /* ---------- Auth Gate ---------- */
  var authLabelProtectedSelectors = ['.auth-brand-title', '.auth-copy', '.auth-benefits', '.auth-login-card'];

  function authRectsOverlap(first, second) {
    return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  }

  function updateAuthLabelVisibility() {
    var gate = document.getElementById('authGate');
    if (gate && !gate.classList.contains('hidden')) {
      var protectedRects = authLabelProtectedSelectors.map(function (selector) {
        return document.querySelector(selector).getBoundingClientRect();
      });
      document.querySelectorAll('.auth-stream-tag').forEach(function (tag) {
        var tagRect = tag.getBoundingClientRect();
        var overlapsForeground = protectedRects.some(function (protectedRect) {
          return authRectsOverlap(tagRect, protectedRect);
        });
        var foregroundOpacity = 1;
        protectedRects.forEach(function (protectedRect) {
          if (tagRect.left < protectedRect.right && tagRect.right > protectedRect.left) {
            var gap = Math.max(protectedRect.top - tagRect.bottom, tagRect.top - protectedRect.bottom, 0);
            foregroundOpacity = Math.min(foregroundOpacity, gap / 32);
          }
        });
        tag.style.setProperty('--foreground-opacity', String(foregroundOpacity));
        tag.style.visibility = overlapsForeground ? 'hidden' : 'visible';
      });
      state.authLabelGuardFrame = window.requestAnimationFrame(updateAuthLabelVisibility);
    } else {
      state.authLabelGuardFrame = null;
    }
  }

  function startAuthLabelVisibilityGuard() {
    if (!state.authLabelGuardFrame) {
      state.authLabelGuardFrame = window.requestAnimationFrame(updateAuthLabelVisibility);
    }
  }

  function showAuthGate() {
    clearInterval(state.sessionTimer);
    state.sessionTimer = null;
    if (window.IdleTutorial) IdleTutorial.endSession();
    clearInterval(state.activityTimer);
    state.activityTimer = null;
    renderTaskActivity([]);
    document.getElementById('authGate').classList.remove('hidden');
    startAuthLabelVisibilityGuard();
  }

  function hideAuthGate() {
    document.getElementById('authGate').classList.add('hidden');
    if (state.authLabelGuardFrame) {
      window.cancelAnimationFrame(state.authLabelGuardFrame);
      state.authLabelGuardFrame = null;
    }
  }

  function activateSession(user) {
    state.isLoggedIn = true;
    state.currentUser = user;
    updateAuthUI(user);
    hideAuthGate();
    state.locationNeedsRefresh = true;
    refreshMapLocation();
    document.getElementById('loginError').textContent = '';
    document.getElementById('loginError').style.display = 'none';
    clearInterval(state.sessionTimer);
    state.sessionTimer = setInterval(function () { IdleAPI.getToken(); }, 60000);
    checkConsent();
    if (window.IdleTutorial) IdleTutorial.beginSession(user);
    if (IdleAPI.connectWS) IdleAPI.connectWS();
    if (localStorage.getItem('idle-consent-accepted')) registerPushToken(false);
    refreshAvailability();
    loadTaskActivity();
    clearInterval(state.activityTimer);
    state.activityTimer = setInterval(loadTaskActivity, 60000);
  }

  function renderTaskActivity(items) {
    var labels = { errand: '跑腿代購', move: '搬運協助', teach: '教學陪伴', repair: '簡單修繕', clean: '清潔整理', pet: '寵物照顧', other: '生活幫忙' };
    var recent = items.filter(function (item) {
      var age = Date.now() - new Date(item.acceptedAt).getTime();
      return age >= 0 && age < 86400000;
    });
    var text = recent.map(function (item) { return '一位閒人成功接案 · ' + (labels[item.category] || labels.other); }).join('　 ✦　 ');
    document.getElementById('taskActivity').hidden = !text;
    document.body.classList.toggle('has-task-activity', !!text);
    if (document.getElementById('taskActivityText').textContent !== text) {
      document.getElementById('taskActivityText').textContent = text;
      document.getElementById('taskActivityCopy').textContent = text;
    }
    if (state.map) state.map.invalidateSize({ pan: false });
  }

  async function loadTaskActivity() {
    if (state.isLoggedIn && !document.hidden && navigator.onLine !== false) {
      try {
        var result = await IdleAPI.recentAcceptedTasks();
        // 登出或權杖失效後，不讓仍在途中的請求重新顯示接案消息。
        renderTaskActivity(state.isLoggedIn && result && Array.isArray(result.data) ? result.data : []);
      } catch (error) {
        console.warn('[task-activity] load failed', error);
        renderTaskActivity([]);
      }
    } else if (navigator.onLine === false) {
      renderTaskActivity([]);
    }
  }

  function initTaskActivity() {
    document.getElementById('btnPauseActivity').addEventListener('click', function () {
      var paused = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', String(paused));
      this.setAttribute('aria-label', paused ? '播放跑馬燈' : '暫停跑馬燈');
      this.innerHTML = IdleIcons.render(paused ? 'play' : 'pause');
      document.getElementById('taskActivityTrack').classList.toggle('paused', paused);
    });
    document.addEventListener('visibilitychange', loadTaskActivity);
    window.addEventListener('online', loadTaskActivity);
    window.addEventListener('offline', function () { renderTaskActivity([]); });
  }

  var GOOGLE_CLIENT_ID = (window.IDLE_HELPER_CONFIG && window.IDLE_HELPER_CONFIG.googleClientId) || '';
  // iOS 原生 Google 登入需專屬的 iOS OAuth client ID（Google Cloud Console 建立）
  var GOOGLE_IOS_CLIENT_ID = (window.IDLE_HELPER_CONFIG && window.IDLE_HELPER_CONFIG.googleClientId) || '';

  function getSocialLoginPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin;
  }

  function getSocialLoginInitOptions(platform) {
    var initOpts = {
      google: {
        iOSClientId: GOOGLE_IOS_CLIENT_ID,
        iOSServerClientId: GOOGLE_CLIENT_ID,
        webClientId: GOOGLE_CLIENT_ID,
        mode: 'online',
      },
    };
    if (platform === 'ios') {
      initOpts.apple = { clientId: 'com.upliftorch.idlehelper' };
    }
    return initOpts;
  }

  function initNativeSocialLogin(platform) {
    var SocialLogin = getSocialLoginPlugin();
    if (!SocialLogin) {
      state.socialLoginInitError = '找不到 SocialLogin 原生外掛，請重新安裝最新 TestFlight 版本';
      state.socialLoginReadyPromise = Promise.resolve(false);
    } else {
      state.socialLoginReadyPromise = SocialLogin.initialize(getSocialLoginInitOptions(platform)).then(function () {
        state.socialLoginInitError = null;
        return true;
      }).catch(function (e) {
        var msg = e && e.message ? String(e.message) : String(e || '初始化失敗');
        state.socialLoginInitError = msg;
        console.warn('[auth] SocialLogin initialize failed', e);
        return false;
      });
    }
  }

  async function ensureNativeSocialLoginReady() {
    var platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web';
    if (!state.socialLoginReadyPromise) {
      initNativeSocialLogin(platform);
    }
    await state.socialLoginReadyPromise;
    return !state.socialLoginInitError;
  }

  function setGoogleLoginBusy(isBusy) {
    var btn = document.getElementById('btnGoogleLogin');
    var label = btn && btn.querySelector('.google-login-label');
    if (btn) {
      btn.disabled = isBusy;
      btn.classList.toggle('is-loading', isBusy);
      btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    }
    if (label) {
      label.textContent = isBusy ? '正在開啟 Google 登入…' : '使用 Google 帳號繼續';
    }
  }

  function initAuthGate() {
    var platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web';
    var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    // 原生平台：初始化 capgo SocialLogin（Google 兩平台 + Apple 限 iOS）
    if (isNative) {
      initNativeSocialLogin(platform);
    }

    // Google 登入按鈕 — 原生走 capgo 原生流程，網頁走 redirect OAuth
    document.getElementById('btnGoogleLogin').addEventListener('click', async function () {
      if (isNative) {
        setGoogleLoginBusy(true);
        try {
          await handleGoogleNativeLogin();
        } catch (e) {
          var errEl = document.getElementById('loginError');
          errEl.textContent = 'Google 登入暫時迷路了，請檢查網路後再試一次';
          errEl.style.display = '';
        } finally {
          setGoogleLoginBusy(false);
        }
      } else {
        var currentUrl = window.location.origin + window.location.pathname;
        var redirectUri = encodeURIComponent(currentUrl);
        var scope = encodeURIComponent('email profile');
        var url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + GOOGLE_CLIENT_ID +
          '&redirect_uri=' + redirectUri +
          '&response_type=token&scope=' + scope;
        window.location.href = url;
      }
    });

    // Apple 登入按鈕 — 僅 iOS 原生顯示
    var btnApple = document.getElementById('btnAppleLogin');
    if (platform === 'ios' && btnApple) {
      btnApple.style.display = '';
      btnApple.addEventListener('click', handleAppleLogin);
    }

    // 網頁版才需要處理 Google OAuth redirect callback
    if (!isNative) {
      handleOAuthCallback();
    }

    // 「我的」頁面的登出按鈕
    document.getElementById('btnProfileAuth').addEventListener('click', async function () {
      if (state.isLoggedIn) {
        this.disabled = true;
        try {
          if (state.isOnline) {
            var offline = await IdleAPI.toggleOnline(false);
            if (!offline || !offline.data) throw new Error('stop_failed');
          }
          if (state.pushToken) await IdleAPI.unregisterPush(state.pushToken);
          renderAvailability(null);
          IdleAPI.clearToken();
          state.isLoggedIn = false;
          state.currentUser = null;
          updateAuthUI(null);
          showAuthGate();
        } catch (error) {
          alert('暫時無法停止接案通知，尚未登出。請恢復連線後再試。' + (state.availableIndefinitely ? '目前為永久接案，關閉成功前仍會持續配對。' : '接案時段到期會自動停止。'));
        } finally { this.disabled = false; }
      } else {
        showAuthGate();
      }
    });

    // ---- 編輯暱稱 ----
    document.getElementById('btnEditProfile').addEventListener('click', function () {
      var form = document.getElementById('profileEditForm');
      var input = document.getElementById('editDisplayName');
      var current = (state.currentUser && state.currentUser.profile && state.currentUser.profile.displayName)
        || (state.currentUser && state.currentUser.nickname) || '';
      input.value = current;
      form.style.display = form.style.display === 'none' ? '' : 'none';
    });

    document.getElementById('btnCancelProfile').addEventListener('click', function () {
      document.getElementById('profileEditForm').style.display = 'none';
    });

    document.getElementById('btnSaveProfile').addEventListener('click', async function () {
      var btn = this;
      var displayName = document.getElementById('editDisplayName').value.trim();
      if (!displayName) {
        alert('請輸入顯示名稱');
        return;
      }
      btn.disabled = true;
      try {
        await ensureProfile();
        var result = await IdleAPI.updateProfile({ displayName: displayName });
        if (result && result.data) {
          state.currentUser.profile = result.data;
          updateAuthUI(state.currentUser);
          document.getElementById('profileEditForm').style.display = 'none';
        } else {
          alert('更新失敗，請稍後再試');
        }
      } catch (e) {
        alert('更新失敗：' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false;
      }
    });

    // ---- 上傳大頭照 ----
    document.getElementById('profileAvatar').addEventListener('click', pickAndUploadAvatar);
    document.getElementById('profileAvatar').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pickAndUploadAvatar();
      }
    });
    document.getElementById('btnUploadAvatar').addEventListener('click', pickAndUploadAvatar);
    document.getElementById('avatarFileInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      var allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (file && allowedTypes.indexOf(file.type) === -1) {
        alert('請選擇 JPG、PNG 或 WebP 圖片。');
      } else if (file && file.size > 5 * 1024 * 1024) {
        alert('圖片有點太大了，請選擇 5MB 以下的照片。');
      } else if (file) {
        var reader = new FileReader();
        reader.onload = function () { uploadAvatarDataUrl(reader.result); };
        reader.readAsDataURL(file);
      }
      this.value = '';
    });
  }

  // 確保已有閒人檔案（更新前先建立）
  async function ensureProfile() {
    var profile = await IdleAPI.myProfile();
    if (!profile || !profile.data) {
      await IdleAPI.createProfile({ displayName: state.currentUser ? state.currentUser.nickname : '閒人' });
    }
  }

  // 挑選照片並上傳（native 用 Camera，web 用 file input）
  async function pickAndUploadAvatar() {
    if (!IdleAPI.getToken()) {
      showAuthGate();
    } else {
      var Camera = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
      var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
      if (isNative && Camera) {
        try {
          var photo = await Camera.getPhoto({
            resultType: 'base64',
            source: 'PROMPT',
            quality: 70,
            width: 512,
            height: 512,
            correctOrientation: true,
          });
          var dataUrl = 'data:image/' + (photo.format || 'jpeg') + ';base64,' + photo.base64String;
          await uploadAvatarDataUrl(dataUrl);
        } catch (e) {
          var msg = e && e.message ? e.message : String(e);
          if (!/cancel/i.test(msg)) alert('小樹懶沒找到這張照片，請再試一次。');
        }
      } else {
        document.getElementById('avatarFileInput').click();
      }
    }
  }

  function setAvatarUploadBusy(isBusy) {
    var button = document.getElementById('btnUploadAvatar');
    var label = document.getElementById('avatarUploadLabel');
    button.disabled = isBusy;
    button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    label.textContent = isBusy ? '照片上傳中…' : ((state.currentUser && state.currentUser.profile && state.currentUser.profile.avatar) ? '更換大頭貼' : '上傳大頭貼');
  }

  async function uploadAvatarDataUrl(dataUrl) {
    var avatarImg = document.getElementById('profileAvatarImg');
    var avatarIcon = document.getElementById('profileAvatarIcon');
    var previousAvatar = avatarImg.src;
    setAvatarUploadBusy(true);
    avatarImg.src = dataUrl;
    avatarImg.style.display = '';
    avatarIcon.style.display = 'none';
    try {
      await ensureProfile();
      var result = await IdleAPI.uploadAvatar(dataUrl);
      if (result && result.data && result.data.avatar) {
        var mine = await IdleAPI.myProfile();
        state.currentUser.profile = (mine && mine.data) || state.currentUser.profile || {};
        state.currentUser.profile.avatar = result.data.avatar;
        updateAuthUI(state.currentUser);
        alert('大頭貼換好了！小樹懶認得你囉。');
      } else {
        throw new Error('avatar_upload_failed');
      }
    } catch (e) {
      avatarImg.src = previousAvatar;
      updateAuthUI(state.currentUser);
      alert('大頭貼暫時傳不上去，請檢查網路後再試一次。');
    } finally {
      setAvatarUploadBusy(false);
    }
  }

  // Google OAuth callback — 從 URL hash 取得 access_token
  async function handleOAuthCallback() {
    var hash = window.location.hash;
    if (!hash || hash.indexOf('access_token') === -1) return;

    // 解析 hash 參數
    var params = {};
    hash.substring(1).split('&').forEach(function (part) {
      var kv = part.split('=');
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });

    var accessToken = params.access_token;
    if (!accessToken) return;

    // 清除 URL hash
    history.replaceState(null, '', window.location.pathname);

    var errEl = document.getElementById('loginError');
    errEl.style.display = 'none';

    if (!window.IdleAPI) {
      errEl.textContent = '無法連線伺服器';
      errEl.style.display = '';
      return;
    }

    var result = await IdleAPI.registerGoogle(null, accessToken, null);

    if (result && result.data && result.data.token) {
      IdleAPI.setToken(result.data.token);
      await onLoginSuccess();
    } else {
      errEl.textContent = (result && result.errorMessage) || '登入失敗，請稍後再試';
      errEl.style.display = '';
    }
  }

  // Apple 登入 — 原生 Sign in with Apple
  async function handleAppleLogin() {
    var errEl = document.getElementById('loginError');
    errEl.style.display = 'none';

    var socialLoginReady = await ensureNativeSocialLoginReady();
    var SocialLogin = getSocialLoginPlugin();
    if (!socialLoginReady || !SocialLogin) {
      errEl.textContent = 'Apple 登入初始化失敗：' + (state.socialLoginInitError || '此裝置不支援 Apple 登入');
      errEl.style.display = '';
      return;
    }

    var identityToken = null;
    var fullName = null;
    try {
      var appleResult = await SocialLogin.login({ provider: 'apple', options: { scopes: ['name', 'email'] } });
      var resp = appleResult && appleResult.result;
      identityToken = resp && resp.idToken;
      fullName = resp && resp.profile ? [resp.profile.givenName, resp.profile.familyName].filter(Boolean).join(' ') || null : null;
    } catch (e) {
      var msg = e && e.message ? String(e.message) : '';
      if (/cancel/i.test(msg)) {
        return;
      }
      errEl.textContent = 'Apple 登入失敗：' + (msg || '請稍後再試');
      errEl.style.display = '';
      return;
    }

    if (!identityToken) {
      errEl.textContent = '無法取得 Apple 授權資訊';
      errEl.style.display = '';
      return;
    }

    if (!window.IdleAPI) {
      errEl.textContent = '無法連線伺服器';
      errEl.style.display = '';
      return;
    }

    var result = await IdleAPI.registerApple(identityToken, fullName);
    if (result && result.data && result.data.token) {
      IdleAPI.setToken(result.data.token);
      await onLoginSuccess();
    } else {
      errEl.textContent = (result && result.errorMessage) || '登入失敗，請稍後再試';
      errEl.style.display = '';
    }
  }

  // Google 登入 — 原生 Google Sign-In
  async function handleGoogleNativeLogin() {
    var errEl = document.getElementById('loginError');
    errEl.style.display = 'none';

    var platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web';
    if (platform === 'ios' && !GOOGLE_IOS_CLIENT_ID) {
      errEl.textContent = 'Google 登入尚未設定完成，請改用 Apple 登入';
      errEl.style.display = '';
      return;
    }

    var socialLoginReady = await ensureNativeSocialLoginReady();
    var SocialLogin = getSocialLoginPlugin();
    if (!socialLoginReady || !SocialLogin) {
      errEl.textContent = 'Google 登入初始化失敗：' + (state.socialLoginInitError || '此裝置不支援 Google 登入');
      errEl.style.display = '';
      return;
    }

    var idToken = null;
    try {
      var googleResult = await SocialLogin.login({
        provider: 'google',
        options: {
          scopes: ['email', 'profile'],
          forcePrompt: platform === 'ios',
        },
      });
      var resp = googleResult && googleResult.result;
      idToken = resp && resp.idToken;
    } catch (e) {
      var msg = e && e.message ? String(e.message) : '';
      if (/cancel/i.test(msg)) {
        return;
      }
      errEl.textContent = 'Google 登入失敗：' + (msg || '請稍後再試');
      errEl.style.display = '';
      return;
    }

    if (!idToken) {
      errEl.textContent = '無法取得 Google 授權資訊';
      errEl.style.display = '';
      return;
    }

    if (!window.IdleAPI) {
      errEl.textContent = '無法連線伺服器';
      errEl.style.display = '';
      return;
    }

    var result = await IdleAPI.registerGoogle(idToken, null, null);
    if (result && result.data && result.data.token) {
      IdleAPI.setToken(result.data.token);
      await onLoginSuccess();
    } else {
      errEl.textContent = (result && result.errorMessage) || '登入失敗，請稍後再試';
      errEl.style.display = '';
    }
  }

  /* ---------- Consent ---------- */
  function checkConsent() {
    if (!localStorage.getItem('idle-consent-accepted')) {
      document.getElementById('consentModal').style.display = 'flex';
    }
  }

  function initConsent() {
    document.getElementById('btnAcceptConsent').addEventListener('click', function () {
      localStorage.setItem('idle-consent-accepted', '1');
      document.getElementById('consentModal').style.display = 'none';
      refreshMapLocation();
      registerPushToken(false);
      if (window.IdleTutorial) IdleTutorial.afterConsent();
    });
  }

  /* ---------- 信任資訊 / 成就 ---------- */
  var levelMeta = {
    gold: { label: '金牌', cls: 'gold' },
    silver: { label: '銀牌', cls: 'silver' },
    bronze: { label: '銅牌', cls: 'bronze' },
  };

  // 跳脫使用者輸入，避免 XSS（同時用於元素內容與屬性值）
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function levelBadgeHtml(level) {
    var m = levelMeta[level] || levelMeta.bronze;
    return '<span class="level-badge ' + m.cls + '">' + m.label + '</span>';
  }

  function avatarHtml(p) {
    if (p && p.avatar) {
      return '<img src="' + encodeURI(p.avatar) + '" alt="">';
    }
    return escapeHtml(p && p.displayName ? p.displayName.charAt(0) : '?');
  }

  var achievementIcons = {
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    medal: '<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  };

  function achievementIconSvg(key) {
    var paths = achievementIcons[key] || achievementIcons.award;
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  function achievementGridHtml(achievements) {
    return '<div class="achv-grid">' + (achievements || []).map(function (a) {
      return '<div class="achv-item ' + (a.earned ? 'earned' : 'locked') + '">' +
        '<div class="achv-icon">' + achievementIconSvg(a.icon) + '</div>' +
        '<div class="achv-name">' + a.name + '</div>' +
        '<div class="achv-desc">' + a.description + '</div>' +
        '<div class="achv-pts">' + a.points + ' pt</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  // 我的成就區（accordion 開啟時載入）
  async function loadMyAchievements() {
    var el = document.getElementById('achievementSection');
    if (!state.currentUser) {
      el.innerHTML = '<p class="hint" style="padding:.5rem">登入後即可查看成就</p>';
      return;
    }
    el.innerHTML = '<p class="hint" style="padding:.5rem">載入中…</p>';
    try {
      var res = await IdleAPI.achievements(state.currentUser.userId);
      var d = res && res.data;
      if (!d) {
        el.innerHTML = '<p class="hint" style="padding:.5rem">載入失敗</p>';
      } else {
        el.innerHTML =
          '<div class="detail-stats">' +
          '<div class="stat"><div class="stat-num">' + d.completedCount + '</div><div class="stat-label">媒合次數</div></div>' +
          '<div class="stat"><div class="stat-num">' + (d.rating || '—') + '</div><div class="stat-label">評分</div></div>' +
          '<div class="stat"><div class="stat-num">' + d.totalPoints + '</div><div class="stat-label">成就點數</div></div>' +
          '</div>' +
          achievementGridHtml(d.achievements);
      }
    } catch (e) {
      el.innerHTML = '<p class="hint" style="padding:.5rem">載入失敗，請稍後再試</p>';
    }
  }

  /* ---------- 閒人詳情頁 ---------- */
  var detailState = { userId: null, profileId: null, name: null };

  async function openProfileDetail(userId, profileId, name) {
    detailState = { userId: userId, profileId: profileId, name: name };
    var panel = document.getElementById('profileDetailPanel');
    var body = document.getElementById('detailBody');
    panel.style.display = 'flex';
    body.innerHTML = '<div class="help-panel-loading">載入中…</div>';

    try {
      var detailRes = await IdleAPI.profileDetail(profileId);
      var achvRes = await IdleAPI.achievements(userId);
      var reviewRes = await IdleAPI.reviewsByUser(userId);

      var p = detailRes && detailRes.data;
      var achv = achvRes && achvRes.data;
      var reviews = (reviewRes && reviewRes.data) || [];

      if (!p) {
        body.innerHTML = '<div class="empty-state"><p>找不到此閒人資料</p></div>';
      } else {
        var html = '';
        html += '<div class="detail-profile">' +
          '<div class="detail-avatar">' + avatarHtml(p) + '</div>' +
          '<div class="detail-name">' + escapeHtml(p.displayName) + ' ' + levelBadgeHtml(p.level) + '</div>' +
          (p.bio ? '<div class="detail-bio">' + escapeHtml(p.bio) + '</div>' : '') +
          '</div>';
        html += '<div class="detail-stats">' +
          '<div class="stat"><div class="stat-num">' + (achv ? achv.completedCount : 0) + '</div><div class="stat-label">媒合次數</div></div>' +
          '<div class="stat"><div class="stat-num">' + (achv && achv.rating ? achv.rating : '—') + '</div><div class="stat-label">評分</div></div>' +
          '<div class="stat"><div class="stat-num">' + (achv ? achv.totalPoints : 0) + '</div><div class="stat-label">成就點數</div></div>' +
          '</div>';
        if (achv) {
          html += '<div class="detail-section"><h4>成就徽章</h4>' + achievementGridHtml(achv.achievements) + '</div>';
        }
        if (p.services && p.services.length) {
          html += '<div class="detail-section"><h4>提供服務</h4>';
          p.services.forEach(function (s) {
            html += '<div class="detail-service"><span>' + escapeHtml(s.title) + '</span><span class="svc-result-price">NT$' + (s.pricePerHour || 0) + '/hr</span></div>';
          });
          html += '</div>';
        }
        html += '<div class="detail-section"><h4>評價（' + reviews.length + '）</h4>';
        if (reviews.length) {
          reviews.slice(0, 10).forEach(function (r) {
            var st = IdleIcons.ratingStars(r.rating);
            html += '<div class="detail-review"><div class="detail-review-top"><span>' + escapeHtml(r.reviewer ? r.reviewer.nickname : '匿名') + '</span><span style="color:var(--accent)">' + st + '</span></div>' +
              (r.comment ? '<div class="detail-review-comment">' + escapeHtml(r.comment) + '</div>' : '') + '</div>';
          });
        } else {
          html += '<p class="hint" style="padding:.5rem">尚無評價</p>';
        }
        html += '</div>';
        body.innerHTML = html;
      }
    } catch (e) {
      body.innerHTML = '<div class="empty-state"><p>載入失敗，請稍後再試</p></div>';
    }
  }

  function initProfileDetail() {
    document.getElementById('btnCloseDetail').addEventListener('click', function () {
      document.getElementById('profileDetailPanel').style.display = 'none';
    });

    document.getElementById('btnDetailContact').addEventListener('click', async function () {
      var btn = this;
      if (!detailState.userId) return;
      if (!ensureSafetyAck()) return;
      btn.disabled = true;
      try {
        var conv = await IdleAPI.startConversation(detailState.userId);
        if (conv && conv.data && conv.data.conversationId) {
          document.getElementById('profileDetailPanel').style.display = 'none';
          document.getElementById('helpPanel').style.display = 'none';
          document.getElementById('btnHelpMe').style.display = '';
          document.querySelector('.nav-item[data-tab="chat"]').click();
          var cid = conv.data.conversationId;
          var nm = detailState.name;
          setTimeout(function () { openChatRoom(cid, nm, detailState.userId); }, 300);
        }
      } catch (e) {
        alert('聯繫失敗：' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function handleTaskResponseNotification(event, shouldNavigate) {
    var notification = event && event.notification;
    var data = notification && notification.data ? notification.data : {};
    if (shouldNavigate && window.IdleTutorial) IdleTutorial.defer();
    if (['task_response', 'response_accepted', 'response_rejected', 'task_status', 'new_task'].includes(data.type)) {
      if (data.type === 'response_accepted' || data.type === 'task_status') await loadTaskActivity();
      await loadMyTasks();
      if (shouldNavigate && data.taskId) {
        await openTaskDetail(Number(data.taskId), true);
      } else if (shouldNavigate) {
        openTasks('helper', 'find');
      }
    } else if (data.conversationId && shouldNavigate) {
      document.querySelector('.nav-item[data-tab="chat"]').click();
      var conversations = await IdleAPI.listConversations();
      var conversation = conversations && conversations.data && conversations.data.find(function (c) { return Number(c.conversationId) === Number(data.conversationId); });
      if (conversation) {
        var partner = Number(conversation.userA && conversation.userA.userId) === Number(state.currentUser.userId) ? conversation.userB : conversation.userA;
        await openChatRoom(Number(data.conversationId), partner && partner.nickname, partner && Number(partner.userId));
      }
    }
  }

  // 取得 FCM 推播 token 並註冊到後端，並處理報價通知刷新／導向
  async function registerPushToken(shouldRequest) {
    var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    var FM = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseMessaging;
    var hint = document.getElementById('pushPermissionHint');
    if (!isNative || !FM || !window.IdleAPI || !IdleAPI.getToken()) {
      hint.textContent = '網頁版請回到任務頁查看更新；背景推播請使用 App。';
      return;
    }
    var platform = (window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'ios';
    try {
      var perm = shouldRequest ? await FM.requestPermissions() : await FM.checkPermissions();
      if (!perm || perm.receive !== 'granted') {
        hint.textContent = '通知尚未允許：可以按「開啟訊息通知」；若已拒絕，請到手機設定開啟。仍可在任務頁查看更新。';
        document.getElementById('btnEnablePush').hidden = false;
        return;
      }
      document.getElementById('btnEnablePush').hidden = true;
      var res = await FM.getToken();
      if (res && res.token) await IdleAPI.registerPush(res.token, platform);
      state.pushToken = res && res.token;
      hint.textContent = res && res.token ? '已登記通知裝置；飛航模式／無網路時，需恢復連線才能接收推播。' : '尚未取得通知裝置資訊，請稍後重新登入再試。';
      if (!state._pushListenerBound) {
        state._pushListenerBound = true;
        FM.addListener('tokenReceived', function (e) {
          if (e && e.token && IdleAPI.getToken()) {
            state.pushToken = e.token;
            IdleAPI.registerPush(e.token, platform).catch(function (error) {
              console.warn('[push] refresh token fail', error);
            });
          }
        });
        FM.addListener('notificationReceived', function (event) {
          handleTaskResponseNotification(event, false).catch(function (error) {
            console.warn('[push] refresh task response fail', error);
          });
        });
        FM.addListener('notificationActionPerformed', function (event) {
          handleTaskResponseNotification(event, true).catch(function (error) {
            console.warn('[push] open task response fail', error);
          });
        });
      }
    } catch (e) {
      console.warn('[push] register token fail', e);
      hint.textContent = '通知設定暫時未完成，請恢復網路後重新登入。';
    }
  }

  async function onLoginSuccess() {
    var result = await IdleAPI.me();
    if (result && result.data && result.data.userId) {
      activateSession(result.data);
    }
  }

  /* ---------- Auth State ---------- */
  async function checkAuth() {
    if (!window.IdleAPI || !IdleAPI.getToken()) {
      updateAuthUI(null);
      showAuthGate();
    } else {
      var restoringToken = IdleAPI.getToken();
      try {
        var result = await IdleAPI.me();
        if (IdleAPI.getToken() === restoringToken) {
          if (result && result.data && result.data.userId) {
            activateSession(result.data);
          } else {
            updateAuthUI(null);
            showAuthGate();
            document.getElementById('loginError').textContent = '暫時無法確認登入，登入狀態仍保留；恢復連線後會自動重試。';
            document.getElementById('loginError').style.display = '';
          }
        }
      } catch (e) {
        if (IdleAPI.getToken() === restoringToken) {
          updateAuthUI(null);
          showAuthGate();
          document.getElementById('loginError').textContent = '暫時連不上網路，登入狀態仍保留；恢復連線後會自動重試。';
          document.getElementById('loginError').style.display = '';
        }
      }
    }
  }

  function updateAuthUI(user) {
    if (!user) {
      state.taskLoadId++;
      state.publishedTasks = state.assignedTasks = state.taskResponses = null;
      renderMyTasks();
    }
    var nameEl = document.querySelector('.profile-name');
    var hintEl = document.querySelector('.profile-hint');
    var btnEl = document.getElementById('btnProfileAuth');
    var editBtn = document.getElementById('btnEditProfile');
    var avatarBadge = document.getElementById('avatarEditBadge');
    var avatarUploadBtn = document.getElementById('btnUploadAvatar');
    var avatarImg = document.getElementById('profileAvatarImg');
    var avatarIcon = document.getElementById('profileAvatarIcon');
    var editForm = document.getElementById('profileEditForm');

    if (user) {
      var displayName = (user.profile && user.profile.displayName) || user.nickname || user.username;
      nameEl.textContent = displayName;
      hintEl.textContent = user.profile ? '閒人等級：' + (levelLabels[user.profile.level] || user.profile.level) : '尚未建立閒人檔案';
      btnEl.textContent = '登出';
      editBtn.style.display = '';
      avatarBadge.style.display = '';
      avatarUploadBtn.style.display = '';
      if (user.profile && user.profile.avatar) {
        avatarImg.src = user.profile.avatar;
        avatarImg.style.display = '';
        avatarIcon.style.display = 'none';
      } else {
        avatarImg.style.display = 'none';
        avatarIcon.style.display = '';
      }
    } else {
      nameEl.textContent = '尚未登入';
      hintEl.textContent = '登入後即可使用完整功能';
      btnEl.textContent = '登入 / 註冊';
      editBtn.style.display = 'none';
      avatarBadge.style.display = 'none';
      avatarUploadBtn.style.display = 'none';
      editForm.style.display = 'none';
      avatarImg.style.display = 'none';
      avatarIcon.style.display = '';
    }
  }

  /* ---------- Task List ---------- */
  var statusLabels = { open: '等待接單', assigned: '已接單', in_progress: '進行中', completed: '已完成', cancelled: '已取消' };
  var catLabels = { errand: '跑腿代購', move: '搬運體力', teach: '教學輔導', repair: '維修水電', clean: '清潔打掃', pet: '寵物照顧', other: '其他' };
  var responseState = { taskId: null, taskTitle: '', taskBudget: 0 };

  function renderResponseQuote(quoteAmount, taskBudget) {
    var quote = Number(quoteAmount) || 0;
    var budget = Number(taskBudget) || 0;
    var comparisonClass = 'same';
    var arrow = '';
    var comparisonLabel = budget ? '與發布預算相同' : '報價';
    if (budget && quote > budget) {
      comparisonClass = 'higher';
      arrow = '<span class="response-quote-arrow" aria-hidden="true">↑</span>';
      comparisonLabel = '高於發布預算';
    } else if (budget && quote < budget) {
      comparisonClass = 'lower';
      arrow = '<span class="response-quote-arrow" aria-hidden="true">↓</span>';
      comparisonLabel = '低於發布預算';
    }
    return '<div class="response-quote ' + comparisonClass + '" aria-label="' + comparisonLabel + '，NT$' + quote + '">' +
      arrow + '<span>NT$' + quote + '</span></div>';
  }

  function renderTaskCard(t) {
    var typeClass = t.taskType === 'scheduled' ? 'scheduled' : 'instant';
    var typeLabel = t.taskType === 'scheduled' ? '預約' : '即時';
    var statusClass = (t.status || 'open').replace('_', '_');
    var dist = t.distance ? Math.round(t.distance * 1000) + 'm' : '';
    var time = t.createdAt ? new Date(t.createdAt).toLocaleDateString('zh-TW') : '';

    var pubUserId = t.publisher ? t.publisher.userId : (t.userId || '');
    var pubName = t.publisher ? (t.publisher.nickname || '') : '';
    var isMine = state.currentUser && Number(pubUserId) === Number(state.currentUser.userId);
    var isPinned = t.pinExpireAt && new Date(t.pinExpireAt).getTime() > Date.now();
    var responseCount = t.responseCount || (t.responses ? t.responses.length : 0);
    var ownResponse = state.currentUser && (t.responses || []).find(function (r) { return Number(r.userId) === Number(state.currentUser.userId); });
    var isAssigned = t.status !== 'open' && state.currentUser && t.assignee && Number(t.assignee.userId) === Number(state.currentUser.userId);
    var acceptedResponse = (t.responses || []).find(function (r) { return r.status === 'accepted'; });
    var roleLabel = isMine ? '你是發起者' : isAssigned ? '你是接案者' : ownResponse ? '你已提出報價' : '可接案的需求';
    var statusText = t.status === 'assigned' ? (isMine ? '已選定接案者' : isAssigned ? '已被接受' : '已由他人接案') : statusLabels[t.status] || t.status;
    var priceLabel = isAssigned && acceptedResponse ? '約定報酬' : isMine ? '我的預算' : '發起預算';
    var price = isAssigned && acceptedResponse ? acceptedResponse.quoteAmount : t.budget;
    var responseHtml = '';

    if (isMine && t.responses && t.responses.length) {
      responseHtml = '<div class="response-list">';
      t.responses.forEach(function (r) {
        var profileName = r.profile ? r.profile.displayName : '閒人';
        var accepted = r.status === 'accepted';
        responseHtml += '<div class="response-row">' +
          '<div class="response-main"><strong>' + escapeHtml(profileName) + '</strong>' +
          (r.message ? '<small>' + escapeHtml(r.message) + '</small>' : '') +
          '</div>' +
          '<div><small>對方報價</small>' + renderResponseQuote(r.quoteAmount, t.budget) + '</div>' +
          (accepted ? '<span class="task-card-status assigned">已接受</span>' :
            (r.status === 'pending' && t.status === 'open' ? '<button class="btn btn-accept-response" data-response-id="' + r.responseId + '">接受這份報價</button>' : '<span class="hint">' + (r.status === 'withdrawn' ? '已撤回' : '未被選中') + '</span>')) +
          (r.profile && r.profile.userId ? '<button class="btn btn-outline btn-contact-helper" data-user-id="' + r.profile.userId + '" data-name="' + escapeHtml(profileName) + '">聯繫接案者</button>' : '') +
          '</div>';
      });
      responseHtml += '</div>';
    }

    return '<div class="task-card" tabindex="0" data-my-quote="' + (ownResponse ? Number(ownResponse.quoteAmount) : '') + '" data-my-message="' + escapeHtml(ownResponse && ownResponse.message || '') + '" data-task-id="' + t.taskId + '" data-task-budget="' + (Number(t.budget) || 0) + '" data-pub-user-id="' + pubUserId + '" data-pub-name="' + escapeHtml(pubName) + '">' +
      '<span class="task-role-badge ' + (isMine ? 'publisher' : 'helper') + '">' + roleLabel + '</span>' +
      '<div class="task-card-header">' +
      '<div class="task-card-title">' + escapeHtml(t.title || '') + '</div>' +
      '<div class="task-card-budget"><small>' + priceLabel + '</small>' + (price === null || price === undefined ? '未設定' : 'NT$' + Number(price)) + '</div>' +
      '</div>' +
      (t.description ? '<div class="task-card-desc">' + escapeHtml(t.description) + '</div>' : '') +
      (t.scheduledAt ? '<p class="task-schedule">預約時間：' + escapeHtml(new Date(t.scheduledAt).toLocaleString('zh-TW', { hour12: false })) + '</p>' : '') +
      '<div class="task-card-meta">' +
      '<span class="tag ' + typeClass + '">' + typeLabel + '</span>' +
      (t.isUrgent ? '<span class="tag urgent">急件</span>' : '') +
      (isPinned ? '<span class="tag pinned">置頂</span>' : '') +
      '<span class="tag">' + escapeHtml(catLabels[t.category] || t.category) + '</span>' +
      (t.status && t.status !== 'open' ? '<span class="task-card-status ' + statusClass + '">' + escapeHtml(statusText) + '</span>' : '') +
      (dist ? '<span>' + dist + '</span>' : '') +
      (time ? '<span>' + time + '</span>' : '') +
      (t.publisher ? '<span>' + escapeHtml(t.publisher.nickname || '') + '</span>' : '') +
      (responseCount ? '<span>' + responseCount + ' 人回應</span>' : '') +
      '</div>' +
      responseHtml +
      (ownResponse ? '<p class="task-schedule">我的報價 NT$' + Number(ownResponse.quoteAmount) + ' · ' + escapeHtml(responseLabel(ownResponse, t)) + '</p>' : '') +
      '<div class="task-card-actions">' +
      (!isMine && t.status === 'open' ? '<button class="btn btn-respond-task">' + (ownResponse ? '修改報價' : '提出報價') + '</button>' : '') +
      (!isMine ? '<button class="btn btn-outline btn-contact-publisher">聯繫發起者</button>' : '') +
      '</div></div>';
  }

  // 首次聯繫陌生人前顯示一次安全提醒（記住後不再顯示）
  function ensureSafetyAck() {
    try {
      if (localStorage.getItem('idle-safety-ack') === '1') return true;
    } catch (e) {}
    var ok = confirm('安全提醒\n\n與陌生人見面或交易前，建議：\n・約在人多的公共場所碰面\n・先告知親友你的行蹤\n・完成前勿預先付款或提供個資\n\n了解並繼續？');
    if (ok) {
      try { localStorage.setItem('idle-safety-ack', '1'); } catch (e) {}
    }
    return ok;
  }

  // 引導使用者到「我的 → 我的服務」並展開該區塊
  function openMyServices() {
    var tab = document.querySelector('.nav-item[data-tab="profile"]');
    if (tab) tab.click();
    setTimeout(function () {
      var section = document.getElementById('myServicesSection');
      var item = section ? section.closest('.accordion-item') : null;
      if (item && !item.classList.contains('open')) {
        var btn = item.querySelector('.menu-item');
        if (btn) btn.click();
      }
    }, 300);
  }

  function bindTaskCards(container, isDetail) {
    container.querySelectorAll('.task-card').forEach(function (card) {
      var respondBtn = card.querySelector('.btn-respond-task');
      var contactBtn = card.querySelector('.btn-contact-publisher');
      var acceptBtns = card.querySelectorAll('.btn-accept-response');

      if (respondBtn) {
        respondBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          responseState.taskId = Number(card.getAttribute('data-task-id'));
          responseState.taskTitle = card.querySelector('.task-card-title').textContent;
          responseState.taskBudget = Number(card.getAttribute('data-task-budget')) || 0;
          document.getElementById('respondTaskTitle').textContent = responseState.taskTitle;
          document.getElementById('respondQuote').value = String(responseState.taskBudget);
          if (card.dataset.myQuote !== '') document.getElementById('respondQuote').value = card.dataset.myQuote;
          document.getElementById('respondBudgetHint').textContent = responseState.taskBudget
            ? '發起者預算為 NT$' + responseState.taskBudget + '，你可以再調整報價。'
            : '發起者未設定預算，請填入你的報價。';
          document.getElementById('respondMessage').value = card.dataset.myMessage || '';
          document.getElementById('respondSafetyConsent').checked = false;
          document.getElementById('respondModal').style.display = '';
          if (window.IdleTutorial) IdleTutorial.hint('quote');
        });
      }

      if (contactBtn) {
        contactBtn.addEventListener('click', async function (e) {
          e.stopPropagation();
          await contactPublisher(card);
        });
      }

      acceptBtns.forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          e.stopPropagation();
          var responseId = Number(btn.getAttribute('data-response-id'));
          btn.disabled = true;
          try {
            var accepted = await IdleAPI.acceptTaskResponse(responseId);
            if (!accepted || !accepted.data) throw new Error('這筆報價已無法接受，請重新整理任務。');
            await loadMyTasks();
            await loadTasks();
            await loadTaskActivity();
            if (state.detailTaskId) await openTaskDetail(state.detailTaskId);
          } catch (err) {
            alert('接受報價失敗：' + (err && err.message ? err.message : err));
          } finally {
            btn.disabled = false;
          }
        });
      });

      card.querySelectorAll('.btn-contact-helper').forEach(function (button) {
        button.addEventListener('click', async function (event) {
          event.stopPropagation();
          await contactTaskUser(Number(button.dataset.userId), button.dataset.name, Number(card.dataset.taskId));
        });
      });
      if (!isDetail) {
        card.addEventListener('click', function () { openTaskDetail(Number(card.dataset.taskId)); });
        card.addEventListener('keydown', function (event) {
          if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openTaskDetail(Number(card.dataset.taskId));
          }
        });
      }
    });
  }

  async function contactTaskUser(userId, name, taskId) {
    if (userId && ensureSafetyAck()) {
      try {
        var result = await IdleAPI.startConversation(userId, taskId);
        if (!result || !result.data) throw new Error('無法開啟對話，請稍後再試。');
        document.getElementById('taskDetailModal').style.display = 'none';
        document.querySelector('.nav-item[data-tab="chat"]').click();
        await openChatRoom(result.data.conversationId, name || '對方', userId);
      } catch (error) {
        alert('小樹懶暫時沒能開啟對話，請檢查連線後再試。');
      }
    }
  }

  async function openTaskDetail(taskId, navigate) {
    state.detailTaskId = taskId;
    var modal = document.getElementById('taskDetailModal');
    var content = document.getElementById('taskDetailContent');
    modal.style.display = 'flex';
    content.innerHTML = '<p class="hint">正在找出任務內容…</p>';
    try {
      var result = await IdleAPI.taskDetail(taskId);
      if (!result || !result.data) throw new Error('task_unavailable');
      var task = result.data;
      var me = state.currentUser && Number(state.currentUser.userId);
      var publisher = me && Number(task.userId) === me;
      var assigned = me && task.assignee && Number(task.assignee.userId) === me;
      var ownResponse = (task.responses || []).find(function (r) { return Number(r.userId) === me; });
      if (navigate) {
        var phase = publisher ? (task.status === 'open' ? 'open' : ['assigned', 'in_progress'].includes(task.status) ? 'active' : 'history')
          : assigned ? (['assigned', 'in_progress'].includes(task.status) ? 'active' : 'history')
          : ownResponse ? (ownResponse.status === 'pending' && task.status === 'open' ? 'pending' : 'history') : 'find';
        openTasks(publisher ? 'publisher' : 'helper', phase);
      }
      var otherId = publisher ? task.assignee && task.assignee.userId : task.userId;
      var otherName = publisher ? task.assignee && task.assignee.displayName : task.publisher && task.publisher.nickname;
      var html = renderTaskCard(task) + '<div class="task-detail-facts">' +
        '<p><strong>任務地點</strong><br>' + (task.locationApprox ? '媒合前只提供概略距離；接受後可查看約定地點。' : escapeHtml(task.address || '尚未填寫地址，請在聊天中確認公開集合地點。')) + '</p>' +
        '<p><strong>約定報酬</strong><br>' + escapeHtml(task.responses && task.responses.find(function (r) { return r.status === 'accepted'; }) ? 'NT$' + task.responses.find(function (r) { return r.status === 'accepted'; }).quoteAmount : (task.budget ? '發布預算 NT$' + task.budget + '，以接受的報價為準' : '尚未設定，請先報價確認')) + '</p>' +
        '<div class="safety-card compact">請約公開場所、不先付款、不交證件、不上陌生車。覺得不安全時可取消任務並於聊天中檢舉。</div></div>';
      if (publisher || assigned) {
        html += '<div class="tutorial-context" data-tutorial-hint="lifecycle" hidden>' + IdleIcons.render('book') + ' 在「任務 → ' + (publisher ? '發布' : '接案') + ' → 進行中」追蹤。確認工作完成後再按「確認完成」，接著評價對方；不安全時可以取消。<button type="button" data-dismiss-tutorial="lifecycle">知道了</button></div>';
        html += '<div class="task-state-actions">';
        if (task.status === 'assigned') html += '<button class="btn" data-task-status="in_progress">開始任務</button>';
        if (task.status === 'assigned' || task.status === 'in_progress') html += '<button class="btn" data-task-status="completed">確認完成</button>';
        if (['open', 'assigned', 'in_progress'].includes(task.status)) html += '<button class="btn btn-outline" data-task-status="cancelled">取消任務</button>';
        if (publisher && otherId) html += '<button class="btn btn-outline" id="btnTaskContactAssignee">聯繫接案者</button>';
        if (task.status === 'completed' && otherId) {
          var reviews = await IdleAPI.reviewsByTask(taskId);
          if (!reviews || !Array.isArray(reviews.data)) throw new Error('review_unavailable');
          var reviewed = reviews.data.some(function (r) { return Number(r.reviewerId) === me; });
          html += reviewed ? '<p class="hint">你已完成這次評價，謝謝你的分享。</p>' : '<button class="btn" id="btnTaskReview">評價對方</button>';
        }
        html += '</div>';
      }
      html += '<div class="task-status-confirm" role="group" aria-label="確認任務操作" hidden><p></p><button class="btn btn-confirm-status">確定</button> <button class="btn btn-outline btn-dismiss-status">返回</button></div>';
      content.innerHTML = html;
      if (window.IdleTutorial) IdleTutorial.hint('lifecycle');
      bindTaskCards(content, true);
      var pendingStatus = null;
      var confirmation = content.querySelector('.task-status-confirm');
      content.querySelectorAll('[data-task-status]').forEach(function (button) {
        button.addEventListener('click', function () {
          pendingStatus = button.dataset.taskStatus;
          confirmation.querySelector('p').textContent = pendingStatus === 'completed' ? '確認任務已完成？請先與對方確認服務內容及約定報酬。' : pendingStatus === 'cancelled' ? '確定取消任務？對方會收到狀態通知。' : '確認開始這次任務？';
          confirmation.hidden = false;
          confirmation.querySelector('.btn-confirm-status').focus();
          confirmation.scrollIntoView({ block: 'nearest' });
        });
      });
      confirmation.querySelector('.btn-dismiss-status').addEventListener('click', function () { confirmation.hidden = true; pendingStatus = null; });
      confirmation.querySelector('.btn-confirm-status').addEventListener('click', async function () {
        if (pendingStatus) {
          var button = this;
          button.disabled = true;
          try {
            var updated = await IdleAPI.updateTaskStatus(taskId, pendingStatus);
            if (!updated || !updated.data) throw new Error('status_changed');
            await Promise.all([loadMyTasks(), loadTasks(), loadTaskActivity()]);
            await openTaskDetail(taskId);
          } catch (error) {
            confirmation.querySelector('p').textContent = '尚未更新成功。請檢查網路；若對方已變更狀態，請重新開啟任務。';
          } finally { button.disabled = false; }
        }
      });
      var contact = content.querySelector('#btnTaskContactAssignee');
      if (contact) contact.addEventListener('click', function () { contactTaskUser(otherId, otherName, taskId); });
      var review = content.querySelector('#btnTaskReview');
      if (review) review.addEventListener('click', function () { modal.style.display = 'none'; openReviewModal(taskId, otherId, otherName); });
    } catch (error) {
      content.innerHTML = '<p class="hint">小樹懶暫時讀不到任務，請檢查連線後再試。</p><button class="btn" id="btnRetryTaskDetail">重新載入</button>';
      content.querySelector('#btnRetryTaskDetail').addEventListener('click', function () { openTaskDetail(taskId); });
    }
  }

  async function contactPublisher(card) {
        var pubUserId = Number(card.getAttribute('data-pub-user-id'));
        var pubName = card.getAttribute('data-pub-name');
        var taskId = Number(card.getAttribute('data-task-id'));
        if (!pubUserId || !window.IdleAPI || !IdleAPI.getToken()) return;
        // 不能跟自己聊
        if (state.currentUser && pubUserId === state.currentUser.userId) return;
        await contactTaskUser(pubUserId, pubName, taskId);
  }

  async function loadTasks() {
    var listEl = document.getElementById('taskList');
    if (!state.userLatLng) {
      listEl.innerHTML = '<div class="empty-state"><p>先選擇你的位置，才能找附近任務</p><button class="btn" id="btnTaskLocation">取得目前位置</button></div>';
      listEl.querySelector('#btnTaskLocation').addEventListener('click', async function () { if (await locateUser()) loadTasks(); });
    } else if (!IdleServiceArea.contains(state.userLatLng[0], state.userLatLng[1])) {
      listEl.innerHTML = '<div class="empty-state"><p>目前僅開放台中市</p><p class="hint">你仍可設定服務、查看既有任務與聊天。</p><button class="btn" id="btnTaskLocation">重新定位</button></div>';
      listEl.querySelector('#btnTaskLocation').addEventListener('click', async function () { if (await locateUser()) loadTasks(); });
    } else if (window.IdleAPI) {
      try {
        var result = await IdleAPI.nearbyTasks(state.userLatLng[0], state.userLatLng[1], { taskType: state.taskFilter === 'all' ? undefined : state.taskFilter });
        if (result && result.data) {
          if (result.data.length === 0) {
            listEl.innerHTML = window.IdleTutorial ? IdleTutorial.emptyTasksHTML() : '<div class="empty-state"><p>附近還沒有任務</p></div>';
          } else {
            var nearby = result.data.filter(function (task) { return !state.currentUser || Number(task.userId || (task.publisher && task.publisher.userId)) !== Number(state.currentUser.userId); });
            listEl.innerHTML = nearby.length ? nearby.map(renderTaskCard).join('') : '<div class="empty-state"><p>附近暫時沒有其他人的任務</p><p class="hint">先加入服務、開啟接案通知，等附近出現需求。</p></div>';
            bindTaskCards(listEl);
          }
        } else { throw new Error('tasks_unavailable'); }
      } catch (e) {
        listEl.innerHTML = '<div class="empty-state"><p>連線暫時不順，任務還沒載入</p><button class="btn" id="btnRetryTasks">重新載入</button></div>';
        listEl.querySelector('#btnRetryTasks').addEventListener('click', loadTasks);
      }
    }
  }

  async function loadMyTasks() {
    var userId = state.currentUser && Number(state.currentUser.userId);
    var loadId = ++state.taskLoadId;
    if (!state.isLoggedIn || !window.IdleAPI || !IdleAPI.getToken()) {
      state.publishedTasks = state.assignedTasks = state.taskResponses = null;
      renderMyTasks();
    } else {
      var results = await Promise.allSettled([IdleAPI.myPublishedTasks(), IdleAPI.myAssignedTasks(), IdleAPI.myTaskResponses()]);
      if (loadId === state.taskLoadId && state.isLoggedIn && state.currentUser && Number(state.currentUser.userId) === userId) {
        ['publishedTasks', 'assignedTasks', 'taskResponses'].forEach(function (key, index) {
          var result = results[index];
          state[key] = result.status === 'fulfilled' && result.value && Array.isArray(result.value.data) ? result.value.data : null;
          if (state[key] === null) console.warn('[tasks] ' + key + ' unavailable', result.reason || 'invalid_response');
        });
        renderMyTasks();
      }
    }
  }

  function responseLabel(response, task) {
    var label = { pending: '已報價，等待對方接受', accepted: '已被接受', rejected: '未被選中', withdrawn: '已撤回' }[response.status] || response.status;
    if (response.status === 'pending' && task.status !== 'open') label = task.status === 'cancelled' ? '任務已取消' : '招募已結束，報價未被接受';
    return label;
  }

  function responseTask(response) {
    return Object.assign({}, response.task, { responses: [response] });
  }

  function renderTaskList(id, tasks, emptyHTML) {
    var element = document.getElementById(id);
    element.innerHTML = tasks === null ? '<div class="empty-state"><p>' + (state.isLoggedIn ? '任務暫時讀不到，請重試。' : '登入後可查看自己的任務。') + '</p><button type="button" class="btn" data-task-action="retry">重新載入</button></div>'
      : tasks.length ? tasks.map(renderTaskCard).join('') : emptyHTML;
    bindTaskCards(element);
  }

  function renderMyTasks() {
    var me = state.currentUser && Number(state.currentUser.userId);
    var published = state.publishedTasks && state.publishedTasks.filter(function (t) { return Number(t.userId) === me; });
    var assigned = state.assignedTasks && state.assignedTasks.filter(function (t) { return t.assignee && Number(t.assignee.userId) === me && Number(t.userId) !== me; });
    var responses = state.taskResponses && state.taskResponses.filter(function (r) { return r.task && Number(r.userId) === me && Number(r.task.userId) !== me; });
    var ongoing = assigned && assigned.filter(function (t) { return ['assigned', 'in_progress'].includes(t.status); });
    var waiting = responses && responses.filter(function (r) { return r.status === 'pending' && r.task.status === 'open'; });
    var historyStatus = document.getElementById('publishedHistoryStatus').value || 'all';
    var pubList = published && published.filter(function (t) {
      return state.publishedFilter === 'open' ? t.status === 'open' : state.publishedFilter === 'active' ? ['assigned', 'in_progress'].includes(t.status) : ['completed', 'cancelled'].includes(t.status) && (historyStatus === 'all' || t.status === historyStatus);
    }).sort(function (a, b) {
      return (b.responses || []).filter(function (r) { return r.status === 'pending'; }).length - (a.responses || []).filter(function (r) { return r.status === 'pending'; }).length;
    });
    var newQuotes = (published || []).filter(function (t) { return t.status === 'open'; }).reduce(function (count, t) { return count + (t.responses || []).filter(function (r) { return r.status === 'pending'; }).length; }, 0);
    document.getElementById('publishedTaskSummary').textContent = published === null ? '發布任務尚未載入。' : newQuotes ? '有 ' + newQuotes + ' 份報價等待你選擇。' : '你是發起者：查看報價、選人幫忙、追蹤進度。';
    document.getElementById('helperTaskSummary').textContent = assigned === null || responses === null ? '部分接案資料尚未載入，可重新載入。' : '已接受／進行中 ' + ongoing.length + ' 個 · 等回覆 ' + waiting.length + ' 份。對方接受後才算接案。';
    renderTaskList('myPublishedTasks', pubList, '<div class="empty-state"><p>' + (state.publishedFilter === 'open' ? '目前沒有招募中的任務' : state.publishedFilter === 'active' ? '目前沒有進行中的發布任務' : '還沒有符合條件的發布紀錄') + '</p><p class="hint">有什麼需要幫忙的事？</p><button type="button" class="btn" data-task-action="publish">發布任務</button></div>');
    renderTaskList('myAssignedTasks', ongoing, '<div class="empty-state"><p>目前沒有進行中的接案</p><p class="hint">提出報價後，等對方接受才會出現在這裡。</p><button type="button" class="btn" data-task-action="find">找附近任務</button></div>');
    renderTaskList('myRespondedTasks', waiting && waiting.map(responseTask), '<div class="empty-state"><p>目前沒有等待回覆的報價</p><p class="hint">找一件適合你的需求，提出報價。</p><button type="button" class="btn" data-task-action="find">找附近任務</button></div>');
    var helperStatus = document.getElementById('helperHistoryStatus').value || 'all';
    var history = assigned === null || responses === null ? null : assigned.filter(function (t) { return ['completed', 'cancelled'].includes(t.status); }).concat(responses.filter(function (r) {
      return !(r.status === 'pending' && r.task.status === 'open') && !assigned.some(function (t) { return Number(t.taskId) === Number(r.task.taskId); }) && r.status !== 'accepted';
    }).map(responseTask)).filter(function (t) {
      var response = (t.responses || []).find(function (r) { return Number(r.userId) === me; });
      return helperStatus === 'all' || (['completed', 'cancelled'].includes(helperStatus) ? t.status === helperStatus : response && response.status === helperStatus);
    });
    renderTaskList('helperTaskHistory', history, '<div class="empty-state"><p>還沒有符合條件的接案紀錄</p><p class="hint">已完成、已取消與未被選中的報價會保留在這裡。</p></div>');
  }

  function setTaskRole(role, phase) {
    state.taskRole = role;
    if (role === 'publisher' && phase) state.publishedFilter = phase;
    if (role === 'helper' && phase) state.helperFilter = phase;
    document.getElementById('taskPublisherPanel').hidden = role !== 'publisher';
    document.getElementById('taskHelperPanel').hidden = role !== 'helper';
    document.getElementById('taskDiscovery').hidden = state.helperFilter !== 'find';
    document.getElementById('myAssignedTasks').hidden = state.helperFilter !== 'active';
    document.getElementById('myRespondedTasks').hidden = state.helperFilter !== 'pending';
    document.getElementById('taskHelperHistory').hidden = state.helperFilter !== 'history';
    document.getElementById('publishedHistoryFilter').hidden = state.publishedFilter !== 'history';
    document.querySelectorAll('[data-task-role]').forEach(function (button) {
      var selected = button.dataset.taskRole === role;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    ['published', 'helper'].forEach(function (kind) {
      document.querySelectorAll('[data-' + kind + '-filter]').forEach(function (button) {
        var selected = button.dataset[kind + 'Filter'] === state[kind + 'Filter'];
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    });
    renderMyTasks();
  }

  function openTasks(role, phase) {
    if (phase === 'history') document.getElementById(role === 'publisher' ? 'publishedHistoryStatus' : 'helperHistoryStatus').value = 'all';
    setTaskRole(role, phase);
    document.querySelector('.nav-item[data-tab="tasks"]').click();
  }

  function initTaskWorkspace() {
    document.getElementById('btnTaskPublish').addEventListener('click', function () {
      if (document.getElementById('publishSuccess').style.display !== 'none') document.getElementById('btnPublishAnother').click();
      document.querySelector('.nav-item[data-tab="publish"]').click();
    });
    document.getElementById('btnViewPublished').addEventListener('click', function () { openTasks('publisher', 'open'); });
    document.getElementById('pageTasks').addEventListener('click', function (event) {
      var role = event.target.closest('[data-task-role]');
      var pub = event.target.closest('[data-published-filter]');
      var helper = event.target.closest('[data-helper-filter]');
      var action = event.target.closest('[data-task-action]');
      if (role) setTaskRole(role.dataset.taskRole);
      else if (pub) setTaskRole('publisher', pub.dataset.publishedFilter);
      else if (helper) setTaskRole('helper', helper.dataset.helperFilter);
      else if (action) {
        if (action.dataset.taskAction === 'publish') document.getElementById('btnTaskPublish').click();
        else if (action.dataset.taskAction === 'find') { setTaskRole('helper', 'find'); loadTasks(); }
        else if (state.isLoggedIn) loadMyTasks();
        else showAuthGate();
      }
    });
    document.querySelector('.task-role-tabs').addEventListener('keydown', function (event) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        var role = event.key === 'Home' ? 'publisher' : event.key === 'End' ? 'helper' : state.taskRole === 'helper' ? 'publisher' : 'helper';
        setTaskRole(role);
        document.querySelector('[data-task-role="' + role + '"]').focus();
      }
    });
    ['publishedHistoryStatus', 'helperHistoryStatus'].forEach(function (id) { document.getElementById(id).addEventListener('change', renderMyTasks); });
  }

  function initTaskFilters() {
    var filters = document.getElementById('taskFilters');
    if (!filters) return;
    filters.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      filters.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      state.taskFilter = chip.getAttribute('data-filter');
      loadTasks();
    });
  }

  /* ---------- Publish Task ---------- */
  var safetyRiskKeywords = ['夜間', '晚上', '半夜', '凌晨', '偏僻', '地下室', '旅館', '飯店', '住處', '家裡', '到府', '上車', '接送', '載我', '關手機', '證件', '提款卡', '金融卡', '帳號', '密碼', '先匯款', '保證金'];
  var safetyChatKeywords = ['加 line', '加line', 'line聯絡', '私下聊', '私訊', '離開平台', '先匯款', '保證金', '押金', '證件', '身分證', '提款卡', '金融卡', '銀行帳號', '密碼', '上車', '車上', '旅館', '飯店', '關手機', '不要開定位', '偏僻'];

  function textHasSafetyRisk(text, keywords) {
    var source = String(text || '').toLowerCase();
    var matched = false;
    keywords.forEach(function (keyword) {
      if (source.indexOf(String(keyword).toLowerCase()) >= 0) {
        matched = true;
      }
    });
    return matched;
  }

  function isNightSchedule(value) {
    var isNight = false;
    if (value) {
      var date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        var hour = date.getHours();
        isNight = hour >= 22 || hour < 6;
      }
    }
    return isNight;
  }

  function getPublishRiskText(data) {
    var reasons = [];
    var combinedText = [data.title, data.description, data.address].join(' ');
    if (data.category === 'move') {
      reasons.push('搬運任務');
    }
    if (data.category === 'repair' || data.category === 'clean' || data.category === 'pet') {
      reasons.push('可能涉及到府或私人空間');
    }
    if (isNightSchedule(data.scheduledAt)) {
      reasons.push('夜間時段');
    }
    if (textHasSafetyRisk(combinedText, safetyRiskKeywords)) {
      reasons.push('文字含高風險情境');
    }

    var text = '';
    if (reasons.length) {
      text = '此任務可能有較高安全風險：' + reasons.join('、') + '。建議改約公開場所、保留平台內溝通、不要要求對方交出手機/證件/帳號或先付款。';
    }
    return text;
  }

  function showChatSafetyWarning(text) {
    var el = document.getElementById('chatSafetyWarning');
    if (el) {
      el.textContent = text;
      el.style.display = '';
    }
  }

  function getCuteChatError(message) {
    var text = String(message || '');
    var cute = '小樹懶剛剛送信跌了一跤，請再試一次。';
    if (text === 'chat_blocked') {
      cute = '你們目前不能互傳訊息。小樹懶先幫你把安全距離拉開。';
    } else if (text === 'empty_message') {
      cute = '小樹懶沒有拿到訊息內容，請輸入一點文字。';
    } else if (text === 'message_too_long') {
      cute = '這封信太長了，小樹懶背不動。請縮短到 1000 字內。';
    } else if (text === 'unauthorized' || text === 'invalid_token' || text === 'token_expired') {
      cute = '登入狀態跑去午睡了，請重新登入後再傳訊息。';
    } else if (text === 'missing_report_target') {
      cute = '小樹懶找不到要回報的對象，請先從對方的卡片重新進入聊天室。';
    }
    return cute;
  }

  function showChatError(message) {
    showChatSafetyWarning(getCuteChatError(message));
  }

  function refreshPublishSafetyWarning(selectedCat) {
    var warningEl = document.getElementById('publishRiskWarning');
    if (warningEl) {
      var data = {
        category: selectedCat,
        title: document.getElementById('taskTitle').value.trim(),
        description: document.getElementById('taskDesc').value.trim(),
        address: document.getElementById('taskAddress').value.trim(),
        scheduledAt: document.getElementById('taskSchedule').value,
      };
      var text = getPublishRiskText(data);
      warningEl.textContent = text;
      warningEl.style.display = text ? '' : 'none';
    }
  }

  function initPublishForm() {
    var form = document.getElementById('publishForm');
    var successEl = document.getElementById('publishSuccess');
    var typeSelect = document.getElementById('taskType');
    var schedGroup = document.getElementById('scheduledGroup');
    var selectedCat = 'errand';

    // Category chip selection
    var catChips = document.getElementById('publishCategoryChips');
    catChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      catChips.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      selectedCat = chip.getAttribute('data-cat');
      refreshPublishSafetyWarning(selectedCat);
    });

    // Show/hide scheduled time
    typeSelect.addEventListener('change', function () {
      if (typeSelect.value === 'scheduled') {
        schedGroup.style.display = '';
      } else {
        schedGroup.style.display = 'none';
      }
      refreshPublishSafetyWarning(selectedCat);
    });

    ['taskTitle', 'taskDesc', 'taskAddress', 'taskSchedule'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function () {
          refreshPublishSafetyWarning(selectedCat);
        });
      }
    });

    // Update location hint
    if (state.userLatLng) {
      document.getElementById('publishLocationHint').textContent = '位置：' + state.userLatLng[0].toFixed(4) + ', ' + state.userLatLng[1].toFixed(4);
    }

    // Submit
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var title = document.getElementById('taskTitle').value.trim();
      if (!title) return;
      if (!document.getElementById('publishSafetyConsent').checked) {
        alert('請先確認安全原則後再發布任務。');
        return;
      }

      var location = await locateUser();
      if (!location) {
        alert('還沒有取得你的位置，任務尚未發布。請允許定位後再試一次。');
        return;
      }

      var data = {
        category: selectedCat,
        title: title,
        description: document.getElementById('taskDesc').value.trim(),
        budget: Number(document.getElementById('taskBudget').value) || 0,
        taskType: typeSelect.value,
        address: document.getElementById('taskAddress').value.trim(),
        lat: location[0],
        lng: location[1],
      };

      data.isUrgent = false;
      data.searchRadiusKm = 5;
      data.boostSource = null;

      if (typeSelect.value === 'scheduled') {
        data.scheduledAt = document.getElementById('taskSchedule').value;
      }

      var riskText = getPublishRiskText(data);
      if (riskText && !confirm(riskText + '\n\n仍要發布這個任務嗎？')) {
        return;
      }

      try {
        if (!window.IdleAPI || !IdleAPI.getToken()) {
          alert('請先登入，再發布任務。');
        } else {
          var result = await IdleAPI.createTask(data);
          if (!result || !result.data) {
            var message = result && result.errorMessage === 'daily_urgent_used'
              ? '今天的免費急件推播已使用，取消急件後仍可發布任務。'
              : '發布失敗，請稍後再試。';
            alert(message);
          } else {
            form.style.display = 'none';
            successEl.style.display = '';
            if (window.IdleTutorial) IdleTutorial.published();
          }
        }
      } catch (err) {
        alert(err.code === 'service_area_unavailable' ? IdleServiceArea.message : '發布失敗，請檢查網路後再試。');
      }
    });

    // Publish another
    document.getElementById('btnPublishAnother').addEventListener('click', function () {
      form.reset();
      catChips.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      catChips.querySelector('[data-cat="errand"]').classList.add('active');
      document.getElementById('boostUrgent').checked = false;
      document.getElementById('boostExpanded').checked = false;
      document.getElementById('boostPinned').checked = false;
      document.getElementById('publishSafetyConsent').checked = false;
      selectedCat = 'errand';
      schedGroup.style.display = 'none';
      refreshPublishSafetyWarning(selectedCat);
      successEl.style.display = 'none';
      form.style.display = '';
    });
  }

  function initRespondModal() {
    document.getElementById('btnCancelResponse').addEventListener('click', function () {
      document.getElementById('respondModal').style.display = 'none';
    });

    document.getElementById('btnSubmitResponse').addEventListener('click', async function () {
      var btn = this;
      var quote = Number(document.getElementById('respondQuote').value) || 0;
      var message = document.getElementById('respondMessage').value.trim();
      if (!responseState.taskId) return;
      if (!document.getElementById('respondSafetyConsent').checked) {
        alert('請先確認接任務安全原則。');
        return;
      }
      btn.disabled = true;
      try {
        var result = await IdleAPI.respondToTask(responseState.taskId, quote, message);
        if (!result || !result.data) {
          throw new Error(result && result.errorMessage ? result.errorMessage : 'response_submit_failed');
        }
        document.getElementById('respondModal').style.display = 'none';
        alert('報價已送出，等對方接受才算接案。可到「任務 → 接案 → 等回覆」查看。');
        await Promise.all([loadTasks(), loadMyTasks()]);
        openTasks('helper', 'pending');
        if (state.detailTaskId) await openTaskDetail(state.detailTaskId);
      } catch (e) {
        alert('送出失敗：' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- Reviews ---------- */
  var reviewState = { taskId: null, revieweeId: null, rating: 0 };

  function initReviews() {
    // 星星評分
    var stars = document.querySelectorAll('#starRating .star');
    stars.forEach(function (star) {
      star.addEventListener('click', function () {
        reviewState.rating = Number(star.getAttribute('data-star'));
        stars.forEach(function (s) {
          if (Number(s.getAttribute('data-star')) <= reviewState.rating) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });
      });
    });

    // 送出評價
    document.getElementById('btnSubmitReview').addEventListener('click', async function () {
      if (!reviewState.rating || !reviewState.taskId || !reviewState.revieweeId) return;

      try {
        if (window.IdleAPI && IdleAPI.getToken()) {
          var result = await IdleAPI.createReview(
            reviewState.taskId,
            reviewState.revieweeId,
            reviewState.rating,
            document.getElementById('reviewComment').value.trim()
          );
          if (!result || !result.data) throw new Error('只有已完成任務的當事人可以評價，且每人只能評價一次。');
          var completedTaskId = reviewState.taskId;
          closeReviewModal();
          await openTaskDetail(completedTaskId);
        }
      } catch (err) {
        alert('評價失敗：' + (err && err.message ? err.message : '請稍後再試'));
      }
    });

    // 取消
    document.getElementById('btnCancelReview').addEventListener('click', closeReviewModal);

    // 我的評價紀錄

  }

  function openReviewModal(taskId, revieweeId, revieweeName) {
    reviewState = { taskId: taskId, revieweeId: revieweeId, rating: 0 };
    document.getElementById('reviewTarget').textContent = '評價 ' + (revieweeName || '對方');
    document.getElementById('reviewComment').value = '';
    document.querySelectorAll('#starRating .star').forEach(function (s) { s.classList.remove('active'); });
    document.getElementById('reviewModal').style.display = 'flex';
    if (window.IdleTutorial) IdleTutorial.hint('review');
  }

  function closeReviewModal() {
    document.getElementById('reviewModal').style.display = 'none';
    reviewState = { taskId: null, revieweeId: null, rating: 0 };
  }

  async function loadMyReviews() {
    var listEl = document.getElementById('myReviewList');
    if (!window.IdleAPI || !IdleAPI.getToken()) {
      listEl.innerHTML = '<p class="hint" style="text-align:center;color:var(--text2)">登入後可查看</p>';
      return;
    }

    try {
      var result = await IdleAPI.myReviews();
      if (result && result.data && result.data.length > 0) {
        listEl.innerHTML = result.data.map(function (r) {
          var stars = IdleIcons.ratingStars(r.rating);
          var time = new Date(r.createdAt).toLocaleDateString('zh-TW');
          var reviewer = r.reviewer ? r.reviewer.nickname : '匿名';
          var taskTitle = r.task ? r.task.title : '';
          return '<div class="review-card">' +
            '<div class="review-card-header">' +
            '<span class="review-card-name">' + escapeHtml(reviewer) + '</span>' +
            '<span class="review-card-stars">' + stars + ' ' + r.rating + '</span>' +
            '</div>' +
            (r.comment ? '<div class="review-card-comment">' + escapeHtml(r.comment) + '</div>' : '') +
            '<div class="review-card-meta">' + escapeHtml(taskTitle) + ' · ' + time + '</div>' +
            '</div>';
        }).join('');
      } else {
        listEl.innerHTML = '<p class="hint" style="text-align:center;color:var(--text2);padding:1rem">還沒有收到評價</p>';
      }
    } catch (e) {
      listEl.innerHTML = '<p class="hint" style="text-align:center;color:var(--text2)">載入失敗</p>';
    }
  }

  // 讓全域可用（popup 按鈕呼叫）
  window.openReviewModal = openReviewModal;

  /* ---------- Report / Block / Delete Account ---------- */
  var reportTargetUserId = null;
  var reportConvId = null;

  function initReport() {
    // 聊天室檢舉按鈕
    document.getElementById('btnChatReport').addEventListener('click', function () {
      if (!currentConvId) return;
      reportConvId = currentConvId;
      // 取得對方 userId（從 chatPartnerName 旁的 data）
      reportTargetUserId = state.chatPartnerUserId || null;
      if (reportTargetUserId) {
        document.getElementById('reportModal').style.display = 'flex';
      } else {
        showChatError('missing_report_target');
      }
    });

    // 送出檢舉 → 自動封鎖 → 退出聊天
    document.getElementById('btnSubmitReport').addEventListener('click', async function () {
      if (!reportTargetUserId || !window.IdleAPI) return;
      var reason = document.getElementById('reportReason').value;
      var desc = document.getElementById('reportDesc').value.trim();
      await IdleAPI.reportUser(reportTargetUserId, reason, desc, reportConvId);
      await IdleAPI.blockUser(reportTargetUserId);
      document.getElementById('reportModal').style.display = 'none';
      alert('檢舉已送出，已封鎖此使用者');
      document.getElementById('btnChatBack').click();
    });

    // 只封鎖不檢舉
    document.getElementById('btnBlockUser').addEventListener('click', async function () {
      if (!reportTargetUserId || !window.IdleAPI) return;
      await IdleAPI.blockUser(reportTargetUserId);
      document.getElementById('reportModal').style.display = 'none';
      alert('已封鎖此使用者');
      document.getElementById('btnChatBack').click();
    });

    // 取消
    document.getElementById('btnCancelReport').addEventListener('click', function () {
      document.getElementById('reportModal').style.display = 'none';
    });

    // 刪除帳號
    document.getElementById('btnDeleteAccount').addEventListener('click', async function () {
      if (!confirm('確定要刪除閒人地圖的任務、服務、聊天與個人資料嗎？其他 Upliftorch 服務的共用帳號不受影響。')) return;
      if (!confirm('再次確認：刪除後無法復原，確定要繼續嗎？')) return;

      try {
        var result = window.IdleAPI ? await IdleAPI.deleteAccount() : null;
        if (!result || !result.data || !result.data.success) throw new Error('刪除未完成，請稍後再試。');
        if (window.IdleTutorial) IdleTutorial.forgetAccount();
        IdleAPI.clearToken();
        localStorage.removeItem('idle-consent-accepted');
        state.isLoggedIn = false;
        state.currentUser = null;
        updateAuthUI(null);
        showAuthGate();
        alert('閒人地圖資料已刪除');
      } catch (err) {
        alert('刪除失敗：' + (err && err.message ? err.message : '請稍後再試'));
      }
    });
  }

  /* ---------- Accordion Toggle ---------- */
  function initAccordions() {
    document.querySelectorAll('.accordion-item .menu-item').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var item = btn.closest('.accordion-item');
        var body = item.querySelector('.accordion-body');
        var isOpen = item.classList.contains('open');
        if (isOpen) {
          item.classList.remove('open');
          body.style.display = 'none';
        } else {
          item.classList.add('open');
          body.style.display = '';
          // 觸發載入
          var id = body.id;
          if (id === 'myServicesSection') loadMyServicesFn();
          if (id === 'reviewSection') loadMyReviews();
          if (id === 'achievementSection') loadMyAchievements();
        }
      });
    });
  }

  var loadMyServicesFn;

  /* ---------- My Services ---------- */
  function initMyServices() {
    var section = document.getElementById('myServicesSection');
    var form = document.getElementById('serviceForm');
    var listEl = document.getElementById('myServiceList');
    var selectedCat = 'errand';
    var editingId = null;
    var selectedTaskTemplateIds = new Set();
    var selectedTaskTemplates = new Map();
    var pendingTaskForms = [];
    var pendingTaskIndex = 0;
    var serviceFormMode = 'custom';
    var taskLibraryTimer = null;
    var showingAllMyServices = false;
    var MY_SERVICE_PREVIEW_LIMIT = 6;
    var showingAllTaskLibrary = false;
    var taskLibraryItems = [];
    var TASK_LIBRARY_DEFAULT_LIMIT = 10;
    var TASK_LIBRARY_SEARCH_PREVIEW_LIMIT = 6;
    var TASK_LIBRARY_SEARCH_LIMIT = 40;

    function renderTaskLibrary(items, keyword) {
      var box = document.getElementById('taskLibraryList');
      if (box) {
        if (items && items.length) {
          var visibleItems = keyword && !showingAllTaskLibrary ? items.slice(0, TASK_LIBRARY_SEARCH_PREVIEW_LIMIT) : items;
          var hiddenCount = Math.max(items.length - TASK_LIBRARY_SEARCH_PREVIEW_LIMIT, 0);
          var chipsHtml = visibleItems.map(function (item) {
            var selected = selectedTaskTemplateIds.has(Number(item.templateId));
            return '<button type="button" class="task-library-chip ' + (selected ? 'selected' : '') + '" data-template-id="' + item.templateId + '">' +
              escapeHtml(item.title) +
              (item.usageCount ? '<small>' + item.usageCount + '</small>' : '') +
              '</button>';
          }).join('');
          var toggleHtml = '';
          if (keyword && hiddenCount) {
            toggleHtml = '<button type="button" class="task-library-more" id="btnToggleTaskLibrary">' +
              (showingAllTaskLibrary ? '收合結果' : '顯示全部 ' + items.length + ' 筆') +
              '</button>';
          }
          box.innerHTML = chipsHtml + toggleHtml;

          box.querySelectorAll('.task-library-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
              var id = Number(chip.getAttribute('data-template-id'));
              if (selectedTaskTemplateIds.has(id)) {
                selectedTaskTemplateIds.delete(id);
                selectedTaskTemplates.delete(id);
                chip.classList.remove('selected');
              } else {
                selectedTaskTemplateIds.add(id);
                selectedTaskTemplates.set(id, taskLibraryItems.find(function (task) {
                  return Number(task.templateId) === id;
                }));
                chip.classList.add('selected');
              }
              updateServicePickerActions();
            });
          });
          var toggleBtn = box.querySelector('#btnToggleTaskLibrary');
          if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
              showingAllTaskLibrary = !showingAllTaskLibrary;
              renderTaskLibrary(taskLibraryItems, keyword);
            });
          }
        } else {
          box.innerHTML = '<p class="hint" style="color:var(--text2);padding:.5rem">找不到符合的任務，可以直接用下方「自訂服務」新增。</p>';
        }
        updateServicePickerActions();
      }
    }

    function updateServicePickerActions() {
      var addSelectedBtn = document.getElementById('btnAddSelectedTasks');
      var addCustomBtn = document.getElementById('btnAddService');
      var searchInput = document.getElementById('taskLibrarySearch');
      var keyword = searchInput ? searchInput.value.trim() : '';
      var selectedCount = selectedTaskTemplateIds.size;
      addSelectedBtn.textContent = selectedCount ? '加入選取任務（' + selectedCount + '）' : '加入選取任務';
      addSelectedBtn.disabled = selectedCount === 0;
      addCustomBtn.textContent = keyword ? '＋ 自訂「' + keyword + '」' : '＋ 自訂服務';
    }

    async function loadTaskLibrary() {
      var input = document.getElementById('taskLibrarySearch');
      var keyword = input ? input.value.trim() : '';
      if (window.IdleAPI && IdleAPI.searchTaskLibrary) {
        var limit = keyword ? TASK_LIBRARY_SEARCH_LIMIT : TASK_LIBRARY_DEFAULT_LIMIT;
        var result = await IdleAPI.searchTaskLibrary(keyword, undefined, limit);
        taskLibraryItems = result && result.data ? result.data : [];
        renderTaskLibrary(taskLibraryItems, keyword);
      }
    }

    function scheduleTaskLibraryLoad() {
      if (taskLibraryTimer) clearTimeout(taskLibraryTimer);
      showingAllTaskLibrary = false;
      updateServicePickerActions();
      taskLibraryTimer = setTimeout(function () {
        loadTaskLibrary();
      }, 250);
    }

    var taskLibrarySearch = document.getElementById('taskLibrarySearch');
    if (taskLibrarySearch) {
      taskLibrarySearch.addEventListener('input', scheduleTaskLibraryLoad);
    }

    function selectServiceCategory(category) {
      selectedCat = category || 'other';
      catChips.querySelectorAll('.chip').forEach(function (chip) {
        if (chip.getAttribute('data-cat') === selectedCat) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    }

    function setServiceFormCopy(title, hint, saveLabel) {
      document.getElementById('serviceFormTitle').textContent = title;
      document.getElementById('serviceFormHint').textContent = hint;
      document.getElementById('btnSaveService').textContent = saveLabel || '儲存';
    }

    function openSelectedTaskForm() {
      var task = pendingTaskForms[pendingTaskIndex];
      if (task) {
        editingId = null;
        serviceFormMode = 'selected';
        selectServiceCategory(task.category);
        document.getElementById('svcTitle').value = task.title || '';
        document.getElementById('svcDesc').value = task.description || '';
        document.getElementById('svcPrice').value = '0';
        setServiceFormCopy(
          '修改選取任務（' + (pendingTaskIndex + 1) + '/' + pendingTaskForms.length + '）',
          '加入前可調整名稱、說明、類別與價格；新名稱需審核後才會出現在公開快搜。',
          pendingTaskIndex + 1 < pendingTaskForms.length ? '儲存並編輯下一筆' : '儲存並完成'
        );
        form.style.display = '';
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.getElementById('svcTitle').focus();
      }
    }

    document.getElementById('btnAddSelectedTasks').addEventListener('click', function () {
      if (!selectedTaskTemplateIds.size) {
        alert('請先選擇想幫忙的任務。');
      } else if (window.IdleAPI && IdleAPI.getToken()) {
        pendingTaskForms = Array.from(selectedTaskTemplates.values());
        pendingTaskIndex = 0;
        openSelectedTaskForm();
      } else {
        alert('請先登入，再加入想幫忙的任務。');
      }
    });

    // Category chips
    var catChips = document.getElementById('svcCategoryChips');
    catChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      catChips.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      selectedCat = chip.getAttribute('data-cat');
    });

    document.getElementById('btnAddService').addEventListener('click', function () {
      editingId = null;
      pendingTaskForms = [];
      pendingTaskIndex = 0;
      serviceFormMode = 'custom';
      var keyword = document.getElementById('taskLibrarySearch').value.trim();
      document.getElementById('svcTitle').value = keyword;
      document.getElementById('svcDesc').value = '';
      document.getElementById('svcPrice').value = '0';
      setServiceFormCopy('自訂新的服務', '儲存後可立即放在我的服務；審核通過後才會出現在公開快搜。', '儲存');
      form.style.display = '';
      document.getElementById('svcTitle').focus();
    });

    document.getElementById('btnCancelService').addEventListener('click', function () {
      pendingTaskForms = [];
      pendingTaskIndex = 0;
      form.style.display = 'none';
    });

    document.getElementById('btnSaveService').addEventListener('click', async function () {
      var title = document.getElementById('svcTitle').value.trim();
      if (!title) {
        alert('幫這項服務取個名字，就可以儲存囉。');
      } else if (window.IdleAPI && IdleAPI.getToken()) {
        var saveBtn = document.getElementById('btnSaveService');
        var saveLabel = saveBtn.textContent;
        var data = {
          category: selectedCat,
          title: title,
          description: document.getElementById('svcDesc').value.trim(),
          pricePerHour: Number(document.getElementById('svcPrice').value) || 0,
        };

        saveBtn.disabled = true;
        saveBtn.textContent = '儲存中...';
        try {
          var result;
          if (editingId) {
            data.serviceId = editingId;
            result = await IdleAPI.updateService(data);
          } else {
            // 首次教學可能比服務列表載入更早操作，儲存前確保建檔完成。
            var profile = await IdleAPI.myProfile();
            if (!profile || !profile.data) {
              profile = await IdleAPI.createProfile({ displayName: state.currentUser ? state.currentUser.nickname || '閒人' : '閒人' });
              if (!profile || !profile.data) throw new Error('profile_create_failed');
            }
            result = await IdleAPI.createService(data);
          }
          if (!result || !result.data) {
            throw new Error(result && result.errorMessage ? result.errorMessage : 'service_save_failed');
          }
          if (!editingId && state.currentUser) {
            state.currentUser.profile = profile.data;
            updateAuthUI(state.currentUser);
          }

          if (serviceFormMode === 'selected') {
            var savedTask = pendingTaskForms[pendingTaskIndex];
            selectedTaskTemplateIds.delete(Number(savedTask.templateId));
            selectedTaskTemplates.delete(Number(savedTask.templateId));
            pendingTaskIndex += 1;
            updateServicePickerActions();
            if (pendingTaskIndex < pendingTaskForms.length) {
              openSelectedTaskForm();
            } else {
              pendingTaskForms = [];
              pendingTaskIndex = 0;
              form.style.display = 'none';
              await loadTaskLibrary();
              await loadMyServices();
              if (!window.IdleTutorial || !IdleTutorial.serviceSaved()) alert('任務都加入完成了！上線並分享位置後，附近需求就能偵測到你。');
            }
          } else {
            form.style.display = 'none';
            await loadMyServices();
            if (window.IdleTutorial) IdleTutorial.serviceSaved();
          }
        } catch (error) {
          console.error('儲存服務失敗', error);
          alert('小樹懶沒能存好這項服務，請稍後再試一次。');
        } finally {
          saveBtn.disabled = false;
          if (saveBtn.textContent === '儲存中...') saveBtn.textContent = saveLabel;
        }
      } else {
        alert('登入狀態已失效，請重新登入後再試一次。');
      }
    });

    async function loadMyServices() {
      loadTaskLibrary();
      if (!window.IdleAPI || !IdleAPI.getToken()) {
        listEl.innerHTML = '<p class="hint" style="text-align:center;color:var(--text2)">登入後可查看</p>';
        return;
      }

      // 先確保有 profile
      var profile = await IdleAPI.myProfile();
      if (!profile || !profile.data) {
        await IdleAPI.createProfile({ displayName: state.currentUser ? state.currentUser.nickname : '閒人' });
      }

      var result = await IdleAPI.listServices();
      if (result && result.data && result.data.length > 0) {
        var services = result.data;
        var visibleServices = showingAllMyServices ? services : services.slice(0, MY_SERVICE_PREVIEW_LIMIT);
        var hiddenCount = Math.max(services.length - MY_SERVICE_PREVIEW_LIMIT, 0);
        var summaryHtml = '<div class="my-service-summary">已加入 ' + services.length + ' 項願意幫忙的任務' +
          (hiddenCount && !showingAllMyServices ? '，先顯示前 ' + MY_SERVICE_PREVIEW_LIMIT + ' 項' : '') +
          '</div>';
        var cardsHtml = visibleServices.map(function (s) {
          return '<div class="helper-card" data-svc-id="' + s.serviceId + '" data-cat="' + escapeHtml(s.category) + '" data-title="' + escapeHtml(s.title || '') + '" data-desc="' + escapeHtml(s.description || '') + '" data-price="' + (s.pricePerHour || 0) + '">' +
            '<div class="helper-avatar" style="font-size:.8rem">' + escapeHtml((catLabels[s.category] || s.category || '').charAt(0)) + '</div>' +
            '<div class="helper-info">' +
            '<div class="helper-name">' + escapeHtml(s.title) + ' <span class="badge" style="background:var(--primary)">' + escapeHtml(catLabels[s.category] || s.category) + '</span></div>' +
            '<div class="helper-meta"><span class="helper-distance" style="font-size:.85rem">NT$' + (s.pricePerHour || 0) + '/hr</span></div>' +
            '</div>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2" style="flex-shrink:0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
            '</div>';
        }).join('');
        var toggleHtml = '';
        if (hiddenCount) {
          toggleHtml = '<button type="button" class="btn btn-full btn-secondary my-service-toggle" id="btnToggleMyServices">' +
            (showingAllMyServices ? '收合服務' : '顯示全部 ' + services.length + ' 項') +
            '</button>';
        }
        listEl.innerHTML = summaryHtml + cardsHtml + toggleHtml;

        // 點擊服務卡片 → 編輯
        listEl.querySelectorAll('.helper-card').forEach(function (card) {
          card.addEventListener('click', function () {
            editingId = Number(card.getAttribute('data-svc-id'));
            pendingTaskForms = [];
            pendingTaskIndex = 0;
            serviceFormMode = 'edit';
            selectServiceCategory(card.getAttribute('data-cat'));
            document.getElementById('svcTitle').value = card.getAttribute('data-title');
            document.getElementById('svcDesc').value = card.getAttribute('data-desc');
            document.getElementById('svcPrice').value = card.getAttribute('data-price');
            setServiceFormCopy('修改服務內容', '調整後儲存，就會更新這項願意幫忙的任務。', '儲存修改');
            form.style.display = '';
          });
        });
        var toggleBtn = listEl.querySelector('#btnToggleMyServices');
        if (toggleBtn) {
          toggleBtn.addEventListener('click', function () {
            showingAllMyServices = !showingAllMyServices;
            loadMyServices();
          });
        }
      } else {
        showingAllMyServices = false;
        listEl.innerHTML = '<p class="hint" style="text-align:center;color:var(--text2);padding:1rem">還沒有新增服務</p>';
      }
    }

    loadMyServicesFn = loadMyServices;
    updateServicePickerActions();
  }

  /* ---------- Task Records ---------- */
  function initTaskRecords() {
    document.getElementById('btnRecordPublished').addEventListener('click', function () { openTasks('publisher', 'history'); });
    document.getElementById('btnRecordAssigned').addEventListener('click', function () { openTasks('helper', 'history'); });
  }

  /* ---------- Chat ---------- */
  var currentConvId = null;

  async function loadConversations() {
    var listEl = document.getElementById('conversationList');
    if (!window.IdleAPI || !IdleAPI.getToken()) {
      listEl.innerHTML = '<div class="empty-state" style="margin-top:2rem"><p>登入後即可使用聊天功能</p></div>';
      return;
    }

    try {
      var result = await IdleAPI.listConversations();
      if (result && result.data && result.data.length > 0) {
        var html = '';
        result.data.forEach(function (c) {
          var partner = (c.userA && c.userA.userId === state.currentUser.userId) ? c.userB : c.userA;
          var name = partner ? (partner.nickname || 'User') : '未知';
          var lastMsg = c.lastMessage ? c.lastMessage.content : '尚無訊息';
          var time = c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
          var badge = c.unreadCount > 0 ? '<span class="conv-badge">' + c.unreadCount + '</span>' : '';

          var partnerUserId = partner ? partner.userId : '';
          html += '<div class="conv-card" data-conv-id="' + c.conversationId + '" data-partner-name="' + escapeHtml(name) + '" data-partner-user-id="' + escapeHtml(partnerUserId) + '">' +
            '<div class="conv-avatar">' + escapeHtml(name.charAt(0)) + '</div>' +
            '<div class="conv-info">' +
            '<div class="conv-name"><span>' + escapeHtml(name) + badge + '</span><span class="time">' + time + '</span></div>' +
            '<div class="conv-last">' + escapeHtml(lastMsg) + '</div>' +
            '</div></div>';
        });
        listEl.innerHTML = html;

        // 點擊對話卡片進入聊天室
        listEl.querySelectorAll('.conv-card').forEach(function (card) {
          card.addEventListener('click', function () {
            openChatRoom(Number(card.getAttribute('data-conv-id')), card.getAttribute('data-partner-name'), Number(card.getAttribute('data-partner-user-id')));
          });
        });
      } else {
        listEl.innerHTML = '<div class="empty-state" style="margin-top:2rem"><p>還沒有聊天</p><p class="hint">在地圖上點擊閒人的「聯繫」按鈕開始聊天</p></div>';
      }
    } catch (e) {
      listEl.innerHTML = '<div class="empty-state" style="margin-top:2rem"><p>載入失敗</p></div>';
    }
  }

  async function openChatRoom(conversationId, partnerName, partnerUserId) {
    currentConvId = conversationId;
    if (arguments.length >= 3) {
      state.chatPartnerUserId = partnerUserId || null;
    }
    document.getElementById('chatListView').style.display = 'none';
    document.getElementById('chatRoomView').style.display = 'flex';
    document.getElementById('chatPartnerName').textContent = partnerName || '對方';
    if (window.IdleTutorial) IdleTutorial.hint('chat');
    showChatSafetyWarning('請把任務溝通留在閒人地圖內。若對方要求改用私人通訊、改到偏僻地點、先匯款、提供敏感資料、上陌生車或關閉手機，請立即取消並回報。');

    // 載入訊息
    var msgEl = document.getElementById('chatMessages');
    msgEl.innerHTML = '';

    if (window.IdleAPI) {
      try {
        var result = await IdleAPI.chatMessages(conversationId);
        if (result && result.data) {
          result.data.forEach(function (m) {
            appendMessage(m);
          });
          msgEl.scrollTop = msgEl.scrollHeight;

          // 標記已讀
          await IdleAPI.markChatRead(conversationId);
        } else if (result && result.errorMessage) {
          showChatError(result.errorMessage);
        }
      } catch (e) {
        showChatError(e && e.message ? e.message : e);
      }
    }
  }

  function appendMessage(m) {
    var msgEl = document.getElementById('chatMessages');
    var isMine = state.currentUser && m.senderId === state.currentUser.userId;
    var time = new Date(m.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

    var div = document.createElement('div');
    div.className = 'msg ' + (isMine ? 'sent' : 'received');
    if (m.status === 'failed') {
      div.className += ' failed';
    }
    var bubble = document.createElement('div');
    bubble.textContent = m.content;
    var timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = m.status === 'failed' ? '未送出' : time;
    div.appendChild(bubble);
    div.appendChild(timeEl);
    msgEl.appendChild(div);
    if (textHasSafetyRisk(m.content, safetyChatKeywords)) {
      showChatSafetyWarning('偵測到高風險訊息。若對方要求離開平台、先付款、交出證件/帳號、上陌生車、進入封閉空間或關閉手機，請不要配合，並使用右上角回報。');
    }
    msgEl.scrollTop = msgEl.scrollHeight;
    return div;
  }

  function initChat() {
    // 返回按鈕
    document.getElementById('btnChatBack').addEventListener('click', function () {
      currentConvId = null;
      document.getElementById('chatRoomView').style.display = 'none';
      document.getElementById('chatListView').style.display = '';
      loadConversations();
    });

    // 發送訊息
    var input = document.getElementById('chatInput');
    var sendBtn = document.getElementById('btnChatSend');

    async function sendMsg() {
      var content = input.value.trim();
      input.value = '';
      input.focus();
      if (!content || !currentConvId) return;
      if (textHasSafetyRisk(content, safetyChatKeywords)) {
        var ok = confirm('小樹懶提醒：這則訊息可能涉及離開平台、金錢、證件、陌生車輛或偏僻地點。請確認你仍要送出，並盡量留在平台內溝通。');
        if (!ok) {
          input.value = content;
          return;
        }
      }

      // 即時顯示
      var pendingEl = appendMessage({
        senderId: state.currentUser ? state.currentUser.userId : 0,
        content: content,
        createdAt: new Date().toISOString(),
      });

      if (window.IdleAPI && IdleAPI.getToken()) {
        try {
          var result = await IdleAPI.sendChatMessage(currentConvId, content);
          if (result && result.errorMessage) {
            pendingEl.className += ' failed';
            var timeEl = pendingEl.querySelector('.msg-time');
            if (timeEl) timeEl.textContent = '未送出';
            showChatError(result.errorMessage);
          }
        } catch (e) {
          pendingEl.className += ' failed';
          var failedTimeEl = pendingEl.querySelector('.msg-time');
          if (failedTimeEl) failedTimeEl.textContent = '未送出';
          showChatError(e && e.message ? e.message : e);
        }
      } else {
        pendingEl.className += ' failed';
        var noTokenTimeEl = pendingEl.querySelector('.msg-time');
        if (noTokenTimeEl) noTokenTimeEl.textContent = '未送出';
        showChatError('unauthorized');
      }
    }

    sendBtn.addEventListener('click', sendMsg);
    input.addEventListener('keypress', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMsg();
      }
    });

    // WebSocket 接收訊息
    if (window.IdleAPI) {
      IdleAPI.onWSMessage(function (data) {
        if (data.type === 'new_message' && data.data) {
          if (currentConvId && data.data.conversationId === currentConvId) {
            appendMessage(data.data);
            IdleAPI.markChatRead(currentConvId);
          } else {
            // 不在聊天室裡，顯示紅點
            document.getElementById('chatBadge').style.display = '';
          }
        } else if (data.type === 'auth_ok') {
          if (currentConvId) {
            openChatRoom(currentConvId, document.getElementById('chatPartnerName').textContent, state.chatPartnerUserId);
          } else if (state.activeTab === 'chat') {
            loadConversations();
          }
        } else if (data.type === 'auth_error') {
          showChatError(data.message || 'invalid_token');
        } else if (data.type === 'ws_closed') {
          showChatSafetyWarning('小樹懶正在重新連線，等等會自動補抓漏掉的訊息。');
        } else if (data.type === 'ws_error') {
          showChatError(data.message);
        }
      });
    }
  }

  /* ---------- Tab Navigation ---------- */
  function initTabNav() {
    var navItems = document.querySelectorAll('.nav-item');
    var mapEl = document.getElementById('map');
    var overlay = document.querySelector('.map-overlay');
    var onlineToggle = document.getElementById('onlineToggle');
    var helpMeBtn = document.getElementById('btnHelpMe');
    var helpPanel = document.getElementById('helpPanel');
    var pages = {
      tasks: document.getElementById('pageTasks'),
      publish: document.getElementById('pagePublish'),
      chat: document.getElementById('pageChat'),
      profile: document.getElementById('pageProfile')
    };

    navItems.forEach(function (item) {
      item.addEventListener('click', function () {
        var tab = item.getAttribute('data-tab');
        state.activeTab = tab;

        navItems.forEach(function (n) { n.classList.remove('active'); });
        item.classList.add('active');

        Object.keys(pages).forEach(function (key) {
          pages[key].style.display = 'none';
        });

        if (tab === 'map') {
          mapEl.style.display = '';
          overlay.style.display = '';
          onlineToggle.style.display = '';
          document.getElementById('mapLocationStatus').style.display = '';
          helpMeBtn.style.display = '';
          helpPanel.style.display = 'none';
          state.map.invalidateSize();
          refreshMapLocation();
        } else {
          mapEl.style.display = 'none';
          overlay.style.display = 'none';
          onlineToggle.style.display = 'none';
          document.getElementById('mapLocationStatus').style.display = 'none';
          helpMeBtn.style.display = 'none';
          helpPanel.style.display = 'none';
          if (pages[tab]) {
            pages[tab].style.display = '';
          }
          // Load data when switching tabs
          if (tab === 'tasks') {
            loadTasks();
            loadMyTasks();
          }
          if (tab === 'chat') {
            loadConversations();
            document.getElementById('chatBadge').style.display = 'none';
          }
          if (tab === 'publish') setTaskRole('publisher', 'open');
        }
      });
    });
  }

  /* ---------- Init ---------- */
  function init() {
    initTheme();
    initTaskActivity();
    initMap();
    initHelpMe();
    initOnlineToggle();
    initTabNav();
    initTaskWorkspace();
    initTaskFilters();
    document.getElementById('btnCloseTaskDetail').addEventListener('click', function () {
      document.getElementById('taskDetailModal').style.display = 'none';
      state.detailTaskId = null;
    });
    initPublishForm();
    initRespondModal();
    initChat();
    initReviews();
    initMyServices();
    initTaskRecords();
    initAccordions();
    initReport();
    initConsent();
    if (window.IdleTutorial) IdleTutorial.init({ openTask: function (id) { return openTaskDetail(id, true); }, openTasks: openTasks });
    initAuthGate();
    initProfileDetail();
    checkAuth();
    window.addEventListener('online', function () {
      if (!state.isLoggedIn && IdleAPI.getToken()) checkAuth();
    });
    window.addEventListener('focus', function () {
      if (!state.isLoggedIn && IdleAPI.getToken()) checkAuth();
      else refreshMapLocation();
    });
    window.addEventListener('blur', function () { state.locationNeedsRefresh = true; });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        state.locationNeedsRefresh = true;
      } else {
        if (IdleAPI.getToken() && !state.isLoggedIn) checkAuth();
        else refreshMapLocation();
      }
    });

    document.getElementById('btnTheme').addEventListener('click', toggleTheme);
    document.getElementById('btnLocate').addEventListener('click', locateUser);
    document.getElementById('btnEnablePush').addEventListener('click', function () { registerPushToken(true); });

    // 註冊 Service Worker (PWA)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }

    // 監聽 auth 事件
    window.addEventListener('idle:auth-required', function () {
      state.isLoggedIn = false;
      state.currentUser = null;
      updateAuthUI(null);
      showAuthGate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

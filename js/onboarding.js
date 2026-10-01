/* 閒人教學：本機、依帳號記錄；示範流程不呼叫交易 API。 */
(function () {
  'use strict';
  var DAY = 86400000;
  var userId = null, record = {}, pending = '', active = false, options = {}, lastFocus = null, offerKind = '';
  var bannerIds = ['tutorialServiceBanner', 'tutorialLocationBanner', 'tutorialTaskBanner', 'tutorialPublishBanner'];
  var $ = function (id) { return document.getElementById(id); };
  var key = function (id) { return 'idle-tutorial:' + id; };

  function promptFor(data, now) {
    var result = '';
    if (!data.offeredAt) result = 'first';
    else if (Number.isFinite(data.lastUsedAt) && now - data.lastUsedAt >= 30 * DAY) result = 'return';
    return result;
  }

  function readRecord(id) {
    var data = {};
    try { data = JSON.parse(localStorage.getItem(key(id)) || '{}') || {}; }
    catch (error) { console.warn('[tutorial] record unavailable', error); }
    return data;
  }

  function save() {
    if (userId !== null) {
      try { localStorage.setItem(key(userId), JSON.stringify(record)); }
      catch (error) { console.warn('[tutorial] save failed', error); }
    }
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function button(action, label, secondary) {
    return '<button type="button" class="btn btn-full ' + (secondary ? 'btn-outline' : '') + '" data-tutorial-action="' + action + '">' + label + '</button>';
  }

  function tab(name) { document.querySelector('.nav-item[data-tab="' + name + '"]').click(); }
  function tasks(role, phase) { if (options.openTasks) options.openTasks(role, phase); else tab('tasks'); }
  function clearBanners() { bannerIds.forEach(function (id) { $(id).hidden = true; }); }

  function closeDialog() {
    $('tutorialModal').hidden = true;
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  function dialog(title, description, body, actions, eyebrow) {
    lastFocus = document.activeElement;
    $('tutorialEyebrow').textContent = eyebrow || '樹懶陪你，慢慢上手';
    $('tutorialTitle').textContent = title;
    $('tutorialDescription').textContent = description;
    $('tutorialBody').innerHTML = body || '';
    $('tutorialActions').innerHTML = actions;
    $('tutorialError').hidden = true;
    $('tutorialModal').hidden = false;
    var card = $('tutorialModal').querySelector('.tutorial-card');
    card.scrollTop = 0;
    card.focus({ preventScroll: true });
  }

  function offer(kind) {
    pending = '';
    offerKind = kind;
    record.offeredAt = Date.now();
    save();
    var returning = kind === 'return';
    var actions = button('helper', '我想接案賺錢') + button('publisher', '我需要找人幫忙', true);
    dialog(returning ? '好久不見！找回手感吧' : '有空，就從這裡開始',
      returning ? '選擇想複習的方向，不用從頭設定；先確認有沒有待處理的任務。' : kind === 'manual' ? '選擇想看的教學；選回原本的方向，可以繼續上次進度。' : '選一個今天想做的事，小樹懶陪你完成第一步。', '', actions,
      returning ? '30 天沒見，歡迎回來' : '你的第一個小任務');
  }

  function banner(id, step, title, description, actions) {
    clearBanners();
    $(id).innerHTML = '<p class="tutorial-step">' + IdleIcons.render('book') + ' ' + step + '</p><h3>' + title + '</h3><p>' + description + '</p><div class="tutorial-inline-actions">' + actions + '<button type="button" class="tutorial-skip" data-tutorial-action="skip">稍後繼續</button></div>';
    $(id).hidden = false;
    $(id).scrollIntoView({ block: 'start' });
  }

  function locationStep(celebrate) {
    record.step = 2; save(); tab('profile');
    if ($('settingsSection').style.display === 'none') $('btnSettings').click();
    banner('tutorialLocationBanner', '2 / 3 · 設定接案通知', celebrate ? '第一項服務加入了！' : '有空多久，由你決定',
      '預設永久接案，也可選 1、4 或 8 小時。按下方按鈕後才會詢問定位與通知；離開 App 仍以最後分享的位置配對，不會在背景持續定位。永久模式直到手動關閉才停止，限時模式到期即停止。拒絕權限也能繼續看任務。',
      button('enable', '分享位置，開啟接案通知') + button('tasks', '先看看任務', true));
  }

  function taskStep() {
    record.step = 3; save(); tasks('helper', 'find');
    banner('tutorialTaskBanner', '3 / 3 · 找到合適的任務', '先看清楚，再決定接不接',
      '報酬多少、離我多遠、要做什麼、是否安全？點任務看詳情，回應時可以調整報價。通知未允許時，請主動回到任務頁查看更新。',
      button('demo', '練習一次接案（不會真的送出）') + button('finish', '我知道了，開始找任務', true));
  }

  async function start(role, returning, continuing) {
    var previousStep = record.step;
    closeDialog(); clearBanners(); active = true;
    record.role = role; record.step = 1; save();
    try {
      var tasks = returning ? await (role === 'publisher' ? IdleAPI.myPublishedTasks() : IdleAPI.myAssignedTasks()) : { data: [] };
      if (!tasks || !Array.isArray(tasks.data)) throw new Error('tasks_unavailable');
      var ongoing = tasks && Array.isArray(tasks.data) && tasks.data.find(function (t) { return ['assigned', 'in_progress'].includes(t.status); });
      if (ongoing) {
        active = false; tasks(role, 'active'); await options.openTask(ongoing.taskId);
        $('btnDeferredTutorial').hidden = false;
      } else if (role === 'publisher') {
        tab('publish');
        banner('tutorialPublishBanner', '1 / 2 · 寫下你的需求', '說清楚，別人才幫得上忙',
          '填寫事情、預算與公開交接地點。填完可以先預覽，教學不會替你發布；正式發布仍要由你按下按鈕確認。', button('preview', '預覽草稿與安全檢查'));
      } else {
        var services = await IdleAPI.listServices();
        if (!services || !Array.isArray(services.data)) throw new Error('services_unavailable');
        if (services.data.length) {
          if (continuing && previousStep === 3) taskStep();
          else locationStep(false);
        }
        else {
          tab('profile');
          var section = $('myServicesSection'), item = section.closest('.accordion-item');
          if (!item.classList.contains('open')) $('btnMyServices').click();
          banner('tutorialServiceBanner', '1 / 3 · 選擇我的服務', '先加入一件你願意做的事',
            '在下方搜尋、勾選任務，按「加入選取任務」，確認服務內容後儲存；也可以自訂。只選擇能力範圍內、相對安全的事情。', button('custom', '＋ 自訂我的第一項服務'));
        }
      }
    } catch (error) {
      console.warn('[tutorial] start failed', error); active = false;
      dialog('小樹懶暫時連不上', '你的資料不會被改動。恢復網路後可以從「我的 → 使用教學」繼續，也可以先看看不會送出資料的示範。', '', button('retry', '重試') + button('demo', '先看示範', true));
    }
  }

  function demo(stage) {
    var body = '', actions = '', title = '', description = '';
    if (stage === 1) {
      title = '練習：順路幫忙送一本書';
      description = '這是示範任務，不是真實需求，不會通知任何人。';
      body = '<div class="tutorial-demo-facts"><span>' + IdleIcons.render('money') + ' 預算 NT$200</span><span>' + IdleIcons.render('pin') + ' 距離約 400 公尺</span><span>' + IdleIcons.render('book') + ' 圖書館大門交接一本書</span><span>' + IdleIcons.render('shield') + ' 白天、公開場所、不需墊款</span></div>';
      actions = button('demo-quote', '練習提出報價');
    } else if (stage === 2) {
      title = '你的時間，你來報價'; description = '預設帶入發起者預算。提高報價是紅色 ↑，降低是綠色 ↓。';
      body = '<label class="form-label" for="tutorialQuote">練習報價（NT$）</label><input class="form-input" id="tutorialQuote" type="number" min="0" value="200"><p id="tutorialQuoteComparison" class="tutorial-comparison">與預算相同</p><label class="feature-check"><input type="checkbox" id="tutorialSafety"> 我會確認公開場所，不先付款、不交證件、不上陌生車。</label>';
      actions = button('demo-send', '練習送出（僅示範）');
    } else {
      title = '報價 ≠ 已經接案'; description = '練習完成，沒有送出任何真實報價。等發起者接受，才算成功接案。';
      body = '<ol class="tutorial-next"><li>到「任務 → 接案 → 等回覆」查看報價。</li><li>對方接受後，任務會出現在「接案 → 進行中」。</li><li>平台內聊天確認時間、地點及約定報酬，再開始任務。</li><li>完成後確認完成並評價；遇到不安全情況可取消、檢舉或封鎖。</li></ol>';
      actions = button('finish', '練習完成，回到真實任務');
    }
    dialog(title, description, body, actions, '示範練習 · 不會真的接案');
  }

  function finish(published) {
    active = false; clearBanners(); record.completedAt = Date.now(); record.step = 0; save();
    dialog(published ? '需求發布了！' : '第一步完成！', published ? '可以到任務頁查看回應，接受合適報價後再確認交接。' : '準備好時，再開始你的第一個真實任務。',
      '<div class="tutorial-demo-facts"><span>' + IdleIcons.render('help') + ' 服務與報價都由你決定</span><span>' + IdleIcons.render('pin') + ' 接案通知要自己開啟，不會自動上線</span><span>' + IdleIcons.render('shield') + ' 先聊清楚，公開場所交接</span></div>', button(published ? 'tasks-done' : 'done', published ? '查看我發布的任務' : record.role === 'publisher' ? '回到我的草稿' : '開始找任務'));
  }

  function skip() { active = false; pending = ''; clearBanners(); closeDialog(); }

  function afterConsent() {
    if (pending && userId !== null && $('consentModal').style.display === 'none') offer(pending);
  }

  function beginSession(user) {
    userId = user.userId; record = readRecord(userId);
    pending = promptFor(record, Date.now()); record.lastUsedAt = Date.now(); save();
    if (pending) afterConsent();
  }

  function hint(name) {
    document.querySelectorAll('[data-tutorial-hint="' + name + '"]').forEach(function (el) {
      el.hidden = !!(record.hints && record.hints[name]);
    });
  }

  function defer() {
    if (userId !== null && (active || pending || !$('tutorialModal').hidden)) {
      skip(); $('btnDeferredTutorial').hidden = false;
    }
  }

  function endSession() { skip(); userId = null; record = {}; $('btnDeferredTutorial').hidden = true; }

  async function action(name) {
    if (name === 'helper' || name === 'publisher') await start(name, offerKind === 'return', offerKind === 'manual' && record.role === name);
    else if (name === 'retry') await start(record.role || 'helper', false);
    else if (name === 'custom') { $('btnAddService').click(); $('serviceForm').scrollIntoView({ block: 'nearest' }); }
    else if (name === 'enable') { if (!$('toggleOnline').checked) $('toggleOnline').click(); else taskStep(); }
    else if (name === 'tasks') taskStep();
    else if (name === 'demo') demo(1);
    else if (name === 'demo-quote') demo(2);
    else if (name === 'demo-send') {
      var quote = Number($('tutorialQuote').value);
      if ($('tutorialQuote').value === '' || !Number.isFinite(quote) || quote < 0 || !$('tutorialSafety').checked) {
        $('tutorialError').textContent = '先填入有效報價，並確認安全原則喔。'; $('tutorialError').hidden = false;
      } else demo(3);
    } else if (name === 'preview') {
      // 預覽只驗證草稿欄位，不要求先勾選正式發布的同意欄位。
      var fields = ['taskTitle', 'taskBudget'];
      if ($('taskType').value === 'scheduled') fields.push('taskSchedule');
      var valid = fields.every(function (id) { return $(id).reportValidity(); });
      if (valid) {
        dialog('發布前，先確認這些事', '這只是草稿預覽，尚未發布，也沒有向任何人收費。',
          '<div class="tutorial-demo-facts"><strong>' + escape($('taskTitle').value) + '</strong><span>' + escape($('taskDesc').value || '請補充要做的事') + '</span><span>預算 NT$' + escape($('taskBudget').value || '0') + '</span><span>' + escape($('taskAddress').value || '請填入公開交接地點') + '</span><span>確認內容、時間、報酬與安全原則；不要要求對方墊款或交出證件。</span></div>',
          button('finish', '完成教學，保留草稿') + button('back', '回去調整', true), '2 / 2 · 預覽與安全檢查');
      }
    } else if (name === 'back') closeDialog();
    else if (name === 'finish') finish();
    else if (name === 'done') { closeDialog(); if (record.role === 'publisher') tab('publish'); else tasks('helper', 'find'); }
    else if (name === 'tasks-done') { closeDialog(); tasks('publisher', 'open'); }
    else if (name === 'skip') skip();
  }

  function init(config) {
    options = config;
    $('btnTutorial').addEventListener('click', function () { if (userId !== null) offer('manual'); });
    $('btnDeferredTutorial').addEventListener('click', function () { this.hidden = true; offer('manual'); });
    $('btnSkipTutorial').addEventListener('click', skip);
    $('tutorialModal').addEventListener('click', function (event) { if (event.target === this) skip(); });
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-tutorial-action]'), dismiss = event.target.closest('[data-dismiss-tutorial]');
      if (trigger) action(trigger.dataset.tutorialAction).catch(function (error) { console.error('[tutorial] action failed', error); });
      if (dismiss) {
        record.hints = record.hints || {}; record.hints[dismiss.dataset.dismissTutorial] = true; save();
        dismiss.closest('[data-tutorial-hint]').hidden = true;
      }
    });
    document.addEventListener('input', function (event) {
      if (event.target.id === 'tutorialQuote') {
        var amount = Number(event.target.value), label = $('tutorialQuoteComparison');
        label.textContent = amount > 200 ? '↑ 高於發起預算' : amount < 200 ? '↓ 低於發起預算' : '與預算相同';
        label.className = 'tutorial-comparison ' + (amount > 200 ? 'higher' : amount < 200 ? 'lower' : '');
      }
    });
    $('tutorialModal').addEventListener('keydown', function (event) {
      if (event.key === 'Escape') skip();
      else if (event.key === 'Tab') {
        var focusable = Array.from(this.querySelectorAll('button,input')).filter(function (el) { return !el.hidden && !el.disabled; });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.querySelector('.tutorial-card'))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (userId !== null) {
        if (!document.hidden) pending = promptFor(record, Date.now());
        record.lastUsedAt = Date.now(); save();
        if (!document.hidden) afterConsent();
      }
    });
  }

  window.IdleTutorial = {
    init: init, beginSession: beginSession, afterConsent: afterConsent, endSession: endSession, defer: defer, hint: hint, promptFor: promptFor,
    forgetAccount: function () { if (userId !== null) localStorage.removeItem(key(userId)); },
    serviceSaved: function () {
      var handled = active && record.role === 'helper' && record.step === 1;
      if (handled) locationStep(true);
      return handled;
    },
    onlineEnabled: function () { if (active && record.role === 'helper' && record.step === 2) taskStep(); },
    published: function () { if (active && record.role === 'publisher') finish(true); },
    emptyTasksHTML: function () { return '<div class="empty-state tutorial-empty"><span>' + IdleIcons.render('book') + '</span><h3>附近暫時沒有任務</h3><p>可以先練習接案流程，或加入服務並開啟接案通知。</p>' + button('demo', '看看示範任務') + '</div>'; },
  };
})();

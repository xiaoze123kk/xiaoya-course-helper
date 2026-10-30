(() => {
  'use strict';
  const protocol = 6;
  if (globalThis.__xiaoyaContentProtocol === protocol) return;
  globalThis.__xiaoyaContentProtocol = protocol;
  let run = null;
  let busy = false;
  let lastUrl = '';
  let arrived = Date.now();
  let lastAttempt = 0;
  let transition = null;
  let lastPlay = 0;
  let lastStatus = '';
  let taskTiming = null;
  let timingProbeAt = 0;
  let homeSignature = '';
  let homeStableSince = 0;
  let homeActionAt = 0;
  const homePath = '/app/jx-web/mycourse';
  const supported = /\.(mp4|webm|m4v|mov|pptx?|pdf|docx?)$/i;
  const route = () => {
    const match = location.pathname.match(/\/mycourse\/([^/]+)\/resource\/([^/]+)(?:\/([^/]+))?\/?$/);
    return match ? { course: match[1], folder: match[2], file: match[3] || null } : null;
  };
  const background = enabled => window.dispatchEvent(new CustomEvent('xiaoya-helper-background', { detail: enabled }));
  const save = () => chrome.runtime.sendMessage({ type: 'save', run }).catch(() => {});
  function log(text) {
    if (!run || text === lastStatus) return;
    lastStatus = text;
    run.status = text;
    run.logs = [...run.logs.slice(-39), { time: Date.now(), text }];
    void save();
  }
  function stop(text) {
    run.enabled = false;
    background(false);
    document.querySelectorAll('video').forEach(video => video.pause());
    log(text);
    void save();
  }
  function rows() {
    return [...document.querySelectorAll('.group-resource-node')].map(row => {
      const element = row.querySelector('.node-inner');
      const name = element?.textContent.trim();
      const folder = [...row.querySelectorAll('use')].some(icon =>
        (icon.getAttribute('xlink:href') || icon.getAttribute('href') || '').includes('resource-folder'));
      return { element, name, folder };
    }).filter(row => row.name);
  }
  function finished() {
    return !!document.querySelector('.ta_icon_btn .xy_btn_task_finish') ||
      [...document.querySelectorAll('.ta_icon_btn .btn_content')].some(e => /^已完成$/.test(e.textContent.trim()));
  }
  function openRow(row, folder) {
    transition = { url: location.href, at: Date.now() };
    row.element.click();
    if (folder) {
      row.element.click();
      row.element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    }
  }
  async function readHome(now) {
    if (transition) {
      if (now - transition.at > 15000) stop('待办任务未成功打开，请检查页面后重新开始。');
      return;
    }
    const all = [...document.querySelectorAll('.ant-radio-wrapper')].find(e => e.textContent.trim() === '显示全部任务');
    const available = [...document.querySelectorAll('.ant-checkbox-wrapper')].find(e => e.textContent.trim() === '仅显示可完成任务');
    if (!all) {
      const entry = document.querySelector('[title="点击查看/刷新待完成学习任务"]');
      if (!entry) return stop('未识别到登录后的待办入口，请先完成登录。');
      if (!homeActionAt) { homeActionAt = now; entry.click(); log('正在打开首页待完成任务…'); }
      else if (now - homeActionAt > 15000) stop('首页待办列表未打开，请刷新后重试。');
      return;
    }
    if (!all.querySelector('input')?.checked) { all.click(); homeStableSince = 0; return; }
    if (!available) return stop('未识别到“仅显示可完成任务”筛选，已暂停。');
    if (!available.querySelector('input')?.checked) { available.click(); homeStableSince = 0; return; }
    const cards = [...document.querySelectorAll('.task_card .gutter-row')];
    const eligible = cards.filter(card => card.classList.contains('ta_watch')).map(card => {
      const link = card.querySelector('a.group-resource-link');
      const name = link?.textContent.trim();
      const course = card.querySelector('a.group_link')?.textContent.trim();
      return { link, name, course, key: JSON.stringify([course, name]) };
    }).filter(task => task.name && task.course && supported.test(task.name));
    const signature = JSON.stringify(cards.map(card => card.textContent));
    if (signature !== homeSignature || !homeStableSince) {
      homeSignature = signature; homeStableSince = now; return;
    }
    if (now - homeStableSince < 2000) return;
    if (!cards.length) {
      const empty = [...document.querySelectorAll('.ant-modal')].some(e => /暂无任务/.test(e.textContent));
      if (!empty) {
        if (now - arrived > 20000) stop('待办列表加载异常，未将未加载的任务视为零。');
        return;
      }
    }
    run.tasks = eligible.map(({ name, course, key }) => ({ name, course, key }));
    run.skippedTasks = cards.length - eligible.length;
    await save();
    if (run.scanOnly) return stop(`已获取 ${eligible.length} 项可处理待办，另有 ${run.skippedTasks} 项其他类型；点击“开始队列”运行。`);
    const pending = eligible.find(task => !run.homeFinished.includes(task.key));
    if (!pending) return stop(`首页待办队列结束，已确认 ${run.completed.length} 项；其他类型未处理。`);
    if (eligible.filter(task => task.key === pending.key).length !== 1) {
      return stop('发现同课程同名待办，无法唯一识别，请进入课程后处理。');
    }
    run.homeTask = { key: pending.key, name: pending.name, course: pending.course };
    await save();
    log(`打开待办：${pending.course} / ${pending.name}`);
    transition = { url: location.href, at: now };
    pending.link.click();
  }
  async function next(info) {
    const items = rows();
    if (!items.length) return stop('未识别到任务列表，请打开课程内容后重新开始。');
    const heading = document.querySelector('h5.title')?.getAttribute('title');
    const currentTitle = heading || document.title.split(' | ')[0];
    const pending = items.find(row => !row.folder && supported.test(row.name) &&
      !run.visited.includes(`${info.folder}/${row.name}`));
    if (pending) {
      log(`打开：${pending.name}`);
      if (info.file && pending.name === currentTitle) return;
      openRow(pending, false);
      return;
    }
    if (run.options.recursive) {
      const folder = items.find(row => row.folder && !run.visited.includes(`${info.folder}/${row.name}`));
      if (folder) {
        run.visited.push(`${info.folder}/${folder.name}`);
        run.stack.push(`${location.origin}/app/jx-web/mycourse/${info.course}/resource/${info.folder}`);
        await save();
        openRow(folder, true);
        return;
      }
      if (run.stack.length) {
        const parent = run.stack.pop();
        await save();
        location.assign(parent);
        return;
      }
    }
    stop(`队列结束，已确认 ${run.completed.length} 项完成；测验及不支持的类型未处理。`);
  }
  async function tick() {
    if (busy || !run?.enabled) return;
    busy = true;
    try {
      const now = Date.now();
      const info = route();
      const atHome = location.pathname.replace(/\/$/, '') === homePath;
      if (!info && !(run.mode === 'home' && atHome)) return stop('已离开课程资源或首页，队列停止。');
      if (run.mode !== 'home' && run.course && run.course !== info.course) return stop('课程已切换，队列停止。');
      if (info) run.course = info.course;
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        arrived = now;
        lastAttempt = 0;
        transition = null;
        lastPlay = 0;
        taskTiming = null;
        timingProbeAt = 0;
        homeSignature = '';
        homeStableSince = 0;
        homeActionAt = 0;
        await save();
      }
      if (transition && !atHome) {
        if (now - transition.at > 15000) stop('页面未成功切换，请手动打开目标任务后重新开始。');
        return;
      }
      // SPA route changes render a temporary unfinished state. Never act on it.
      if (now - arrived < 5000) return;
      const text = document.body.innerText;
      if (/验证码|人机验证|登录已过期|登录失效|重新登录/.test(text)) return stop('需要验证或重新登录，请手动处理。');
      if (run.mode === 'home' && atHome) return await readHome(now);
      if (run.mode === 'home' && !info.file) return stop('首页待办未打开到具体资源，已暂停，请检查页面。');
      if (!info.file) return await next(info);
      const name = document.querySelector('h5.title')?.getAttribute('title') || document.title.split(' | ')[0];
      if (run.mode === 'home' && name !== run.homeTask?.name) return stop('当前资源与选中的首页待办不一致，已暂停。');
      if (finished()) {
        if (!run.completed.includes(location.pathname)) run.completed.push(location.pathname);
        if (!run.visited.includes(`${info.folder}/${name}`)) run.visited.push(`${info.folder}/${name}`);
        log(`平台已确认完成：${name}`);
        await save();
        if (run.options.autoNext === false) return stop(`当前任务已完成：${name}；自动下一任务未开启。`);
        log(`当前任务已完成，正在自动打开下一任务：${name}`);
        if (run.mode === 'home') {
          if (!run.homeFinished.includes(run.homeTask.key)) run.homeFinished.push(run.homeTask.key);
          run.homeTask = null;
          await save();
          location.assign(`${location.origin}${homePath}`);
          return;
        }
        return await next(info);
      }
      if (!supported.test(name)) return stop('当前资源类型未支持，请从视频或课件开始。');
      const timingHint = document.querySelector('.ant-modal .finish_task_info');
      if (timingHint) {
        const timing = globalThis.xiaoyaTaskTiming(timingHint.textContent);
        if (!timing) return stop('无法识别平台的任务时长要求，请手动查看提示后重新开始。');
        taskTiming = { ...timing, due: now + timing.remainingSeconds * 1000 };
        const modal = timingHint.closest('.ant-modal');
        const acknowledge = [...modal.querySelectorAll('button')].find(button => button.textContent.trim() === '知道了');
        if (!acknowledge) return stop('已读取时长要求，但无法关闭平台提示，请手动处理。');
        acknowledge.click();
        log(`平台要求 ${timing.requiredSeconds} 秒，已学习 ${timing.learnedSeconds ?? '未知'} 秒，剩余 ${Math.ceil(timing.remainingSeconds)} 秒`);
        return;
      }
      // File-preview confirmation is scoped; never accept arbitrary course dialogs.
      for (const button of document.querySelectorAll('button')) {
        if (button.textContent.trim() === '确定' && /文件预览确认/.test(button.parentElement?.textContent || '')) button.click();
      }
      const video = document.querySelector('video');
      let ready = false;
      if (video) {
        video.playbackRate = run.options.rate;
        if (run.options.muted) video.muted = true;
        if (video.error) return stop('视频加载失败，请检查网络后重新开始。');
        if (!video.ended && video.paused && now - lastPlay > 5000) {
          lastPlay = now;
          try { await video.play(); }
          catch { log('浏览器阻止自动播放，请手动点击播放，或启用静音自动播放。'); return; }
        }
        ready = video.ended || (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.5);
        if (!ready) log(`播放中：${name} · ${run.options.rate} 倍速`);
      } else if (!/\.(mp4|webm|m4v|mov)$/i.test(name)) {
        if (!taskTiming) {
          if (timingProbeAt && now - timingProbeAt > 15000) {
            return stop('平台未返回可识别的课件时长要求，已暂停，请手动查看任务条件。');
          }
          // One normal completion attempt reveals this resource's actual rule.
          // It may also succeed immediately for a resource with no time limit.
          ready = !timingProbeAt;
        } else {
          ready = now >= taskTiming.due;
          if (!ready) log(`阅读等待：${name} · 平台要求 ${taskTiming.requiredSeconds} 秒`);
        }
      } else {
        log('等待播放器加载…');
      }
      if (taskTiming && now < taskTiming.due) return;
      const maxWait = Math.max(1800000,
        video && Number.isFinite(video.duration) ? video.duration * 2000 + 600000 : 0,
        taskTiming ? taskTiming.due - arrived + 600000 : 0);
      if (now - arrived > maxWait) return stop('长时间未获得完成状态，已暂停，请检查任务要求或网络。');
      if (!ready || now - lastAttempt < 30000) return;
      const complete = [...document.querySelectorAll('.ta_icon_btn')].find(e => e.textContent.trim() === '点我完成任务');
      if (!complete) return log('等待平台显示完成按钮…');
      lastAttempt = now;
      if (!video && !taskTiming) timingProbeAt = now;
      complete.click();
      log(timingProbeAt && !taskTiming ? '正在读取当前课件的实际时长要求…' : '已请求完成，等待平台确认；未确认前不会切换。');
    } catch (error) {
      stop(`运行暂停：${error.message}`);
    } finally { busy = false; }
  }
  function start(value) {
    run = value;
    arrived = Date.now();
    lastUrl = '';
    lastStatus = '';
    transition = null;
    background(run.enabled && run.options.background);
    log(run.mode === 'home' ? '正在读取首页跨课程待办…' : '队列已启动，正在读取当前目录…');
    void tick();
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'health') reply({ ok: true, protocol,
      loggedInHome: location.pathname.replace(/\/$/, '') === homePath && !!document.querySelector('[title="点击查看/刷新待完成学习任务"]') });
    if (message.type === 'run') { start(message.run); reply({ ok: true }); }
    if (message.type === 'halt' && run) { stop('已手动停止。'); reply({ ok: true }); }
    if (message.type === 'tick') void tick();
  });
  chrome.runtime.sendMessage({ type: 'get' }).then(result => {
    if (result?.run?.enabled) start(result.run);
  }).catch(() => {});
  setInterval(() => void tick(), 1000);
  setInterval(() => {
    if (!run?.enabled && location.pathname.replace(/\/$/, '') === homePath &&
        document.querySelector('[title="点击查看/刷新待完成学习任务"]')) {
      chrome.runtime.sendMessage({ type: 'login-ready' }).catch(() => {});
    }
  }, 5000);
})();

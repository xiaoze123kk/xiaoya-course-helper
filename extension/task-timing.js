(() => {
  'use strict';
  function seconds(text) {
    const units = /(?:(\d+(?:\.\d+)?)\s*(?:小时|时))?\s*(?:(\d+(?:\.\d+)?)\s*(?:分钟|分))?\s*(?:(\d+(?:\.\d+)?)\s*秒)?/g;
    for (const match of text.matchAll(units)) {
      if (match[1] !== undefined || match[2] !== undefined || match[3] !== undefined) {
        return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
      }
    }
    return null;
  }
  // Parse the platform's task-condition dialog, never arbitrary course content.
  globalThis.xiaoyaTaskTiming = text => {
    const required = text.match(/至少(?:观看|学习|阅读|停留)\s*([^，,。\n]+)/);
    if (!required) return null;
    const requiredSeconds = seconds(required[1]);
    if (requiredSeconds === null || requiredSeconds < 0) return null;
    const learned = text.match(/已学习\s*([^，,。\n]+)/);
    const learnedSeconds = learned ? seconds(learned[1]) : null;
    return { requiredSeconds, learnedSeconds,
      remainingSeconds: Math.max(0, requiredSeconds - (learnedSeconds ?? 0)) };
  };
})();

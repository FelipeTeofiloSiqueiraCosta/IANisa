// Seed Paseo 0.7.2's native form preferences before its app starts.
// Existing choices belong to the person using this browser and take precedence.
(() => {
  try {
    const config = document.getElementById('ratoeira-defaults');
    if (!config) return;
    const preset = JSON.parse(config.textContent);
    if (!preset?.provider || !preset.model) return;
    const key = '@paseo:create-agent-preferences';
    const raw = localStorage.getItem(key);
    const saved = raw === null ? {} : JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.provider) return;
    const providers = saved.providerPreferences ?? {};
    const current = providers[preset.provider] ?? {};
    const model = current.model || preset.model;
    const thinking = model === preset.model && preset.thinkingOptionId
      ? {[model]:preset.thinkingOptionId} : {};
    localStorage.setItem(key, JSON.stringify({
      ...saved,
      provider:preset.provider,
      providerPreferences:{
        ...providers,
        [preset.provider]:{
          ...current,
          model,
          thinkingByModel:{...thinking,...current.thinkingByModel},
        },
      },
    }));
  } catch {
    // A blocked storage area or an unreadable preference must not prevent login.
  }
})();

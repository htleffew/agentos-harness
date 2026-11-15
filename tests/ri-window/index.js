globalThis.riTestWindow = async function (chat) { const keep = Number(localStorage.getItem('ri_test_window') || 0); if (keep > 0 && chat.length > keep) chat.splice(0, chat.length - keep); };

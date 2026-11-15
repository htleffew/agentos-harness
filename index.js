// Roleplay Instructions: random instructions for roleplay chats, saved as ordinary lorebooks.
import { init } from './src/engine.js';
import { mount } from './src/ui/panel.js';
import { refreshUnderReplies } from './src/ui/sent.js';
import { applyPronouns, settings } from './src/store.js';
import { isChatOpen, on, LOG } from './src/st.js';

(function start() {
    try {
        settings();
        const missing = init();
        if (isChatOpen()) applyPronouns();
        mount(missing);
        for (const name of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED']) on(name, () => setTimeout(refreshUnderReplies, 50));
        on('CHAT_CHANGED', () => setTimeout(refreshUnderReplies, 300));
        console.log(LOG, 'loaded', missing.length ? `missing events: ${missing.join(', ')}` : '');
    } catch (e) {
        console.error(LOG, 'failed to start', e);
    }
})();

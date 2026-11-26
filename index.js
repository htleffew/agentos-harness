// Roleplay Instructions: random instructions for roleplay chats, saved as ordinary lorebooks.
import { init } from './src/engine.js';
import { mount } from './src/ui/panel.js';
import { mountQuickActions } from './src/ui/quick-actions.js';
import { mountReplyProgress } from './src/ui/reply-progress.js';
import { refreshUnderReplies } from './src/ui/sent.js';
import { applyPronouns, settings } from './src/store.js';
import { isChatOpen, on, LOG } from './src/st.js';
import { startDesktopQueue } from './src/memory/queue.js';
import { startMemory } from './src/memory/import.js';
import { startChapters } from './src/chapters.js';
import { startCatchUp } from './src/memory/catchup.js';
import { installGeneratedBookGuard } from './src/memory/story-world-book.js';
import { startRecall } from './src/recall.js';
import { startTrackerBook } from './src/tracker-book.js';
import './src/ui/tracker-book.js';
import { startInject } from './src/memory/inject.js';
import { startBehaviorBooks } from './src/memory/event-seeds.js';
import './src/ui/connections-spend.js';
import { loadShipped, readBankBook } from './src/banks.js';
import './src/ui/touch-layout.js';
import { startDice } from './src/dice-judge.js';
import './src/ui/stat-sheet.js';

(function start() {
    try {
        settings();
        const missing = init();
        if (isChatOpen()) applyPronouns();
        mount(missing);
        mountReplyProgress();
        mountQuickActions();
        for (const name of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED']) on(name, () => setTimeout(refreshUnderReplies, 50));
        on('CHAT_CHANGED', () => setTimeout(refreshUnderReplies, 300));
        try { startDesktopQueue(); } catch (e) { console.warn(LOG, 'background queue did not start', e); }
        installGeneratedBookGuard().catch(e => console.warn(LOG, 'generated book guard did not start', e));
        // Option banks: the shipped lists, then her book when it exists. Rolls read both from memory.
        loadShipped().then(readBankBook).catch(e => console.warn(LOG, 'option banks did not load', e));
        try { startMemory(); } catch (e) { console.warn(LOG, 'chat memory did not start', e); }
        try { startChapters(); } catch (e) { console.warn(LOG, 'chapters did not start', e); }
        startCatchUp().catch(e => console.warn(LOG, 'catch-up did not start', e));
        try { startTrackerBook(); } catch (e) { console.warn(LOG, 'tracker book did not start', e); }
        try { startRecall(); } catch (e) { console.warn(LOG, 'recall did not start', e); }
        startInject().catch(e => console.warn(LOG, 'request layout did not start', e));
        startBehaviorBooks().catch(e => console.warn(LOG, 'behavior books did not start', e));
        startDice().catch(e => console.warn(LOG, 'dice did not start', e));
        console.log(LOG, 'loaded', missing.length ? `missing events: ${missing.join(', ')}` : '');
    } catch (e) {
        console.error(LOG, 'failed to start', e);
    }
})();

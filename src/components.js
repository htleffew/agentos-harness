import { chatState, settings } from './store.js';

export function memoryComponents() {
    const local = chatState()?.components;
    const { enabled, summary } = settings();
    const chapters = enabled && (local?.chapters ?? summary.on !== false);
    return {
        world: enabled && local?.world !== false,
        chapters,
        hide: chapters && (local?.hide ?? summary.hide !== false),
    };
}

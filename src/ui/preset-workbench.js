import { h, button } from './dom.js';
// Registers Setup, Presets with the page registry when the panel loads this module.
import './presets-page.js';
// Registers Setup, Presets, Cleanup (B18).
import './preset-cleanup.js';

const hint = text=>h('p',{class:'ri-help'},text);
const PAGE = 'presets';

/** The old Preset & Extension page keeps a pointer; the bank, the stack and loadouts live in Setup, Presets. */
export function presetWorkbench(preset,app) {
    return h('div',{class:'ri-card ri-tight ri-preset-workbench-link'},
        hint(`The block bank and stack of ${preset} and saved loadouts are in Setup, Presets.`),
        button('Open Setup, Presets',()=>app.openPage(PAGE),{kind:'primary'}));
}

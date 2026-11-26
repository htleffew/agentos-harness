// B50: the three switches for time skips and scene breaks, drawn on Direction, Sets and pacing (src/ui/settings.js).
import { field, section, select } from './dom.js';
import { markerSettings, saveMarkerSettings } from '../scene-markers.js';

const onOff = (value, change, label) => select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], value ? 'on' : 'off',
    next => change(next === 'on'), { 'aria-label': label });

export function sceneMarkersSection() {
    const config = markerSettings();
    return section('Time skips and scene breaks',
        field('Move the story clock', 'When your message has a line that starts "Time skip:" followed by an amount such as "three days", the story clock moves forward by that amount before the reply is written. If the amount cannot be read, the clock is marked unknown until the reply is filed. Scene: lines and *** breaks leave the clock alone.',
            onOff(config.clock, value => saveMarkerSettings({ clock: value }), 'Move the story clock')),
        field('Close the chapter', 'A "Time skip:" line, a "Scene:" line or a line of *** closes the open chapter at the newest reply, so your message starts a new one. The chapter is written the same way "Close the chapter here" writes it.',
            onOff(config.chapter, value => saveMarkerSettings({ chapter: value }), 'Close the chapter')),
        field('List Pending events that fell due', 'After a "Time skip:", Pending events whose due time falls inside the skipped time are listed, and the next filing of the story rules on each.',
            onOff(config.due, value => saveMarkerSettings({ due: value }), 'List Pending events that fell due')));
}

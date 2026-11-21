const translations = [1, 2, 3, 9, 12, 13, 14, 15, 16, 17];
function syntheticKeel() {
    const free = [9, 14, 15, 17];
    return {
        version: 2, name: 'Keel v1.9 synthetic', disableSend: true, extra: { retained: true },
        qrList: Array.from({ length: 23 }, (_, index) => {
            const id = index + 1;
            const entry = { id, label: 'Original title ' + id, message: '/echo inert ' + id, isHidden: id !== 10, extra: { id } };
            if (id === 10) entry.message = '/buttons ["Plot twist", "Cancel"] | /run {{pipe}}';
            if (id === 19) Object.assign(entry, { message: '/getvar keel_snapshot | /setvar key=keel_objective {{pipe}}', executeOnAi: true });
            if (id === 20) Object.assign(entry, { message: '/getvar keel_state | /setvar key=keel_before {{pipe}}', executeBeforeGeneration: true });
            if (id === 3) entry.message = '/flushinject id=keel_oneshot';
            if (translations.includes(id) && id !== 3) {
                entry.message = (free.includes(id) ? '/input Enter a direction | ' : '') +
                    '/inject id=keel_oneshot position=chat role=system depth=0 ephemeral=true ' +
                    (free.includes(id) ? 'Apply this idea: {{pipe}}.' : 'Write direction number ' + id + '.');
            }
            return entry;
        }),
    };
}

module.exports = { syntheticKeel, translations };

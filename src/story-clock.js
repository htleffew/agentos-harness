const DAY = 1440;
const DAY_MS = 86400000;
const WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export const validStoryMinute = value => Number.isSafeInteger(value) && value >= 0;
export const validElapsed = value => validStoryMinute(value) && value <= 5256000;

function clockTime(value) {
    const match = /^(\d{1,2}):(\d{2})(?:\s*([AP])\.?M\.?)?$/i.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]), period = match[3]?.toUpperCase();
    if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return null;
    return { minutes:(period ? hour % 12 + (period==='P' ? 12 : 0) : hour)*60+minute, twelve:!!period };
}

function formatTime(minutes, twelve) {
    const hour = Math.floor(minutes/60);
    const minute = String(minutes%60).padStart(2,'0');
    return twelve ? `${hour%12 || 12}:${minute} ${hour<12 ? 'AM' : 'PM'}` : `${String(hour).padStart(2,'0')}:${minute}`;
}

function dayNumber(value) {
    const prefix = new RegExp(`^(${WEEK.join('|')}),?\\s+`,'i');
    const original = String(value || '').trim();
    const weekday = WEEK.findIndex(day=>day.toLowerCase()===original.match(prefix)?.[1].toLowerCase());
    const date = original.replace(prefix,'');
    const ordinal = /^Day\s+(\d{1,9})$/i.exec(date);
    if (ordinal) return { format:'ordinal', day:Number(ordinal[1]),weekday };
    const written = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(date);
    const month = written ? MONTHS.findIndex(name=>name.toLowerCase()===written[1].toLowerCase()) : -1;
    const iso = month>=0 ? `${written[3]}-${String(month+1).padStart(2,'0')}-${written[2].padStart(2,'0')}` : date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const stamp = Date.parse(iso+'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(iso+'T')
        ? { format:'calendar',day:stamp/DAY_MS,weekday,written:month>=0 } : null;
}

function nextDate(date, days) {
    if (!days) return date;
    const current = dayNumber(date);
    if (!current) return '';
    const day = current.day+days;
    if (current.format==='ordinal') {
        const prefix = current.weekday>=0 ? `${WEEK[(current.weekday+days)%7]}, ` : '';
        return day < 1e9 ? `${prefix}Day ${day}` : '';
    }
    const shifted = new Date(day*DAY_MS);
    if (!Number.isFinite(shifted.valueOf()) || shifted.getUTCFullYear()>9999) return '';
    const prefix = current.weekday>=0 ? `${WEEK[shifted.getUTCDay()]}, ` : '';
    return prefix + (current.written
        ? `${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}, ${shifted.getUTCFullYear()}`
        : shifted.toISOString().slice(0,10));
}

function datedInterval(before, next, start, end) {
    if (!start || !end || !before.date || !next.date) return undefined;
    if (before.date===next.date) return end.minutes-start.minutes;
    const from = dayNumber(before.date), to = dayNumber(next.date);
    if (from && to?.format===from.format) return (to.day-from.day)*DAY+end.minutes-start.minutes;
    return undefined;
}

function rollDate(scene,previous,days) {
    scene.date=nextDate(previous.date,days);
    const known=previous.date || previous.lastKnownDate;
    if (scene.date || !known) return;
    scene.lastKnownDate=known;
    if (previous.date || Number.isSafeInteger(previous.daysAfterKnownDate)) {
        scene.daysAfterKnownDate=(previous.date ? 0 : previous.daysAfterKnownDate)+days;
    }
}

/** Advance the relative story clock and the displayed scene from one accepted update. */
export function advanceStoryClock(previous = {}, update = {}, { clock, minutes, elapsed } = {}) {
    const scene = { ...previous,...update };
    const issue = [];
    const start = clockTime(previous.time || previous.when);
    const end = clockTime(update.time);
    const measured = datedInterval(previous,update,start,end);
    const known = validStoryMinute(clock);
    let duration = validElapsed(elapsed) ? elapsed : undefined;
    if (known && validStoryMinute(minutes)) {
        if (minutes < clock) issue.push('Story minutes cannot move backwards.');
        else if (minutes>clock || !duration) duration=minutes-clock;
    }
    if (measured < 0) {
        issue.push('The submitted date and time moved backwards. Kept the established timeline.');
        scene.date=previous.date;
        scene.time=previous.time;
    } else if (measured !== undefined && (measured>0 || !duration)) {
        if (duration !== undefined && measured!==duration) {
            issue.push('The stated elapsed time disagreed with the dated scene. Used the dated scene for elapsed time.');
        }
        duration=measured;
    }
    if (duration===undefined && start && end && !update.date && end.minutes>=start.minutes) {
        duration=end.minutes-start.minutes;
    }
    if (duration===undefined && previous.date && update.date && update.date!==previous.date && !update.time) {
        delete scene.time;
        if (!update.when) delete scene.when;
    }
    if (update.time && update.time!==previous.time && !update.when) delete scene.when;
    if (update.when!==undefined && update.time===undefined) delete scene.time;
    if (duration===undefined && start && end && end.minutes<start.minutes && !update.date) {
        issue.push('An earlier clock time needs a date or elapsed minutes to establish when it occurs.');
        scene.time=previous.time;
    }
    if (duration>0) {
        if (!update.when && (start || duration>=60)) delete scene.when;
        if (start) {
            const local = start.minutes + duration%DAY;
            const days = Math.floor(duration/DAY)+Math.floor(local/DAY);
            const endMinute = local%DAY;
            if (end && end.minutes!==endMinute && !(measured>0)) {
                issue.push('The submitted clock time disagreed with the elapsed minutes. Used the elapsed minutes for the clock time.');
            }
            scene.time=formatTime(endMinute,(end || start).twelve);
            if (days && (!Object.hasOwn(update,'date') || update.date===previous.date || measured<0)) {
                rollDate(scene,previous,days);
            }
        } else {
            if (duration>=60 && !update.time) delete scene.time;
            if (duration>=DAY && !Object.hasOwn(update,'date')) {
                const days=Math.floor(duration/DAY);
                rollDate(scene,previous,days);
                if (duration%DAY) {
                    scene.date='';
                    scene.lastKnownDate=previous.date || previous.lastKnownDate;
                    delete scene.daysAfterKnownDate;
                }
            }
        }
    }
    if (scene.date) {
        delete scene.lastKnownDate;
        delete scene.daysAfterKnownDate;
    }
    const candidate = known ? clock+(duration ?? 0)
        : validStoryMinute(minutes) ? minutes : duration ?? (end || start ? 0 : undefined);
    const storyMinute = validStoryMinute(candidate) ? candidate : known ? clock : undefined;
    return { scene,minutes:storyMinute,issues:issue };
}
